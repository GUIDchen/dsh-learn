// CLI 客户端集成测试：真的把进程拉起来跑，验证退出码、输出与落盘结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECT } from './expected.mjs';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOME = mkdtempSync(join(tmpdir(), 'dsh-learn-cli-'));

function cli(args, extraEnv) {
  const env = Object.assign({}, process.env, { DSH_LEARN_HOME: HOME }, extraEnv || {});
  return spawnSync(process.execPath, [join(ROOT, 'src/cli.mjs')].concat(args), { cwd: ROOT, encoding: 'utf8', env: env });
}

test('list --json 输出可解析的题库结构', function () {
  const result = cli(['list', '--json']);
  assert.equal(result.status, 0);
  const tasks = JSON.parse(result.stdout);
  assert.equal(tasks.length, EXPECT.tasks);
  assert.ok(tasks.every(function (task) { return task.id && task.track && task.require > 0; }));
});

test('check 三档判定分别落到未通过 / 部分通过 / 通过', function () {
  const bad = cli(['check', 'docker.run-web', 'docker run nginx', '--client', 'cli-test']);
  assert.match(bad.stdout, /未通过/);
  const partial = cli(['check', 'docker.compose-v2', 'docker-compose up -d --build', '--client', 'cli-test']);
  assert.match(partial.stdout, /未通过/);
  const good = cli(['check', 'docker.run-web', 'docker run -d -p 8080:80 --name web nginx:1.25', '--client', 'cli-test', '--json']);
  assert.equal(JSON.parse(good.stdout).verdict, '通过');
});

test('平台变体在 CLI 上同样生效', function () {
  const mac = cli(['check', 'linux.stat-size', "stat -c '%s' a.txt", '--platform', 'darwin', '--json']);
  const linux = cli(['check', 'linux.stat-size', "stat -c '%s' a.txt", '--platform', 'linux', '--json']);
  assert.equal(JSON.parse(mac.stdout).score, 3);
  assert.equal(JSON.parse(linux.stdout).score, 100);
});

test('plan / progress / board 输出结构正确', function () {
  const plan = JSON.parse(cli(['plan', '--hours', '1', '--track', 'git', '--json']).stdout);
  assert.equal(plan.taskCount, EXPECT.byTrack.git);
  assert.ok(plan.days.length >= 1);
  assert.equal(plan.budgetMinutes, 60);

  const progress = JSON.parse(cli(['progress', '--json']).stdout);
  assert.equal(progress.total, EXPECT.tasks);
  assert.ok(progress.passed >= 1);

  const board = JSON.parse(cli(['board', '--json']).stdout);
  assert.ok(board.some(function (row) { return row.client === 'cli-test'; }));
});

test('export 落盘后原样 import 会被去重', function () {
  const file = join(HOME, 'export.json');
  const exported = cli(['export', file]);
  assert.match(exported.stdout, /已导出/);
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(payload.version, 2, '备份带笔记与目标：版本升到 2');
  assert.ok(payload.records.length >= 4);
  assert.equal(typeof payload.notes, 'object', '备份里要有笔记表（没有也应是空对象）');
  assert.equal(typeof payload.goals, 'object', '备份里要有学习目标');

  const imported = cli(['import', file]);
  assert.match(imported.stdout, /新增 0 条，跳过重复/);
});

// 工具缺失是常态：容器里没有 docker、CI 上没有 kubectl、客户机器上没有 tcpdump。
// 这类环境下不能崩、也不能"静默成功"，要如实说明缺什么、下一步做什么。
test('缺工具的环境：不崩，且给出可执行的提示', function () {
  const nodeDir = join(process.execPath, '..');
  // 只留 node 与系统基础命令：docker 装在 /usr/local/bin、tcpdump 在 /usr/sbin，都看不见了
  const degraded = { PATH: nodeDir + ':/usr/bin:/bin' };

  const runners = cli(['runners'], degraded);
  assert.equal(runners.status, 0, 'runners 不该因为缺 docker 而失败：' + runners.stderr);
  assert.match(runners.stdout, /不可用/, '要如实报告不可用');
  assert.doesNotMatch(runners.stderr, /at .*\.mjs:\d+/, '不该抛未捕获异常');

  const verify = cli(['verify', 'docker.run-web', '--run'], degraded);
  assert.doesNotMatch(verify.stderr, /at .*\.mjs:\d+/, '验证失败也要有人话，而不是堆栈');
  const output = verify.stdout + verify.stderr;
  assert.match(output, /没有这个命令|command not found/, '要指出是缺命令：' + output.slice(0, 200));

  // 纯靠文件的命令不受影响
  const audit = cli(['audit'], degraded);
  assert.equal(audit.status, 0);
  assert.match(audit.stdout, /题库体检：\d+ 道题/);
});

// 进度目录不可写（只读挂载、权限没给对）时会怎样：**判定要给出来**，但必须说清没记上，且退出码非 0。
// 这条曾经是最坏的形态——判定算完了、记录没写进去、退出码还是 0，用户与脚本都以为一切正常。
test('进度目录不可写：判定照常给出，明确提示没记上，退出码非 0', function () {
  if (process.platform === 'win32') return;   // chmod 语义不同，跳过
  const readOnlyHome = mkdtempSync(join(tmpdir(), 'dsh-learn-readonly-'));
  writeFileSync(join(readOnlyHome, '.keep'), '');
  chmodSync(readOnlyHome, 0o500);
  try {
    const result = cli(['check', 'docker.run-web', 'docker run -d -p 8080:80 --name web nginx:1.25'], { DSH_LEARN_HOME: readOnlyHome });
    assert.notEqual(result.status, 0, '没记上就该非 0 退出，别让脚本以为成功了');
    assert.match(result.stdout, /判定：通过/, '判定结果不能因为写盘失败就吞掉：' + result.stdout.slice(0, 120));
    assert.match(result.stderr, /这次没记上/, '要明确说清没记上');
    assert.match(result.stderr, /写权限|磁盘空间/, '要给出可执行的下一步');
  } finally {
    chmodSync(readOnlyHome, 0o700);
    rmSync(readOnlyHome, { recursive: true, force: true });
  }
});

test('runners 列出三个后端且不执行任何命令', function () {
  const runners = JSON.parse(cli(['runners', '--json']).stdout);
  assert.deepEqual(runners.map(function (row) { return row.name; }), ['local', 'docker', 'remote']);
  assert.equal(runners[0].available.ok, true);
});

test('verify 默认 dry-run，加 --run 才执行白名单命令', function () {
  const dry = JSON.parse(cli(['verify', 'linux.platform-probe', '--json']).stdout);
  assert.equal(dry.ran, false);
  assert.equal(dry.dryRun, true);
  const run = JSON.parse(cli(['verify', 'linux.platform-probe', '--run', '--json']).stdout);
  if (process.platform === 'win32') {
    assert.equal(run.ran, false, 'Windows 上没有 uname，应优雅失败而不是崩溃');
  } else {
    assert.equal(run.ran, true);
    assert.equal(run.ok, true);
  }
});

test('未知任务与非法用法给出可读错误并返回非零码', function () {
  const unknown = cli(['check', 'no.such-task', 'echo hi']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /未找到任务/);
  const repl = cli(['repl']);
  assert.equal(repl.status, 2, '非 TTY 下 repl 应拒绝启动');
  assert.match(repl.stderr, /交互式终端/);
});

test('probe --json 给出平台档案与诊断结论', function () {
  const probe = JSON.parse(cli(['probe', '--json']).stdout);
  assert.ok(probe.platform);
  assert.ok(probe.profile || probe.platformName);
  assert.equal(typeof probe.diagnosis, 'string');
});

test('show / probe / daily / report / drill 在 CLI 上都有输出', function () {
  const show = cli(['show', 'docker.run-web', '--json']);
  assert.equal(show.status, 0);
  const task = JSON.parse(show.stdout);
  assert.equal(task.id, 'docker.run-web');
  assert.ok(task.require.length >= 4);
  assert.ok(task.sample, '参考答案应随 show 一起给出');

  const probe = JSON.parse(cli(['probe', '--json']).stdout);
  assert.ok(probe.platform);
  assert.equal(typeof probe.diagnosis, 'string');

  const daily = JSON.parse(cli(['daily', '--json', '--track', 'git']).stdout);
  assert.ok(daily.taskId);
  assert.equal(daily.track, 'git');
  assert.match(daily.date, /^\d{4}-\d{2}-\d{2}$/);

  const report = cli(['report']);
  assert.equal(report.status, 0);
  assert.match(report.stdout, /# dsh-learn 学习报告/);
  assert.match(report.stdout, /## 分轨道进度/);

  const reportFile = join(HOME, 'report.md');
  const written = cli(['report', '--out', reportFile]);
  assert.equal(written.status, 0);
  assert.match(readFileSync(reportFile, 'utf8'), /## 客户端排行/);

  const drill = cli(['drill', '--all', '--track', 'k8s', '--limit', '2']);
  assert.match(drill.stdout, /练习模式：全量/);
  assert.match(drill.stdout, /k8s\./);
});

test('selftest 与 pack list 可用，help 列出全部命令', function () {
  const dry = JSON.parse(cli(['selftest', '--json']).stdout);
  assert.equal(dry.ran, false);
  assert.equal(dry.dryRun, true);
  assert.ok(dry.probes.length >= 6);

  const packs = JSON.parse(cli(['pack', 'list', '--json']).stdout);
  assert.ok(packs.length >= 16, '至少 16 个内置包，实际 ' + packs.length);
  assert.ok(packs.every(function (row) { return row.id && row.track && row.tasks > 0; }));

  const help = cli(['help']);
  assert.equal(help.status, 0);
  ['check', 'daily', 'drill', 'report', 'plan', 'progress', 'selftest', 'pack', 'export', 'import', 'repl'].forEach(function (name) {
    assert.ok(help.stdout.indexOf(name) > -1, 'help 里应列出 ' + name);
  });
});

test('参数错误给出可读提示且不静默通过', function () {
  const noFile = cli(['import']);
  assert.equal(noFile.status, 2);
  assert.match(noFile.stderr, /用法/);

  const badPack = cli(['pack', 'validate']);
  assert.equal(badPack.status, 2);
  assert.match(badPack.stderr, /用法/);

  const badVerify = cli(['verify', 'no.such-task']);
  assert.equal(badVerify.status, 2);
  assert.match(badVerify.stderr, /未找到任务/);
});

test('命令表与 usage 保持同步（重构后防止漂移）', async function () {
  const { listCommands } = await import('../src/cli.mjs');
  const commands = listCommands();
  assert.ok(commands.length >= 16, '命令数应 >= 16，实际 ' + commands.length);

  const help = cli(['help']).stdout;
  commands.forEach(function (name) {
    assert.ok(help.indexOf('cli.mjs ' + name) > -1, 'usage 里应列出 ' + name);
  });

  // 反向：usage 里出现的命令都必须在命令表里注册
  const mentioned = new Set();
  help.split('\n').forEach(function (line) {
    const match = line.match(/cli\.mjs ([a-z][a-z-]*)/);
    if (match) mentioned.add(match[1]);
  });
  mentioned.forEach(function (name) {
    assert.ok(commands.indexOf(name) > -1, 'usage 里的 ' + name + ' 未在命令表注册');
  });
});

test('未知命令给出提示并以非零码退出', function () {
  const result = cli(['no-such-command']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /未知命令/);
  assert.match(result.stdout, /用法：/);
});

test('review / goal / note 三个学习命令可用', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-learn-cli-learn-'));
  cli(['check', 'linux.sed-inplace', "sed -i 's/foo/bar/g' a.txt", '--platform', 'darwin', '--client', 'learn-demo'], { DSH_LEARN_HOME: home });

  const review = cli(['review', '--json'], { DSH_LEARN_HOME: home });
  assert.equal(review.status, 0);
  const queue = JSON.parse(review.stdout);
  assert.equal(typeof queue.due.length, 'number');
  assert.ok(queue.upcoming.length >= 1, '刚练过的题应出现在之后到期里');
  assert.ok(queue.upcoming[0].dueAt);
  assert.match(cli(['review'], { DSH_LEARN_HOME: home }).stdout, /该复习/);

  const setGoal = cli(['goal', 'set', '--tasks=2', '--minutes=15'], { DSH_LEARN_HOME: home });
  assert.equal(setGoal.status, 0);
  assert.match(setGoal.stdout, /每天 2 题/);
  const showGoal = JSON.parse(cli(['goal', '--json'], { DSH_LEARN_HOME: home }).stdout);
  assert.equal(showGoal.goal.dailyTasks, 2);
  assert.equal(showGoal.progress.date.length, 10);
  assert.match(cli(['goal'], { DSH_LEARN_HOME: home }).stdout, /今日进度/);
  assert.equal(cli(['goal', 'nonsense'], { DSH_LEARN_HOME: home }).status, 2);

  const writeNote = cli(['note', 'linux.sed-inplace', 'BSD 要空后缀'], { DSH_LEARN_HOME: home });
  assert.equal(writeNote.status, 0);
  assert.match(writeNote.stdout, /已记录/);
  assert.match(cli(['note', 'linux.sed-inplace'], { DSH_LEARN_HOME: home }).stdout, /BSD 要空后缀/);
  assert.match(cli(['note'], { DSH_LEARN_HOME: home }).stdout, /共 1 条笔记/);
  assert.equal(JSON.parse(cli(['note', 'linux.sed-inplace', '--json'], { DSH_LEARN_HOME: home }).stdout).text, 'BSD 要空后缀');
  assert.match(cli(['note', 'linux.sed-inplace', '--delete'], { DSH_LEARN_HOME: home }).stdout, /已删除/);

  rmSync(home, { recursive: true, force: true });
});

test('security whitelist 对账通过并给出结构化结果', function () {
  const result = cli(['security', 'whitelist', '--json']);
  assert.equal(result.status, 0, '对账应通过：' + result.stdout + result.stderr);
  const audit = JSON.parse(result.stdout);
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.blocked, []);
  assert.deepEqual(audit.leaked, []);
  assert.deepEqual(audit.unused, []);
  assert.ok(audit.entries.length >= 14);
  assert.ok(audit.entries.every(function (entry) { return entry.used; }));
  assert.ok(audit.mustStayBlocked.length >= 8);
  assert.ok(audit.mustStayBlocked.every(function (row) { return row.blocked; }), '危险命令都必须仍被拒绝');

  const text = cli(['security', 'whitelist']);
  assert.equal(text.status, 0);
  assert.match(text.stdout, /对账通过/);
  assert.match(text.stdout, /白名单条目/);

  const bad = cli(['security', 'nope']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /用法/);
});

test('进度日志有坏行时 progress 会给出提示（不静默吞掉）', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-learn-cli-broken-'));
  cli(['check', 'docker.logs-follow', 'docker logs -f web', '--client', 'warn-test'], { DSH_LEARN_HOME: home });
  writeFileSync(join(home, 'progress.ndjson'), '{"client":"x","taskId":"y"', 'utf8');
  const result = cli(['progress'], { DSH_LEARN_HOME: home });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /无法解析/);

  const asJson = JSON.parse(cli(['progress', '--json'], { DSH_LEARN_HOME: home }).stdout);
  assert.equal(asJson.storage.brokenJournalLines, 1);
  assert.ok(asJson.storage.journalPath.indexOf('progress.ndjson') > -1);
  rmSync(home, { recursive: true, force: true });
});

test('DSH_LEARN_PACKS 指定的外部包会被 CLI 加载并覆盖内置题', function () {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-learn-cli-packs-'));
  const packFile = join(dir, 'extra.json');
  writeFileSync(packFile, JSON.stringify({
    id: 'extra-pack',
    name: '外部包',
    track: 'demo',
    version: 1,
    tasks: [
      { id: 'demo.echo', track: 'demo', title: '外部新增题', goal: 'g', hint: 'h', sample: 'echo hi', require: [{ p: 'echo', tip: 'x' }] },
      { id: 'docker.logs-follow', track: 'docker', title: '覆盖后的日志题', goal: 'g', require: [{ p: 'changed', tip: '已覆盖' }] }
    ]
  }), 'utf8');

  const listed = JSON.parse(cli(['list', '--json'], { DSH_LEARN_PACKS: dir }).stdout);
  assert.ok(listed.some(function (task) { return task.id === 'demo.echo'; }), '外部包的新题应出现');
  const overridden = listed.filter(function (task) { return task.id === 'docker.logs-follow'; })[0];
  assert.equal(overridden.title, '覆盖后的日志题', '同 id 内置题应被覆盖');

  const judged = cli(['check', 'demo.echo', 'echo hi', '--client', 'cli-pack'], { DSH_LEARN_PACKS: dir });
  assert.match(judged.stdout, /通过/);

  const validated = cli(['pack', 'validate', packFile]);
  assert.equal(validated.status, 0);
  assert.match(validated.stdout, /校验通过/);

  const badDir = mkdtempSync(join(tmpdir(), 'dsh-learn-cli-badpacks-'));
  const badFile = join(badDir, 'bad.json');
  writeFileSync(badFile, JSON.stringify({ id: 'bad', track: 'demo', tasks: [{ id: 'bad.x', track: 'demo', title: 't', goal: 'g', require: [] }] }), 'utf8');
  const bad = cli(['pack', 'validate', badFile, '--json']);
  assert.equal(bad.status, 1, '坏包应返回非零码');
  assert.ok(JSON.parse(bad.stdout).errors.length > 0);

  const packList = cli(['pack', 'list', '--json'], { DSH_LEARN_PACKS: dir });
  const packs = JSON.parse(packList.stdout);
  assert.ok(packs.some(function (row) { return row.id === 'extra-pack'; }));
  assert.ok(packs.length >= 6, '内置 5 包 + 外部 1 包');

  rmSync(dir, { recursive: true, force: true });
  rmSync(badDir, { recursive: true, force: true });
});

test('题库包签名与信任门禁在 CLI 上闭环', function () {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-learn-cli-trust-'));
  const keyHome = mkdtempSync(join(tmpdir(), 'dsh-learn-cli-keyhome-'));
  const file = join(dir, 'trusted-pack.json');
  writeFileSync(file, JSON.stringify({
    id: 'trusted-pack',
    track: 'demo',
    version: 1,
    tasks: [{ id: 'demo.trust', track: 'demo', title: '信任题', goal: 'g', require: [{ p: 'echo', tip: 'x' }] }]
  }), 'utf8');

  const keygen = cli(['pack', 'keygen'], { DSH_LEARN_HOME: keyHome });
  assert.equal(keygen.status, 0);
  assert.match(keygen.stdout, /已生成/);

  const signed = cli(['pack', 'sign', file, '--signer', 'ci-bot'], { DSH_LEARN_HOME: keyHome });
  assert.equal(signed.status, 0);
  assert.match(signed.stdout, /ci-bot/);

  const verified = cli(['pack', 'verify', file], { DSH_LEARN_HOME: keyHome });
  assert.equal(verified.status, 0);
  assert.match(verified.stdout, /签名有效/);

  const trusted = cli(['pack', 'trust', file], { DSH_LEARN_HOME: keyHome });
  assert.equal(trusted.status, 0);
  assert.match(trusted.stdout, /签名已校验/);

  const listed = cli(['pack', 'trusted', '--json'], { DSH_LEARN_HOME: keyHome });
  const entries = JSON.parse(listed.stdout);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].verified, true);

  const gated = cli(['list', '--track', 'demo'], { DSH_LEARN_HOME: keyHome, DSH_LEARN_PACKS: dir, DSH_LEARN_REQUIRE_TRUST: '1' });
  assert.equal(gated.status, 0, '已信任的包应能通过门禁');

  // 篡改内容后：验签失败 + 门禁拒绝加载
  writeFileSync(file, JSON.stringify({
    id: 'trusted-pack',
    track: 'demo',
    version: 1,
    tasks: [{ id: 'demo.trust', track: 'demo', title: '被改过的题', goal: 'g', require: [{ p: 'echo', tip: 'x' }] }]
  }), 'utf8');
  assert.equal(cli(['pack', 'verify', file], { DSH_LEARN_HOME: keyHome }).status, 1);
  const blocked = cli(['list'], { DSH_LEARN_HOME: keyHome, DSH_LEARN_PACKS: dir, DSH_LEARN_REQUIRE_TRUST: '1' });
  assert.equal(blocked.status, 3, '门禁失败应以独立退出码结束');
  assert.match(blocked.stderr, /未通过信任检查/);

  rmSync(dir, { recursive: true, force: true });
  rmSync(keyHome, { recursive: true, force: true });
});

// 元数据损坏的项目：CLI 必须拒绝，退出码非 0，且原文件一字不改。
// （曾经 project add 会把坏掉的 project.json 当"没建过"直接重建，来源台账静默丢失）
// 实测踩到的：node src/agent.mjs --help 会**直接起服务**（端口被占时抛 EADDRINUSE，
// 让人以为是自己端口配错了）；网页版同样——问用法却得到一个监听中的进程。
// 这条用例用 spawnSync 判：--help 必须立刻以 0 退出并打印用法（真起了服务会一直挂到超时被杀）。
test('入口脚本的 --help 只打印用法，不启动服务', function () {
  [
    { script: 'src/agent.mjs', expect: /用法：node src\/agent\.mjs/ },
    { script: 'src/web/server.mjs', expect: /用法：node src\/web\/server\.mjs/ }
  ].forEach(function (row) {
    const result = spawnSync(process.execPath, [join(ROOT, row.script), '--help'], {
      cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { DSH_LEARN_HOME: HOME }), timeout: 8000
    });
    assert.equal(result.signal, null, row.script + ' --help 不该被超时杀掉（说明它在监听端口）：' + result.signal);
    assert.equal(result.status, 0, row.script + ' --help 应以 0 退出，实际 ' + result.status + ' ' + result.stderr);
    assert.match(result.stdout, row.expect, row.script + ' --help 要打印用法：' + result.stdout.slice(0, 120));
    assert.ok(result.stdout.indexOf('已启动') === -1, row.script + ' --help 不该打印启动横幅');
  });
});
test('project：元数据损坏时 add / init 都拒绝，不覆盖坏文件', function () {
  const name = 'broken-cli-' + Date.now();
  assert.equal(cli(['project', 'init', name]).status, 0);
  const file = join(HOME, 'projects', name, 'project.json');
  writeFileSync(file, 'not json at all');

  const added = cli(['project', 'add', name, '--text', 'docker run -d --name web nginx']);
  assert.equal(added.status, 3, '退出码要非 0，脚本才拦得住');
  assert.match(added.stderr, /不是合法 JSON|不敢覆盖/);
  assert.equal(readFileSync(file, 'utf8'), 'not json at all', '坏文件不许被覆盖');

  const reinited = cli(['project', 'init', name]);
  assert.equal(reinited.status, 3);
  assert.match(reinited.stderr, /损坏|不敢覆盖/);
  assert.equal(readFileSync(file, 'utf8'), 'not json at all', 'init 也不许覆盖');

  rmSync(join(HOME, 'projects', name), { recursive: true, force: true });
});

// 这几条补的是「入口脚本里新加的分支」——覆盖率门槛把它们标成了回归：
//   cli.mjs 的 CliError 退出路径、agent.mjs 的 --help 与「非回环必须有 token」、pack promote/validate 两个子命令。
test('入口分支：拼错选项退 2、agent 拒绝无 token 的非回环绑定', function () {
  const typo = spawnSync(process.execPath, [join(ROOT, 'src/cli.mjs'), 'list', '--levle=hard'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(typo.status, 2, '拼错的选项要以用法错误退出：' + typo.stderr);
  assert.match(typo.stderr, /不认识的选项：--levle/);

  const agentBad = spawnSync(process.execPath, [join(ROOT, 'src/agent.mjs'), '--host', '0.0.0.0', '--port', '8799'], { cwd: ROOT, encoding: 'utf8', timeout: 8000 });
  assert.equal(agentBad.status, 2, '非回环且没有 token 时应拒绝启动：' + agentBad.stderr);
  assert.match(agentBad.stderr, /必须提供 --token/);

  const agentHelp = spawnSync(process.execPath, [join(ROOT, 'src/agent.mjs'), '--help'], { cwd: ROOT, encoding: 'utf8', timeout: 8000 });
  assert.equal(agentHelp.status, 0);
  assert.match(agentHelp.stdout, /用法：node src\/agent\.mjs/);
});

test('pack promote：dry-run 不写文件，正式 promote 落到指定路径；坏包要拦', function () {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-learn-promote-'));
  const draft = {
    id: 'demo-draft', track: 'linux', version: 1,
    tasks: [{
      id: 'demo.echo', track: 'linux', title: '（草案）echo', goal: '打印一行字',
      hint: '示例：echo', sample: 'echo hi', require: [{ p: 'echo', tip: '要用 echo' }]
    }]
  };
  const file = join(dir, 'draft.json');
  writeFileSync(file, JSON.stringify(draft), 'utf8');
  const out = join(dir, 'promoted.json');

  const dry = cli(['pack', 'promote', file, '--into=' + out, '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /没有写文件/);
  assert.equal(existsSync(out), false, 'dry-run 不该写文件');

  const real = cli(['pack', 'promote', file, '--into=' + out]);
  assert.equal(real.status, 0, real.stderr);
  assert.equal(existsSync(out), true, '正式 promote 要落盘');
  assert.match(real.stdout, /下一步/);

  const badFile = join(dir, 'bad.json');
  writeFileSync(badFile, JSON.stringify({ id: 'bad', track: 'linux', version: 1, tasks: [{ id: 'bad.x', track: 'linux', title: 'x', goal: 'g', sample: 'echo hi' }] }), 'utf8');
  const bad = cli(['pack', 'validate', badFile]);
  assert.notEqual(bad.status, 0, '坏包应校验失败');
  rmSync(dir, { recursive: true, force: true });
});
test.after(function () {
  rmSync(HOME, { recursive: true, force: true });
});
