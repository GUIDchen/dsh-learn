// 题库内容回归：平台变体的判定必须与"实测到的系统差异"一致。
// 这里每一条断言都对应一次在本机真实执行过的探测结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECT } from './expected.mjs';
import { findTask, BUILTIN_TASKS, BUILTIN_TRACKS, BUILTIN_PACK_IDS, levelStats, listTasksByLevel, expectedLevel } from '../src/core/tasks.mjs';
// 内容护栏（k8s 每题都要有只读验证项、文档数字等）描述的是**随工具发布的题库**：
// 用户自己 promote 进用户题库目录的包不该把这些断言弄红
const TASKS = BUILTIN_TASKS;
const TRACKS = BUILTIN_TRACKS;
const PACK_IDS = BUILTIN_PACK_IDS;
import { judge, resolveTask, platformBlocker, BLOCKED_CEILING } from '../src/core/judge.mjs';
import { isAllowed, diagnoseOutput } from '../src/core/exec.mjs';

test('题库规模与轨道符合预期', function () {
  assert.ok(TASKS.length >= EXPECT.tasks, '任务数应 >= ' + EXPECT.tasks + '，实际 ' + TASKS.length);
  assert.deepEqual(TRACKS, EXPECT.trackList);
  assert.deepEqual(PACK_IDS.slice().sort(), EXPECT.packList);
});

// Windows 轨（10 道）：这些命令只在 Windows 上有意义，所以题目声明 platforms=['win32']。
// 三条都要成立——只声明不拦，macOS 学员就会拿一条本机根本不存在的命令拿满分。
test('Windows 轨只在 win32 成立：自评满分、其他平台被拦住', function () {
  const rows = TASKS.filter(function (task) { return task.track === 'windows'; });
  assert.ok(rows.length >= 3, 'windows 轨要满足轨道下限（3 道），实际 ' + rows.length);
  rows.forEach(function (task) {
    assert.deepEqual(task.platforms, ['win32'], task.id + ' 应只声明 win32');
    const resolved = resolveTask(task, 'win32');
    assert.equal(judge(task, resolved.sample, 'win32').score, 100, task.id + ' 的参考答案在 win32 必须满分');
    ['darwin', 'linux'].forEach(function (platform) {
      assert.ok(platformBlocker(resolveTask(task, platform)), task.id + ' 在 ' + platform + ' 上必须被平台闸拦住');
    });
  });
});
test('每道题都有难度标注，且三档都有人', function () {
  const unlabeled = TASKS.filter(function (task) { return ['easy', 'medium', 'hard'].indexOf(task.level) === -1; });
  assert.deepEqual(unlabeled.map(function (t) { return t.id; }), [], '每道题都要标 easy/medium/hard');
  const stats = levelStats(TASKS);
  assert.ok(stats.easy > 0, '简单档不能为空');
  assert.ok(stats.medium > 0, '中等档不能为空');
  assert.ok(stats.hard > 0, '困难档不能为空');
  assert.equal(stats.easy + stats.medium + stats.hard, TASKS.length, '三档之和应等于题库规模');

  // 口径可复核：每道题的标注都要等于 expectedLevel 算出来的档（口径只有这一份实现）
  const wrong = TASKS.filter(function (task) { return task.level !== expectedLevel(task); });
  assert.deepEqual(wrong.map(function (t) { return t.id + '(' + t.level + '→' + expectedLevel(t) + ')'; }), [],
    '难度标注与口径不符的题：');
  const hard = TASKS.filter(function (task) { return task.level === 'hard'; });
  assert.ok(hard.every(function (task) { return expectedLevel(task) === 'hard'; }), '困难题都要经得起口径复核');
});

test('难度口径：变体题按变体里的要素算，不被基础 require 算轻', function () {
  // linux.largest-files 的基础 require 只有 1 条，两个平台变体各 6 条 —— 按变体算才是困难
  const task = findTask('linux.largest-files');
  assert.equal((task.require || []).length, 1, '这道题的基础 require 保持 1 条');
  assert.ok(Object.keys(task.variants).length >= 2, '这道题至少要有 BSD / GNU 两个变体（后来又补了 Windows）');
  assert.equal(expectedLevel(task), 'hard', '变体要素多，应为困难');

  // 反过来：一条没有禁止项、没有变体的三要素题必须是简单
  assert.equal(expectedLevel({ require: [{ p: 'a' }, { p: 'b' }, { p: 'c' }] }), 'easy');
  // 带 block 级禁止项的 5 要素题是困难，带 warn 级禁止项的同样要素数是中等
  const five = [{ p: 'a' }, { p: 'b' }, { p: 'c' }, { p: 'd' }, { p: 'e' }];
  assert.equal(expectedLevel({ require: five, forbid: [{ p: 'x', severity: 'block' }] }), 'hard');
  assert.equal(expectedLevel({ require: five, forbid: [{ p: 'x' }] }), 'medium');
});

test('按难度筛选能筛出对应的题', function () {
  const easy = listTasksByLevel('easy');
  assert.ok(easy.length > 0 && easy.every(function (task) { return task.level === 'easy'; }));
  const hardLinux = listTasksByLevel('hard', 'linux');
  assert.ok(hardLinux.every(function (task) { return task.level === 'hard' && task.track === 'linux'; }));
  // 'all' 指的是运行时全部题（含用户题库），所以这里是 >= 而不是 ==
  assert.ok(listTasksByLevel('all').length >= TASKS.length);
});

test('stat 取文件大小：macOS 用 -f %z，Linux 用 -c %s', function () {
  const task = findTask('linux.stat-size');
  assert.equal(judge(task, "stat -f '%z' a.txt", 'darwin').score, 100);
  const macWrong = judge(task, "stat -c '%s' a.txt", 'darwin');
  assert.ok(macWrong.score < 100, 'macOS 不应接受 GNU 写法');
  assert.ok(macWrong.notes.some(function (n) { return n.indexOf('illegal option') > -1; }));
  assert.equal(judge(task, "stat -c '%s' a.txt", 'linux').score, 100);
  assert.ok(judge(task, "stat -f '%z' a.txt", 'linux').score < 100, 'GNU stat 的 -f 不是格式串');
});

test('grep -P：GNU 可用，macOS 的 BSD grep 必须改用 -E', function () {
  const task = findTask('linux.grep-pcre');
  assert.equal(judge(task, "grep -Po '[0-9]+' a.txt", 'linux').score, 100);
  const macP = judge(task, "grep -Po '[0-9]+' a.txt", 'darwin');
  assert.ok(macP.score < 100);
  assert.ok(macP.notes.some(function (n) { return n.indexOf('invalid option') > -1; }));
  assert.equal(judge(task, "grep -Eo '[0-9]+' a.txt", 'darwin').score, 100);
});

test('短选项合并写法不能被误判为缺项', function () {
  assert.equal(judge(findTask('linux.grep-pcre'), "grep -Eo '[0-9]+' a.txt", 'darwin').score, 100);
  assert.equal(judge(findTask('linux.grep-pcre'), "grep -Po '[0-9]+' a.txt", 'linux').score, 100);
  const combined = judge(findTask('docker.run-web'), 'docker run -dit -p 8080:80 --name web nginx:1.25', 'darwin');
  assert.equal(combined.score, 100, 'docker run -dit 是惯用写法，-d 不应被判缺失');
  assert.equal(combined.pass, true);
  const duCombined = judge(findTask('linux.du-sorted'), 'du -sh * | sort -rh | head -3', 'darwin');
  assert.equal(duCombined.score, 100, 'sort -rh 同样应被识别');
});

test('find 统计与 du 排行这两道跨平台题都能判满分', function () {
  assert.equal(judge(findTask('linux.find-count'), "find . -name '*.log' | wc -l", 'darwin').score, 100);
  assert.equal(judge(findTask('linux.du-sorted'), 'du -sh * | sort -rh | head -3', 'linux').score, 100);
  const dangerous = judge(findTask('linux.find-count'), "find . -name '*.log' | wc -l && rm -rf *.log", 'darwin');
  assert.ok(dangerous.notes.length > 0, '统计题里夹删除命令必须被点名');
});

test('du 深度与 find 大小：BSD 与 GNU 写法互不通用（实测退出码）', function () {
  const depth = findTask('linux.du-depth');
  assert.equal(judge(depth, 'du -h -d 1 . | sort -rh | head -5', 'darwin').score, 100);
  assert.equal(judge(depth, 'du -h --max-depth=1 . | sort -rh | head -5', 'linux').score, 100);
  assert.ok(judge(depth, 'du -h --max-depth=1 . | sort -rh | head -5', 'darwin').score < 100, 'BSD du 不认 --max-depth');
  assert.ok(judge(depth, 'du -h -d 1 . | sort -rh | head -5', 'linux').score < 100, 'GNU 侧要求 --max-depth 写法');

  const largest = findTask('linux.largest-files');
  const mac = "find . -type f -exec stat -f '%z %N' {} + | sort -rn | head -5";
  const gnu = "find . -type f -printf '%s %p\\n' | sort -rn | head -5";
  assert.equal(judge(largest, mac, 'darwin').score, 100);
  assert.equal(judge(largest, gnu, 'linux').score, 100);
  const macPrintf = judge(largest, gnu, 'darwin');
  assert.ok(macPrintf.score < 100, 'BSD find 没有 -printf');
  assert.ok(macPrintf.notes.some(function (n) { return n.indexOf('unknown primary') > -1; }));
  assert.ok(judge(largest, mac, 'linux').score < 100, 'GNU stat 的 -f 不是格式串');
});

test('Docker 进阶题：构建参数、root 进入、快照、格式模板', function () {
  assert.equal(judge(findTask('docker.build-arg'), 'docker build --build-arg APP_ENV=prod -t myste:1.0 .', 'darwin').score, 100);
  assert.equal(judge(findTask('docker.exec-root'), 'docker exec -u 0 -it web bash', 'darwin').score, 100);
  const runInstead = judge(findTask('docker.exec-root'), 'docker run -it web bash', 'darwin');
  assert.ok(runInstead.notes.some(function (n) { return n.indexOf('exec') > -1; }));
  assert.equal(judge(findTask('docker.stats-snapshot'), 'docker stats --no-stream', 'darwin').score, 100);
  assert.ok(judge(findTask('docker.stats-snapshot'), 'docker stats', 'darwin').score < 100, '实时流不是快照');
  assert.equal(judge(findTask('docker.volume-format'), "docker volume ls --format '{{.Name}}'", 'darwin').score, 100);
  assert.ok(judge(findTask('docker.volume-format'), 'docker volume ls | awk {print $2}', 'darwin').notes.length > 0);
  assert.equal(judge(findTask('docker.network-inspect'), "docker network inspect mysite-net --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'", 'darwin').score, 100);
  assert.equal(judge(findTask('docker.inspect-health'), "docker inspect --format '{{.State.Health.Status}}' web", 'darwin').score, 100);
});

test('安全清理题：-a 与 --volumes 都被拦下', function () {
  const task = findTask('docker.system-prune-safe');
  assert.equal(judge(task, 'docker system prune', 'darwin').score, 100);
  const volumes = judge(task, 'docker system prune --volumes', 'darwin');
  assert.ok(volumes.score < 100);
  assert.ok(volumes.notes.some(function (n) { return n.indexOf('数据卷') > -1; }));
  const all = judge(task, 'docker system prune -a --volumes', 'darwin');
  assert.ok(all.notes.length >= 2, '两个禁止项都应被点名');
});

test('block 级禁止写法必须判未通过，不能停在部分通过', function () {
  const prune = judge(findTask('docker.system-prune-safe'), 'docker system prune --volumes', 'darwin');
  assert.equal(prune.blocked, true);
  assert.equal(prune.verdict, '未通过', '删卷的写法不应被评成部分通过');
  assert.ok(prune.score <= BLOCKED_CEILING);
  assert.match(prune.tips, /block 级禁止项/);

  const hard = judge(findTask('git.restore-staged'), 'git restore --staged report.md && git reset --hard', 'darwin');
  assert.equal(hard.blocked, true);
  assert.equal(hard.verdict, '未通过');

  const counted = judge(findTask('linux.find-count'), "find . -name '*.log' | wc -l && rm -rf *.log", 'darwin');
  assert.equal(counted.blocked, true);
  assert.equal(counted.verdict, '未通过');

  const amend = judge(findTask('git.amend-message'), 'git commit --amend -m "fix"', 'darwin');
  assert.equal(Boolean(amend.blocked), false);
  assert.ok(amend.score < 100);
});

test('Git 题：switch 建分支、restore --staged、stash 往返、amend 不改信息', function () {
  assert.equal(judge(findTask('git.switch-create'), 'git switch -c feature/report', 'darwin').score, 100);
  assert.equal(judge(findTask('git.restore-staged'), 'git restore --staged report.md', 'darwin').score, 100);
  const hard = judge(findTask('git.restore-staged'), 'git restore --staged report.md && git reset --hard', 'darwin');
  assert.ok(hard.notes.some(function (n) { return n.indexOf('--hard') > -1; }));
  assert.equal(judge(findTask('git.stash-cycle'), 'git stash push -m wip && git stash pop', 'linux').score, 100);
  assert.equal(judge(findTask('git.amend-message'), 'git add report.md && git commit --amend --no-edit', 'darwin').score, 100);
  assert.ok(judge(findTask('git.amend-message'), 'git commit --amend -m "fix"', 'darwin').notes.length > 0);
  assert.equal(judge(findTask('git.log-graph'), 'git log --oneline --graph --decorate -n 10', 'darwin').score, 100);
});

test('换行符配置：macOS/Linux 用 input，Windows 变体要求 true', function () {
  const task = findTask('git.autocrlf-cross-platform');
  assert.equal(judge(task, 'git config --global core.autocrlf input', 'darwin').score, 100);
  assert.equal(judge(task, 'git config --global core.autocrlf input', 'linux').score, 100);
  const macTrue = judge(task, 'git config --global core.autocrlf true', 'darwin');
  assert.ok(macTrue.score < 100, 'macOS 上设 true 应被判为不合适');
  assert.equal(judge(task, 'git config --global core.autocrlf true', 'win32').score, 100);
  const winInput = judge(task, 'git config --global core.autocrlf input', 'win32');
  assert.ok(winInput.score < 100, 'Windows 变体下 input 应被判为不合适');
});

test('服务管理：macOS 用 brew services，Linux 用 systemctl，互不认', function () {
  const task = findTask('service.start');
  assert.equal(judge(task, 'brew services start nginx', 'darwin').score, 100);
  assert.equal(judge(task, 'sudo systemctl enable --now nginx', 'linux').score, 100);
  const macWithSystemctl = judge(task, 'sudo systemctl start nginx', 'darwin');
  assert.ok(macWithSystemctl.score < 100);
  assert.ok(macWithSystemctl.notes.some(function (n) { return n.indexOf('systemctl') > -1; }));
  const linuxWithBrew = judge(task, 'brew services start nginx', 'linux');
  assert.ok(linuxWithBrew.score < 100);
  assert.ok(linuxWithBrew.notes.some(function (n) { return n.indexOf('brew') > -1; }));

  const status = findTask('service.status');
  assert.equal(judge(status, 'brew services list | grep nginx', 'darwin').score, 100);
  assert.equal(judge(status, 'sudo systemctl status nginx --no-pager', 'linux').score, 100);

  const restart = findTask('service.restart-after-config');
  assert.equal(judge(restart, 'sudo nginx -t && sudo systemctl restart nginx', 'linux').score, 100);
  assert.ok(judge(restart, 'sudo systemctl restart nginx', 'linux').score < 100, '重启前应校验配置');
});

test('网络排障：macOS 没有 ss，Linux 用 ss 而不是 lsof', function () {
  const task = findTask('network.listen-ports');
  assert.equal(judge(task, 'lsof -nP -iTCP -sTCP:LISTEN', 'darwin').score, 100);
  const macSs = judge(task, 'ss -ltnp', 'darwin');
  assert.ok(macSs.score < 100);
  assert.ok(macSs.notes.some(function (n) { return n.indexOf('command not found') > -1; }));
  assert.equal(judge(task, 'ss -ltnp', 'linux').score, 100);

  const dns = findTask('network.dns-resolve');
  assert.equal(judge(dns, 'dscacheutil -q host -a name example.com', 'darwin').score, 100);
  assert.ok(judge(dns, 'getent hosts example.com', 'darwin').score < 100, 'macOS 没有 getent');
  assert.equal(judge(dns, 'getent hosts example.com', 'linux').score, 100);

  assert.equal(judge(findTask('network.port-reachable'), 'nc -z -v -w 2 127.0.0.1 8080', 'darwin').score, 100);
  assert.equal(judge(findTask('network.http-status'), "curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:8080/health", 'linux').score, 100);
  assert.ok(judge(findTask('network.http-status'), 'curl -I http://localhost:8080/health', 'linux').score < 100);
});

test('Kubernetes：多命名空间、跟随日志、安全操作', function () {
  assert.equal(judge(findTask('k8s.get-pods-wide'), 'kubectl get pods -A -o wide', 'darwin').score, 100);
  assert.ok(judge(findTask('k8s.get-pods-wide'), 'kubectl get pods', 'darwin').score < 100);
  assert.equal(judge(findTask('k8s.logs-follow'), 'kubectl logs -f deploy/web --tail=100', 'linux').score, 100);
  assert.equal(judge(findTask('k8s.exec-shell'), 'kubectl exec -it web-0 -- sh', 'linux').score, 100);
  assert.ok(judge(findTask('k8s.exec-shell'), 'kubectl run -it web-0 -- sh', 'linux').score < 100);
  assert.equal(judge(findTask('k8s.port-forward'), 'kubectl port-forward svc/web 8080:80', 'darwin').score, 100);
  assert.equal(judge(findTask('k8s.rollout-status'), 'kubectl rollout status deploy/web', 'darwin').score, 100);
  assert.equal(judge(findTask('k8s.apply-dry-run'), 'kubectl apply -f deploy.yaml --dry-run=client -o yaml', 'darwin').score, 100);
  assert.equal(judge(findTask('k8s.context-switch'), 'kubectl config use-context prod && kubectl config current-context', 'darwin').score, 100);

  const del = judge(findTask('k8s.delete-one-pod'), 'kubectl delete pod web-0', 'linux');
  assert.equal(del.score, 100);
  assert.equal(del.pass, true);
  const dangerous = judge(findTask('k8s.delete-one-pod'), 'kubectl delete pods --all', 'linux');
  assert.equal(dangerous.blocked, true, '删全部 Pod 必须被阻断');
  assert.equal(dangerous.verdict, '未通过');
});

test('Kubernetes 只读命令进入白名单，写操作仍被拦住', function () {
  ['kubectl version --client', 'kubectl config get-contexts', 'kubectl config current-context', 'kubectl get ns', 'kubectl get pods -A', 'kubectl get pods -A -o wide', 'kubectl get nodes'].forEach(function (cmd) {
    assert.equal(isAllowed(cmd), true, cmd + ' 应被放行');
  });
  ['kubectl delete pod web-0', 'kubectl apply -f deploy.yaml', 'kubectl get pods && rm -rf /', 'kubectl exec -it web-0 -- sh', 'kubectl get secrets', 'kubectl cluster-info'].forEach(function (cmd) {
    assert.equal(isAllowed(cmd), false, cmd + ' 必须被拦住');
  });
});

test('失败诊断把英文报错翻成人话', function () {
  const kube = diagnoseOutput('The connection to the server 127.0.0.1:6443 was refused - did you specify the right host or port?');
  assert.match(kube, /连不上集群/);
  assert.match(diagnoseOutput('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'), /守护进程/);
  assert.match(diagnoseOutput('sh: ss: command not found'), /没有这个命令/);
  assert.match(diagnoseOutput('Unable to find image \'alpine:3.20\' locally'), /镜像不可用/);
  assert.match(diagnoseOutput('Error from server (Forbidden): pods is forbidden'), /权限不足/);
  assert.equal(diagnoseOutput('一切正常'), null);
});

test('每道 k8s 题都绑定了只读验证项', function () {
  const k8sTasks = TASKS.filter(function (task) { return task.track === 'k8s'; });
  assert.equal(k8sTasks.length, EXPECT.byTrack.k8s);
  k8sTasks.forEach(function (task) {
    assert.ok(task.verify, task.id + ' 应绑定验证项');
    assert.equal(isAllowed(task.verify.cmd), true, task.id + ' 的验证命令必须在白名单内');
  });
});

test('Linux 运维包：打包、批量、同步、密钥权限', function () {
  assert.equal(judge(findTask('linux.tar-exclude'), "tar --exclude='node_modules' --exclude='*.log' -czf app.tar.gz .", 'darwin').score, 100);
  assert.ok(judge(findTask('linux.tar-exclude'), 'tar -czf app.tar.gz .', 'darwin').score < 100, '没排除规则不算通过');
  const tarDanger = judge(findTask('linux.tar-exclude'), "tar --exclude='*.log' -czf app.tar.gz . && rm -rf build", 'darwin');
  assert.equal(tarDanger.blocked, true, '打包命令里夹 rm -rf 必须阻断');

  assert.equal(judge(findTask('linux.find-exec-batch'), "find . -name '*.sh' -exec chmod +x {} +", 'linux').score, 100);
  assert.ok(judge(findTask('linux.find-exec-batch'), "find . -name '*.sh' -exec chmod 777 {} \\;", 'linux').score < 100, '777 应被点名');

  assert.equal(judge(findTask('linux.xargs-parallel'), "find . -name '*.log' -print0 | xargs -0 -n 1 -P 4 gzip", 'linux').score, 100);
  assert.equal(judge(findTask('linux.rsync-incremental'), 'rsync -avz --progress ./site/ deploy@web1:/var/www/site/', 'darwin').score, 100);
  const rsyncDelete = judge(findTask('linux.rsync-incremental'), 'rsync -avz --delete ./site/ deploy@web1:/var/www/site/', 'darwin');
  assert.equal(rsyncDelete.blocked, true, '--delete 必须阻断');

  assert.equal(judge(findTask('linux.ssh-key-permission'), 'chmod 600 ~/.ssh/id_ed25519 && chmod 700 ~/.ssh', 'darwin').score, 100);
  assert.ok(judge(findTask('linux.ssh-key-permission'), 'chmod 777 ~/.ssh/id_ed25519', 'darwin').score < 100);

  // BSD/GNU 变体：删行的 sed 写法
  const sedDelete = findTask('linux.sed-delete-lines');
  assert.equal(judge(sedDelete, "sed -i '' '/^debug/d' app.conf", 'darwin').score, 100);
  assert.equal(judge(sedDelete, "sed -i '/^debug/d' app.conf", 'linux').score, 100);
  assert.ok(judge(sedDelete, "sed -i '/^debug/d' app.conf", 'darwin').score < 100, 'macOS 上不带空后缀应判错');
});

test('Docker 运维包：多阶段、健康检查、清理与限制', function () {
  const multi = judge(findTask('docker.multistage-build'),
    ['FROM node:20 AS build', 'COPY --from=build /app/dist /usr/share/nginx/html', 'docker build -t app:1.0 .'].join(' '), 'darwin');
  assert.equal(multi.score, 100);
  assert.equal(judge(findTask('docker.healthcheck'), 'HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD curl -fsS http://localhost/healthz', 'darwin').score, 100);
  assert.equal(judge(findTask('docker.restart-policy'), 'docker run -d --name web --restart on-failure:5 -p 8080:80 nginx:1.25', 'linux').score, 100);
  assert.ok(judge(findTask('docker.restart-policy'), 'docker run -d --name web --restart always nginx:1.25', 'linux').score < 100, 'always 无上限应被点名');
  assert.equal(judge(findTask('docker.logs-since'), 'docker logs --since 10m -t web', 'darwin').score, 100);
  assert.equal(judge(findTask('docker.inspect-resources'), "docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' web", 'darwin').score, 100);
  const pruneDanger = judge(findTask('docker.cleanup-images'), 'docker image prune -f --volumes', 'darwin');
  assert.equal(pruneDanger.blocked, true, '清理镜像时带 --volumes 必须阻断');
});

test('Git 救场包：reflog、cherry-pick、bisect、强推安全', function () {
  assert.equal(judge(findTask('git.reflog-rescue'), 'git reflog && git branch rescue HEAD@{1}', 'darwin').score, 100);
  const hard = judge(findTask('git.reflog-rescue'), 'git reflog && git reset --hard HEAD@{1}', 'darwin');
  assert.equal(hard.blocked, true, '救场时用 reset --hard 必须阻断');
  assert.equal(judge(findTask('git.cherry-pick'), 'git cherry-pick a1b2c3d && git cherry-pick --abort', 'linux').score, 100);
  assert.equal(judge(findTask('git.bisect'), 'git bisect start && git bisect bad && git bisect good v1.2.0 && git bisect reset', 'darwin').score, 100);
  assert.equal(judge(findTask('git.worktree'), 'git worktree add ../hotfix hotfix', 'darwin').score, 100);
  assert.equal(judge(findTask('git.rebase-squash'), 'git rebase -i HEAD~3  # 把后两行改成 squash', 'darwin').score, 100);
  assert.equal(judge(findTask('git.delete-merged-branch'), 'git branch -d feature/report', 'linux').score, 100);
  const forceDelete = judge(findTask('git.delete-merged-branch'), 'git branch -D feature/report', 'linux');
  assert.equal(forceDelete.blocked, true, '-D 强制删除必须阻断');

  const lease = judge(findTask('git.push-force-with-lease'), 'git push --force-with-lease origin feature/report', 'darwin');
  assert.equal(lease.score, 100);
  const plainForce = judge(findTask('git.push-force-with-lease'), 'git push --force origin feature/report', 'darwin');
  assert.equal(plainForce.blocked, true, '裸 --force 必须阻断');
  const shortForce = judge(findTask('git.push-force-with-lease'), 'git push -f origin feature/report', 'darwin');
  assert.equal(shortForce.blocked, true, '-f 同样必须阻断');
});

test('Shell 包：macOS 的 bash 3.2 不支持 bash 4 语法（实测 bad substitution）', function () {
  const lower = findTask('shell.lowercase-var');
  assert.equal(judge(lower, 'printf \'%s\n\' "$name" | tr \'[:upper:]\' \'[:lower:]\'', 'darwin').score, 100);
  const macExt = judge(lower, 'printf \'%s\n\' "${name,,}"', 'darwin');
  assert.ok(macExt.score < 100);
  assert.ok(macExt.notes.some(function (n) { return n.indexOf('bad substitution') > -1; }));
  assert.equal(judge(lower, 'printf \'%s\n\' "${name,,}"', 'linux').score, 100);

  const assoc = findTask('shell.assoc-array');
  assert.equal(judge(assoc, "awk '{count[$1]++} END {for (k in count) print k, count[k]}' access.log", 'darwin').score, 100);
  const macAssoc = judge(assoc, 'declare -A count; while read -r key rest; do count[$key]=$((count[$key]+1)); done < access.log', 'darwin');
  assert.ok(macAssoc.score < 100);
  assert.ok(macAssoc.notes.some(function (n) { return n.indexOf('关联数组') > -1; }));
  assert.equal(judge(assoc, 'declare -A count; for k in "${!count[@]}"; do echo "$k"; done < access.log', 'linux').score, 100);

  const readLines = findTask('shell.read-lines');
  assert.equal(judge(readLines, 'mapfile -t lines < hosts.txt', 'linux').score, 100);
  const macMapfile = judge(readLines, 'mapfile -t lines < hosts.txt', 'darwin');
  assert.ok(macMapfile.score < 100);
  assert.ok(macMapfile.notes.some(function (n) { return n.indexOf('mapfile') > -1; }));
  assert.equal(judge(readLines, 'lines=(); while IFS= read -r line; do lines+=("$line"); done < hosts.txt', 'darwin').score, 100);
});

test('Shell 包：严格模式、trap 清理、参数校验、here-doc', function () {
  assert.equal(judge(findTask('shell.strict-mode'), 'set -euo pipefail', 'darwin').score, 100);
  assert.ok(judge(findTask('shell.strict-mode'), 'set -e', 'darwin').score < 100, '只写 -e 不够');

  assert.equal(judge(findTask('shell.trap-cleanup'), 'tmp=$(mktemp) && trap \'rm -f "$tmp"\' EXIT', 'linux').score, 100);
  const trapDanger = judge(findTask('shell.trap-cleanup'), "tmp=$(mktemp) && trap 'rm -rf /' EXIT", 'linux');
  assert.equal(trapDanger.blocked, true, '清理动作删根目录必须阻断');

  const args = judge(findTask('shell.args-guard'), 'if [ $# -lt 1 ]; then echo "用法: $0 <file>" >&2; exit 1; fi', 'darwin');
  assert.equal(args.score, 100);
  assert.ok(judge(findTask('shell.args-guard'), 'echo "用法: $0 <file>"', 'darwin').score < 100, '没有退出码与非零判断');

  const heredoc = judge(findTask('shell.heredoc-quoted'), 'cat > app.conf <<\'EOF\'\npath=$HOME/app\nEOF', 'linux');
  assert.equal(heredoc.score, 100);
  assert.ok(judge(findTask('shell.heredoc-quoted'), 'cat > app.conf <<EOF\npath=$HOME/app\nEOF', 'linux').score < 100, '分隔符没加引号会展开变量');
});

test('Compose 包：profiles、健康依赖、扩缩容与安全清理', function () {
  assert.equal(judge(findTask('compose.profiles'), 'services: adminer: { image: adminer, profiles: [debug] } && docker compose --profile debug up -d', 'darwin').score, 100);
  assert.equal(judge(findTask('compose.depends-on-healthy'), 'services: web: { depends_on: { db: { condition: service_healthy } } }', 'linux').score, 100);
  assert.equal(judge(findTask('compose.scale'), 'docker compose up -d --scale web=3  # 固定端口会冲突', 'linux').score, 100);
  assert.equal(judge(findTask('compose.config-validate'), 'docker compose config -q && docker compose config --services', 'darwin').score, 100);
  assert.ok(judge(findTask('compose.config-validate'), 'docker compose up -d', 'darwin').score < 100, '校验题不该启动容器');
  assert.equal(judge(findTask('compose.ps-format'), 'docker compose ps --format json', 'darwin').score, 100);
  assert.equal(judge(findTask('compose.env-file'), 'services: web: { env_file: [.env.production] }', 'linux').score, 100);
  assert.ok(judge(findTask('compose.env-file'), 'services: web: { environment: [PASSWORD=123] }', 'linux').score < 100, '明文密码应被点名');

  const down = judge(findTask('compose.down-keep-volumes'), 'docker compose down', 'darwin');
  assert.equal(down.score, 100);
  const downV = judge(findTask('compose.down-keep-volumes'), 'docker compose down -v', 'darwin');
  assert.equal(downV.blocked, true, 'down -v 会删数据卷，必须阻断');
});

test('系统包：CPU/内存/端口/剪贴板/打开文件 在 macOS 与 Linux 上写法互不通用', function () {
  // 这些差异都在本机实测过：macOS 上没有 nproc / free / /proc/cpuinfo，也没有 xdg-open、xclip
  const cpu = findTask('system.cpu-count');
  assert.equal(judge(cpu, 'sysctl -n hw.ncpu', 'darwin').score, 100);
  assert.equal(judge(cpu, 'nproc', 'linux').score, 100);
  const macNproc = judge(cpu, 'nproc', 'darwin');
  assert.ok(macNproc.score < 100);
  assert.ok(macNproc.notes.some(function (n) { return n.indexOf('nproc') > -1; }));
  assert.ok(judge(cpu, 'sysctl -n hw.ncpu', 'linux').score < 100, 'Linux 没有 hw.ncpu');

  const mem = findTask('system.memory-usage');
  assert.equal(judge(mem, 'top -l 1 | grep PhysMem', 'darwin').score, 100);
  const macFree = judge(mem, 'free -h', 'darwin');
  assert.ok(macFree.score < 100);
  assert.ok(macFree.notes.some(function (n) { return n.indexOf('free') > -1; }));
  assert.equal(judge(mem, 'free -h', 'linux').score, 100);

  const total = findTask('system.total-memory');
  assert.equal(judge(total, 'sysctl -n hw.memsize', 'darwin').score, 100);
  assert.equal(judge(total, 'grep MemTotal /proc/meminfo', 'linux').score, 100);
  assert.ok(judge(total, 'grep MemTotal /proc/meminfo', 'darwin').score < 100, 'macOS 没有 /proc');

  const openCmd = findTask('system.open-path');
  assert.equal(judge(openCmd, 'open report.html', 'darwin').score, 100);
  assert.equal(judge(openCmd, 'xdg-open report.html', 'linux').score, 100);
  assert.ok(judge(openCmd, 'xdg-open report.html', 'darwin').score < 100, 'macOS 没有 xdg-open');
  assert.ok(judge(openCmd, 'open report.html', 'linux').score < 100, 'Linux 上不该用 macOS 的 open');

  const clip = findTask('system.clipboard-copy');
  assert.equal(judge(clip, 'uname -a | pbcopy', 'darwin').score, 100);
  assert.equal(judge(clip, 'uname -a | xclip -selection clipboard', 'linux').score, 100);
  assert.ok(judge(clip, 'uname -a | pbcopy', 'linux').score < 100);

  const port = findTask('system.port-owner');
  assert.equal(judge(port, 'lsof -nP -iTCP:8080 -sTCP:LISTEN', 'darwin').score, 100);
  assert.equal(judge(port, "ss -ltnp 'sport = :8080'", 'linux').score, 100);
  assert.ok(judge(port, 'ss -ltnp', 'darwin').score < 100, 'macOS 没有 ss');
  assert.ok(judge(port, 'lsof -i :8080', 'linux').score < 100, 'Linux 优先用 ss');

  const topCmd = findTask('system.top-snapshot');
  assert.equal(judge(topCmd, 'top -l 1 -o cpu -n 5', 'darwin').score, 100);
  assert.equal(judge(topCmd, 'top -bn1 | head -20', 'linux').score, 100);
  assert.ok(judge(topCmd, 'top -bn1 | head -20', 'darwin').score < 100, 'macOS 的 top 没有 -b');
  assert.ok(judge(topCmd, 'top -l 1', 'linux').score < 100, 'Linux 的 top 没有 -l');
});

test('新增只读命令进入白名单，破坏性命令仍被挡住', function () {
  ['git --version', 'docker volume ls', 'docker network ls', 'docker info'].forEach(function (cmd) {
    assert.equal(isAllowed(cmd), true, cmd + ' 应被放行');
  });
  ['git commit --amend', 'docker volume rm redis-data', 'docker network rm mynet', 'git --version && rm -rf /'].forEach(function (cmd) {
    assert.equal(isAllowed(cmd), false, cmd + ' 必须被拦住');
  });
});
