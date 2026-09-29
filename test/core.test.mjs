import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, findTask } from '../src/core/tasks.mjs';
import { judge, resolveTask, platformBlocker, normalize, expandShortFlags, ruleMatches, ruleFlags } from '../src/core/judge.mjs';
import { detectPlatform, getProfile } from '../src/core/platform.mjs';
import { isAllowed, runVerify, assessOutput } from '../src/core/exec.mjs';
import { parseArgs } from '../src/core/args.mjs';

test('参数解析：--key value 与 --key=value 都不污染命令正文', function () {
  const spaced = parseArgs(['check', 'docker.run-web', 'docker run -d nginx', '--client', 'mac-air', '--platform', 'darwin'], ['client', 'platform']);
  assert.equal(spaced.client, 'mac-air');
  assert.equal(spaced.platform, 'darwin');
  assert.deepEqual(spaced._, ['check', 'docker.run-web', 'docker run -d nginx']);
  const eq = parseArgs(['verify', 'linux.date-offset', '--run', '--platform=linux'], ['client', 'platform']);
  assert.equal(eq.platform, 'linux');
  assert.equal(eq.run, true);
  assert.deepEqual(eq._, ['verify', 'linux.date-offset']);

  const valueFlags = ['client', 'platform', 'track', 'hours', 'runner', 'endpoint', 'token', 'image'];
  const hours = parseArgs(['plan', '--hours', '2'], valueFlags);
  assert.equal(hours.hours, '2');
  assert.deepEqual(hours._, ['plan']);
  const unknown = parseArgs(['plan', '--wat', '2'], valueFlags);
  assert.equal(unknown.wat, true, '未声明的键不应吞掉下一个 token');
  assert.deepEqual(unknown._, ['plan', '2']);
});

test('题库完整性：id 唯一、要素齐全、验证项在白名单内', function () {
  const ids = new Set();
  TASKS.forEach(function (task) {
    assert.ok(task.id && task.title && task.track, '任务缺少 id/title/track');
    assert.ok(!ids.has(task.id), '重复的任务 id: ' + task.id);
    ids.add(task.id);
    assert.ok((task.require || []).length > 0 || task.variants, '任务缺少评测要素: ' + task.id);
    if (task.verify) assert.ok(isAllowed(task.verify.cmd), 'verify 命令不在只读白名单: ' + task.verify.cmd);
    Object.keys(task.variants || {}).forEach(function (key) {
      const variant = task.variants[key];
      assert.ok((variant.require || []).length > 0, '平台变体缺少要素: ' + task.id + '/' + key);
      if (variant.verify) assert.ok(isAllowed(variant.verify.cmd), '变体 verify 不在白名单: ' + variant.verify.cmd);
    });
  });
});

test('macOS 平台变体：BSD sed 空后缀才算通过', function () {
  const task = findTask('linux.sed-inplace');
  const bsd = judge(task, "sed -i '' 's/foo/bar/g' a.txt", 'darwin');
  assert.equal(bsd.score, 100);
  assert.equal(bsd.verdict, '通过');
  assert.equal(bsd.pass, true);
});

test('同一份答案在 Linux 上会被判定为写法错误', function () {
  const task = findTask('linux.sed-inplace');
  const linux = judge(task, "sed -i '' 's/foo/bar/g' a.txt", 'linux');
  assert.ok(linux.score < 100, 'GNU sed 不应接受空备份后缀');
  assert.ok(linux.notes.length > 0);
  const good = judge(task, "sed -i 's/foo/bar/g' a.txt", 'linux');
  assert.equal(good.score, 100);
});

test('BSD date 的 -v 与 GNU date 的 -d 互不通用', function () {
  const task = findTask('linux.date-offset');
  assert.equal(judge(task, "date -v+1d '+%Y-%m-%d'", 'darwin').score, 100);
  assert.ok(judge(task, "date -d '+1 day' '+%Y-%m-%d'", 'darwin').score < 100);
  assert.equal(judge(task, "date -d '+1 day' '+%Y-%m-%d'", 'linux').score, 100);
  assert.ok(judge(task, "date -v+1d '+%Y-%m-%d'", 'linux').score < 100);
});

test('平台变体会覆盖验证命令', function () {
  const resolved = resolveTask(findTask('linux.date-offset'), 'linux');
  assert.match(resolved.verify.cmd, /-d/);
  const mac = resolveTask(findTask('linux.date-offset'), 'darwin');
  assert.match(mac.verify.cmd, /-v\+1d/);
});

// platforms 声明决定「这道题在哪个平台上算数」。判定照常给分（走兜底规则），
// 但要把 supported=false 说出去，客户端才能提示，而不是让学员怀疑自己的写法。
test('resolveTask 带出 supported 与 taskPlatforms', function () {
  const task = findTask('service.launchctl-list');
  assert.equal(resolveTask(task, 'darwin').supported, true);
  assert.equal(resolveTask(task, 'linux').supported, true);
  const win = resolveTask(task, 'win32');
  assert.equal(win.supported, false);
  assert.deepEqual(win.taskPlatforms, ['darwin', 'linux']);
  // 不适用的平台必须被拦住：兜底规则可能是本平台不存在的命令（Windows 上判 launchctl）
  assert.match(platformBlocker(win), /只在 darwin \/ linux 上有参考答案/);
  assert.equal(platformBlocker(resolveTask(task, 'darwin')), null, '适用平台不拦');
  assert.equal(platformBlocker(resolveTask(findTask('docker.run-web'), 'win32')), null);

  const plain = resolveTask(findTask('docker.run-web'), 'win32');
  assert.equal(plain.supported, true, '没声明 platforms 的题在任何平台都算数');
  assert.equal(plain.taskPlatforms, null);
});
test('Compose v1 写法既缺要素又命中禁止项', function () {
  const task = findTask('docker.compose-v2');
  const v1 = judge(task, 'docker-compose up -d --build', 'darwin');
  assert.ok(v1.score < 60, 'v1 写法不应及格，实际 ' + v1.score);
  assert.equal(v1.verdict, '未通过');
  assert.equal(v1.score, 37); // 3 个要素命中 2 个 = 67 分，命中禁止项再扣 30 分
  assert.ok(v1.notes[0].indexOf('v1') > -1);
  assert.equal(judge(task, 'docker compose up -d --build', 'darwin').score, 100);
});

test('空答案与缺要素分别给出未作答和缺失提示', function () {
  const task = findTask('docker.run-web');
  assert.equal(judge(task, '', 'darwin').verdict, '未作答');
  const partial = judge(task, 'docker run nginx', 'darwin');
  assert.ok(partial.score > 0 && partial.score < 100);
  assert.equal(partial.verdict, '未通过');
  assert.ok(partial.missing.length >= 3);
  assert.equal(judge(task, 'docker run -d -p 8080:80 --name web nginx:1.25', 'darwin').score, 100);
});

test('判定反馈要给出"已命中的片段"，而不是重复缺失文案', function () {
  const task = findTask('docker.run-web');
  const full = judge(task, 'docker run -d -p 8080:80 --name web nginx:1.25', 'darwin');
  assert.equal(full.matched.length, full.required, '满分时全部要素都应算命中');
  assert.deepEqual(full.matched, ['docker run', '-d', '-p 8080:80', '--name web', 'nginx'], '应回报实际命中的片段：' + JSON.stringify(full.matched));
  assert.equal(full.missing.length, 0);
  assert.equal(full.tips, '关键要素齐全');

  const almost = judge(task, 'docker run -d --name web nginx:1.25', 'darwin');
  assert.equal(almost.matched.length, almost.required - 1);
  assert.ok(almost.matched.indexOf('--name web') > -1, '命中的写法要原样回给学员');
  assert.equal(almost.missing.length, 1);
  assert.match(almost.tips, /^就差 1 项：/, '只差一项时措辞要更友好：' + almost.tips);

  const many = judge(task, 'docker run nginx', 'darwin');
  assert.ok(many.missing.length > 1);
  assert.equal(many.tips.indexOf('就差 1 项'), -1, '缺多项时不要用"就差 1 项"');
});

test('normalize 折叠空白，避免多空格误判', function () {
  assert.equal(normalize('  docker   run \n -d '), 'docker run -d');
});

test('短选项展开只作用于字母簇，不动数字与长选项', function () {
  // 字母簇后面跟取值时，取值绑在最后一个字母上：grep -Eo x 等价于 -E -o x
  assert.equal(expandShortFlags('grep -Eo x'), 'grep -Eo x -E -o -o x');
  assert.equal(expandShortFlags('head -3 x'), 'head -3 x');
  assert.equal(expandShortFlags('ls --color x'), 'ls --color x');
  assert.equal(expandShortFlags('sort -rh'), 'sort -rh -r -h');
  // 簇后面跟取值时，取值属于最后一个字母：-rwc 10 等价于 -r -w -c 10
  assert.equal(expandShortFlags('mtr -rwc 10 8.8.8.8'), 'mtr -rwc 10 8.8.8.8 -r -w -c -c 10');
  assert.equal(expandShortFlags('tcpdump -nni eth0'), 'tcpdump -nni eth0 -n -n -i -i eth0');
  assert.equal(expandShortFlags('docker run -d x'), 'docker run -d x');
  // 字母+数字的混合簇：top -bn1 等价于 -b -n1，必须能被"-n1"规则命中
  assert.equal(expandShortFlags('top -bn1 | head'), 'top -bn1 | head -b -n -n1');
  // 单字母+数字通常就是"flag + 取值"（-n1、-l1），不展开，避免自己造出假命中
  assert.equal(expandShortFlags('ls -l1'), 'ls -l1');
  assert.equal(expandShortFlags('top -n 1'), 'top -n 1');
  assert.equal(expandShortFlags('head -20'), 'head -20');
});

test('只读白名单挡住破坏性命令', async function () {
  assert.equal(isAllowed('rm -rf /'), false);
  assert.equal(isAllowed('docker context ls'), true);
  assert.equal(isAllowed('docker version && rm -rf /'), false);
  assert.equal(isAllowed('docker ps'), true);
  const blocked = await runVerify({ verify: { cmd: 'rm -rf /', expect: '.*' } }, { run: true });
  assert.equal(blocked.ran, false);
  assert.match(blocked.reason, /白名单/);
});

test('默认 dry-run，不执行任何命令', async function () {
  const result = await runVerify({ verify: { cmd: 'docker context ls', expect: 'NAME' } }, { run: false });
  assert.equal(result.ran, false);
  assert.equal(result.dryRun, true);
});

test('退出码 0 但有错误输出时判定为失败（kubectl 连不上集群就是这个形态）', function () {
  const kube = assessOutput(0, 'E0925 memcache.go:265] err="couldn\'t get current server API group list: dial tcp 127.0.0.1:6443: connect: connection refused"');
  assert.equal(kube.ok, false);
  assert.match(kube.reason, /退出码是 0，但输出里是错误信息/);
  assert.match(kube.advice, /连不上集群/);

  const badExit = assessOutput(127, 'sh: ss: command not found');
  assert.equal(badExit.ok, false);
  assert.match(badExit.reason, /非零退出（exit 127）/);
  assert.match(badExit.advice, /没有这个命令/);

  const good = assessOutput(0, 'Darwin');
  assert.equal(good.ok, true);
  assert.equal(good.advice, undefined);
});

test('规则大小写：写了大写就敏感，没写就不敏感', function () {
  // git branch -D 是强删，绝不能被 -d 规则误命中
  assert.equal(ruleMatches('git\\s+branch\\s+-D', 'git branch -D feature/x'), true);
  assert.equal(ruleMatches('git\\s+branch\\s+-D', 'git branch -d feature/x'), false, '-D 规则不应命中 -d');
  assert.equal(ruleMatches('git\\s+branch\\s+-d', 'git branch -d feature/x'), true);
  assert.equal(ruleMatches('docker\\s+run', 'Docker run -d nginx'), true, '全小写规则保持忽略大小写');
  assert.equal(ruleMatches('HEALTHCHECK', 'healthcheck --interval=30s'), false, '写了大写就按大小写敏感');
});

test('平台识别与兜底', function () {
  assert.equal(detectPlatform('darwin'), 'darwin');
  assert.equal(detectPlatform('linux'), 'linux');
  assert.equal(detectPlatform('plan9'), 'generic');
  assert.equal(getProfile('nothing').name, '通用');
});
