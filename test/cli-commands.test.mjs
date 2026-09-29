// 命令处理函数的进程内测试：直接用构造好的 ctx 调用 handler，捕获输出。
// 好处是快、精确、能覆盖子进程测试摸不到的分支（--json、参数错误、空数据等）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECT } from './expected.mjs';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-learn-cli-cmd-'));
process.env.DSH_LEARN_HOME = HOME;

const { createContext, unknownFlags, USAGE_LINES } = await import('../src/cli/context.mjs');
const tasksCmd = await import('../src/cli/commands/tasks.mjs');
const learnCmd = await import('../src/cli/commands/learn.mjs');
const storeCmd = await import('../src/cli/commands/store.mjs');
const verifyCmd = await import('../src/cli/commands/verify.mjs');
const packsCmd = await import('../src/cli/commands/packs.mjs');

// 捕获 handler 的 console 输出（handler 靠打印汇报，返回值只表示退出码）
async function capture(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };
  try {
    const code = await fn();
    return { code: typeof code === 'number' ? code : 0, stdout: logs.join('\n'), stderr: errors.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function ctxOf(argv, overrides) {
  return Object.assign(createContext(argv), overrides || {});
}

test('tasks 命令：list / show / check 的主要分支', async function () {
  const list = await capture(function () { return tasksCmd.list(ctxOf(['list', '--track=docker'])); });
  assert.equal(list.code, 0);
  assert.match(list.stdout, /docker\.run-web/);

  const listJson = await capture(function () { return tasksCmd.list(ctxOf(['list', '--json'])); });
  const parsed = JSON.parse(listJson.stdout);
  assert.ok(parsed.length >= EXPECT.tasks);
  assert.ok(parsed.every(function (row) { return row.id && row.track; }));

  const show = await capture(function () { return tasksCmd.show(ctxOf(['show', 'docker.run-web', '--json'])); });
  assert.equal(JSON.parse(show.stdout).id, 'docker.run-web');

  const check = await capture(function () { return tasksCmd.check(ctxOf(['check', 'docker.run-web', 'docker run -d -p 8080:80 --name web nginx:1.25', '--client=cmd-test'])); });
  assert.equal(check.code, 0);
  assert.match(check.stdout, /判定：通过/);
  assert.match(check.stdout, /已记录到/);

  const failed = await capture(function () { return tasksCmd.check(ctxOf(['check', 'docker.run-web', 'docker run nginx', '--client=cmd-test'])); });
  assert.match(failed.stdout, /提示：/);
  assert.match(failed.stdout, /参考：/);

  // 缺 taskId 时 requireTask 抛 CliError（入口再转成退出码 2）
  await assert.rejects(function () { return tasksCmd.check(ctxOf(['check'])); }, function (err) {
    assert.equal(err.name, 'CliError');
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /未找到任务/);
    return true;
  });
});

test('store 命令：board / export / import 的输出与错误分支', async function () {
  const board = await capture(function () { return storeCmd.boardCommand(ctxOf(['board'])); });
  assert.match(board.stdout, /客户端/);

  const boardJson = await capture(function () { return storeCmd.boardCommand(ctxOf(['board', '--json'])); });
  assert.ok(Array.isArray(JSON.parse(boardJson.stdout)));

  const exportFile = join(HOME, 'cmd-export.json');
  const exported = await capture(function () { return storeCmd.exportCommand(ctxOf(['export', exportFile])); });
  assert.match(exported.stdout, /已导出/);

  const imported = await capture(function () { return storeCmd.importCommand(ctxOf(['import', exportFile])); });
  assert.match(imported.stdout, /导入完成/);

  const noFile = await capture(function () { return storeCmd.importCommand(ctxOf(['import'])); });
  assert.equal(noFile.code, 2);
  assert.match(noFile.stderr, /用法/);
});

test('learn 命令：review / goal / note / drill / plan / report 的主要分支', async function () {
  // 先制造一条没通过的记录，让复习队列与目标统计都有内容
  await capture(function () { return tasksCmd.check(ctxOf(['check', 'linux.sed-inplace', "sed -i 's/foo/bar/g' a.txt", '--platform=darwin', '--client=cmd-test'])); });

  const reviewEmpty = await capture(function () { return learnCmd.review(ctxOf(['review', '--limit=3'])); });
  assert.equal(reviewEmpty.code, 0);
  assert.match(reviewEmpty.stdout, /该复习/);

  const reviewJson = await capture(function () { return learnCmd.review(ctxOf(['review', '--json'])); });
  assert.ok(JSON.parse(reviewJson.stdout).upcoming.length >= 1);

  const goalShow = await capture(function () { return learnCmd.goal(ctxOf(['goal'])); });
  assert.match(goalShow.stdout, /学习目标/);
  assert.match(goalShow.stdout, /今日进度/);

  const goalSet = await capture(function () { return learnCmd.goal(ctxOf(['goal', 'set', '--tasks=2'])); });
  assert.match(goalSet.stdout, /目标已更新/);

  const goalBad = await capture(function () { return learnCmd.goal(ctxOf(['goal', 'whatever'])); });
  assert.equal(goalBad.code, 2);

  const noteWrite = await capture(function () { return learnCmd.note(ctxOf(['note', 'linux.sed-inplace', 'BSD 要空后缀'])); });
  assert.match(noteWrite.stdout, /已记录/);
  const noteRead = await capture(function () { return learnCmd.note(ctxOf(['note', 'linux.sed-inplace'])); });
  assert.match(noteRead.stdout, /BSD 要空后缀/);
  const noteList = await capture(function () { return learnCmd.note(ctxOf(['note'])); });
  assert.match(noteList.stdout, /共 1 条笔记/);
  const noteDelete = await capture(function () { return learnCmd.note(ctxOf(['note', 'linux.sed-inplace', '--delete'])); });
  assert.match(noteDelete.stdout, /已删除/);
  const noteMissing = await capture(function () { return learnCmd.note(ctxOf(['note', 'docker.run-web'])); });
  assert.match(noteMissing.stdout, /还没有笔记/);

  const report = await capture(function () { return learnCmd.report(ctxOf(['report', '--out=' + join(HOME, 'cmd-report.md')])); });
  assert.match(report.stdout, /学习报告已写入/);

  const plan = await capture(function () { return learnCmd.plan(ctxOf(['plan', '--hours=1', '--track=git'])); });
  assert.match(plan.stdout, /学习计划/);

  const drill = await capture(function () { return learnCmd.drill(ctxOf(['drill', '--all', '--limit=2'])); });
  assert.match(drill.stdout, /练习模式/);

  // analyze 出来的清单可以直接喂给 drill：按给定顺序练，并且写清楚忽略掉的题号
  const byList = await capture(function () { return learnCmd.drill(ctxOf(['drill', '--tasks=netops.iperf3,python.venv,不存在.x'])); });
  assert.equal(byList.code, 0);
  assert.match(byList.stdout, /指定训练：共 2 题/);
  assert.match(byList.stdout, /netops\.iperf3/);
  assert.match(byList.stderr, /忽略不存在的题号/);

  const emptyList = await capture(function () { return learnCmd.drill(ctxOf(['drill', '--tasks=全都不存在'])); });
  assert.equal(emptyList.code, 2);

  const jsonList = await capture(function () { return learnCmd.drill(ctxOf(['drill', '--all', '--limit=1', '--json'])); });
  assert.equal(JSON.parse(jsonList.stdout).practice.length, 1);

  const progress = await capture(function () { return learnCmd.progress(ctxOf(['progress'])); });
  assert.match(progress.stdout, /整体进度/);
  const progressJson = await capture(function () { return learnCmd.progress(ctxOf(['progress', '--json'])); });
  assert.ok(JSON.parse(progressJson.stdout).storage);
});

test('verify 命令：security whitelist 与 selftest 的 dry-run', async function () {
  const security = await capture(function () { return verifyCmd.security(ctxOf(['security', 'whitelist'])); });
  assert.equal(security.code, 0);
  assert.match(security.stdout, /对账通过/);

  const securityJson = await capture(function () { return verifyCmd.security(ctxOf(['security', 'whitelist', '--json'])); });
  assert.equal(JSON.parse(securityJson.stdout).ok, true);

  const securityBad = await capture(function () { return verifyCmd.security(ctxOf(['security', 'nope'])); });
  assert.equal(securityBad.code, 2);

  const selftest = await capture(function () { return verifyCmd.selftest(ctxOf(['selftest', '--json'])); });
  assert.equal(selftest.code, 0);
  assert.equal(JSON.parse(selftest.stdout).ran, false, '默认 dry-run');

  // 未知平台现在在**建上下文**时就拦下（以前要等命令跑起来才判，别的命令还会静默按 generic 判）
  assert.throws(function () { ctxOf(['selftest', '--platform=plan9']); }, /未知平台：plan9/, '未知平台要拦在入口');
  // 命令实现自己的那道校验仍然保留：库调用方（不经 CLI）也要得到同样的拒绝
  const badPlatform = await capture(function () { return verifyCmd.selftest({ args: { _: ['selftest'], platform: 'plan9' }, platform: 'plan9', profile: { name: 'generic' }, asJson: false, out: function () {} }); });
  assert.equal(badPlatform.code, 2, '命令层也要拦住未知平台');
});

// 人类可读输出（不带 --json）是用户实际看到的界面，不能只测 JSON 分支
test('verify 命令：人读输出的分支都要有输出', async function () {
  const human = await capture(function () { return verifyCmd.verify(ctxOf(['verify', 'linux.tar-exclude'])); });
  assert.equal(human.code, 0);
  assert.match(human.stdout, /执行后端：local/);
  assert.match(human.stdout, /验证命令：/);
  assert.match(human.stdout, /结果：未执行/, '不带 --run 时不应真的执行');

  const runnerList = await capture(function () { return verifyCmd.runners(ctxOf(['runners'])); });
  assert.equal(runnerList.code, 0);
  assert.match(runnerList.stdout, /可选执行后端/);

  const probeHuman = await capture(function () { return verifyCmd.probe(ctxOf(['probe'])); });
  assert.match(probeHuman.stdout, /Docker 运行时/);
  assert.match(probeHuman.stdout, /诊断：/);

  const auditHuman = await capture(function () { return verifyCmd.audit(ctxOf(['audit'])); });
  assert.equal(auditHuman.code, 0);
  assert.match(auditHuman.stdout, /题库体检：/);
  assert.match(auditHuman.stdout, /体检通过/);

  const auditJson = await capture(function () { return verifyCmd.audit(ctxOf(['audit', '--json'])); });
  assert.ok(JSON.parse(auditJson.stdout).tasks >= 93);

  const selftestHuman = await capture(function () { return verifyCmd.selftest(ctxOf(['selftest'])); });
  assert.equal(selftestHuman.code, 0);
  assert.match(selftestHuman.stdout, /平台自检：/);
  assert.match(selftestHuman.stdout, /未执行：/);
});

test('analyze / knowledge / modules 三个命令的输出与退出码', async function () {
  const analyzeCmd = await import('../src/cli/commands/analyze.mjs');

  const jd = '岗位要求：熟悉 Python 虚拟环境与依赖管理；会用 tcpdump 抓包；了解 YOLO 训练；有嵌入式交叉编译经验';
  const human = await capture(function () { return analyzeCmd.analyze(ctxOf(['analyze', '--text', jd])); });
  assert.equal(human.code, 0);
  assert.match(human.stdout, /识别出 \d+ 个知识点/);
  assert.match(human.stdout, /【/);
  assert.match(human.stdout, /开始训练：node src\/cli\.mjs drill --tasks=/);

  const pipeline = await capture(function () { return analyzeCmd.analyze(ctxOf(['analyze', '--text', jd, '--tasks'])); });
  assert.equal(pipeline.code, 0);
  assert.match(pipeline.stdout, /^[a-z]+\.[a-z-]+(\n[a-z]+\.[a-z-]+)*$/, '--tasks 只吐题号，方便接管道');
  assert.match(pipeline.stderr, /识别出/);

  const asJson = await capture(function () { return analyzeCmd.analyze(ctxOf(['analyze', '--text', jd, '--json'])); });
  assert.equal(JSON.parse(asJson.stdout).source, 'text');

  const noInput = await capture(function () { return analyzeCmd.analyze(ctxOf(['analyze'])); });
  assert.equal(noInput.code, 2, '没有输入时应给用法而不是崩');

  // learn-site 的 --out 与 pack promote 用同一套边界：相对越界要在抓取之前就被拒（不依赖网络）
  const escaped = await capture(function () {
    return analyzeCmd.learnSite(ctxOf(['learn-site', 'https://example.com', '--out=../../escaped-draft.json']));
  });
  assert.equal(escaped.code, 2, '相对越界应直接给用法错误，而不是去抓网页');
  assert.match(escaped.stderr, /--out 必须写在/);
  assert.match(escaped.stderr, /escaped-draft\.json/);
  // 绝对路径放行（用户自己指定位置），这里只验"没有在边界上被拒"这一条
  const absolute = await capture(function () {
    return analyzeCmd.learnSite(ctxOf(['learn-site', '/definitely/not/a/file.txt', '--out=/tmp/dsh-learn-out-ok.json']));
  });
  assert.equal(/--out 必须写在/.test(absolute.stderr), false, '显式绝对路径不该被边界拦住');

  const dict = await capture(function () { return analyzeCmd.knowledge(ctxOf(['knowledge'])); });
  assert.match(dict.stdout, /知识点字典：\d+ 条/);
  assert.match(dict.stdout, /有知识点但还没有题的：/);

  const overview = await capture(function () { return analyzeCmd.modules(ctxOf(['modules'])); });
  assert.equal(overview.code, 0);
  assert.match(overview.stdout, /模块总览：\d+ 个模块/);
  assert.match(overview.stdout, /知识点\s+\d+/, '每个模块都要给出知识点数量');

  const overviewJson = await capture(function () { return analyzeCmd.modules(ctxOf(['modules', '--json'])); });
  const parsed = JSON.parse(overviewJson.stdout);
  assert.ok(parsed.modules.length >= 20);
  assert.ok(parsed.modules.some(function (row) { return row.track === 'python' && row.tasks > 0; }), '有题库的模块应带上题数与进度');
  // track 为 null 的模块要如实标成"没有题库"，有 track 的必须带上题数
  parsed.modules.forEach(function (row) {
    if (row.track === null) assert.equal(row.tasks, 0, '没有题库的模块不该有题数');
    else assert.ok(row.tasks > 0, row.id + ' 有轨道就应该有题');
  });
  assert.ok(parsed.modules.every(function (row) { return row.points > 0; }), '每个模块都要有知识点');
});

// 实测的坑：选项拼错会被静默忽略——`--platfrom=linux` 让判定回到 darwin、退出码仍是 0，
// `--levle=hard` 让难度筛选悄悄失效。现在不认识的选项一律拒（退出码 2）并给最接近的建议。
// 这条用例同时守住「用法文本 = 选项白名单」不漂移。
test('拼错的选项被拒并给建议；用法文本覆盖代码里用到的所有选项', async function () {
  // 拼错的选项在**建上下文**这一步就被拦下（不是等命令跑起来）
  assert.throws(function () { createContext(['list', '--levle=hard']); },
    function (err) { return err instanceof Error && /不认识的选项：--levle（是不是想写 --level？）/.test(err.message) && err.exitCode === 2; },
    '拼错的选项要以退出码 2 报出最接近的选项');
  assert.throws(function () { createContext(['check', 't', 'x', '--platfrom=linux']); }, /--platfrom（是不是想写 --platform？）/,
    '平台拼错必须拦下：以前会静默按 darwin 判定');

  assert.deepEqual(unknownFlags({ _: [], levle: 'hard' }), ['levle'], '应认出拼错的选项');
  assert.deepEqual(unknownFlags({ _: [], level: 'hard', json: true }), [], '正常选项不该被认成拼错');
  assert.deepEqual(unknownFlags({ _: [], 'dry-run': true }), [], '带连字符的选项要认（--dry-run）');

  // 代码里用到的每个 args.x 都必须写在用法文本里，否则会被自己拦下（实测 --endpoint/--token 就这么暴露的）
  const used = new Set();
  ['src/cli.mjs'].concat(readdirSync('src/cli/commands').map(function (name) { return 'src/cli/commands/' + name; }))
    .forEach(function (file) {
      const text = readFileSync(file, 'utf8');
      let hit;
      const re = /args\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
      while ((hit = re.exec(text))) used.add(hit[1]);
      const re2 = /args\[['"]([a-zA-Z][a-zA-Z0-9_-]*)['"]\]/g;
      while ((hit = re2.exec(text))) used.add(hit[1]);
    });
  ['_', 'mjs'].forEach(function (noise) { used.delete(noise); });
  const documented = new Set((USAGE_LINES.join(String.fromCharCode(10)).match(/--[a-z][a-z0-9-]*/g) || [])
    .map(function (flag) { return flag.slice(2); }));
  const missing = Array.from(used).filter(function (flag) { return !documented.has(flag); }).sort();
  assert.deepEqual(missing, [], '这些选项在代码里用了但没写进用法文本：');
});

// 选项拼错被拦下之后，**值**拼错同样要拦：实测 --track=dokcer 会列出整个题库、
// --platform=linx 会按 generic 判定（变体题直接判错）、--hours=abc 会退成默认 2 小时，三条都是退出码 0。
test('值也要校验：轨道 / 平台 / 难度 / 数字型选项', function () {
  assert.throws(function () { createContext(['list', '--track=dokcer']); }, /未知轨道：dokcer（是不是想写 docker？）/, '轨道拼错要拦下');
  assert.throws(function () { createContext(['list', '--track=zzz']); }, /未知轨道：zzz/, '完全不相干的轨道也要说明可选范围');
  assert.throws(function () { createContext(['check', 't', 'x', '--platform=linx']); }, /未知平台：linx/, '平台拼错要拦下（以前静默按 generic 判）');
  assert.throws(function () { createContext(['list', '--level=harder']); }, /未知难度：harder/, '难度值拼错要拦下');
  assert.throws(function () { createContext(['plan', '--hours=abc']); }, /--hours 需要一个非负整数/, '数字型选项要校验');
  assert.throws(function () { createContext(['drill', '--limit=-3']); }, /--limit 需要一个非负整数/, '负数也不行');

  // 正当取值一个都不能误伤
  ['list', '--track=all', '--level=all'].forEach(function () {});
  assert.ok(createContext(['list', '--track=all', '--level=all']), 'all 是合法取值');
  assert.ok(createContext(['list', '--track=docker', '--level=hard', '--platform=linux']), '正常组合要放行');
  assert.ok(createContext(['plan', '--hours=0']), '0 小时也算给了值（不是拼错）');
  assert.ok(createContext(['check', 't', 'x', '--platform=generic']), 'generic 是合法平台');
});
test('check 命令：第二次以后给出与历史最好的对比', async function () {
  // 用本文件里没被其它用例提交过的题，才能稳定断言"第一次练"
  const TASK = 'linux.awk-top-url';
  const GOOD = "awk '{print $7}' access.log | sort | uniq -c | sort -rn | head -5";
  const HALF = "awk '{print $7}' access.log | sort -rn | head -5";
  const BAD = 'cat access.log';

  const first = await capture(function () { return tasksCmd.check(ctxOf(['check', TASK, GOOD])); });
  assert.equal(first.code, 0);
  assert.match(first.stdout, /这是第一次练这道题/);
  assert.doesNotMatch(first.stdout, /上次最好/);
  // 变体题在不同平台口径不同：命令行也要写清"按哪个平台判的"
  assert.match(first.stdout, /^平台：darwin$/m, '输出里要有平台行：' + first.stdout.split('\n').slice(0, 3).join(' / '));

  const second = await capture(function () { return tasksCmd.check(ctxOf(['check', TASK, HALF])); });
  assert.match(second.stdout, /上次最好 100 分/, '第二次要带上次最好成绩：' + second.stdout);
  assert.match(second.stdout, /比上次最好 -\d+/);
  assert.match(second.stdout, /累计第 2 次练习/);

  const third = await capture(function () { return tasksCmd.check(ctxOf(['check', TASK, BAD])); });
  assert.match(third.stdout, /累计第 3 次练习/);
  assert.doesNotMatch(third.stdout, /首次满分/);

  const asJson = await capture(function () { return tasksCmd.check(ctxOf(['check', TASK, GOOD, '--json'])); });
  const payload = JSON.parse(asJson.stdout);
  assert.equal(payload.previousBest, 100);
  assert.equal(payload.attempts, 4, 'JSON 里也要带累计次数');
  assert.equal(payload.delta, 0, '这次和上次最好一样，差值为 0');
  assert.equal(payload.pass, true, '这次是满分');

  // 换平台：平台行要跟着变（放在最后，避免多出来的那次提交打乱上面的"第 N 次练习"计数）
  const linuxRun = await capture(function () { return tasksCmd.check(ctxOf(['check', TASK, GOOD], { platform: 'linux' })); });
  assert.match(linuxRun.stdout, /^平台：linux$/m, '换平台后平台行要跟着变');
  assert.match(linuxRun.stdout, /累计第 5 次练习/, '换平台仍然记在同一条进度里');
});

test('packs 命令：list / validate / trusted 的退出码', async function () {
  const list = await capture(function () { return packsCmd.pack(ctxOf(['pack', 'list', '--json'])); });
  assert.equal(list.code, 0);
  assert.ok(JSON.parse(list.stdout).length >= 16);

  const badSub = await capture(function () { return packsCmd.pack(ctxOf(['pack', 'nonsense'])); });
  assert.equal(badSub.code, 2);

  const noFile = await capture(function () { return packsCmd.pack(ctxOf(['pack', 'validate'])); });
  assert.equal(noFile.code, 2);

  const trusted = await capture(function () { return packsCmd.pack(ctxOf(['pack', 'trusted'])); });
  assert.equal(trusted.code, 0);

  const keygen = await capture(function () { return packsCmd.pack(ctxOf(['pack', 'keygen'])); });
  assert.equal(keygen.code, 0, '首次 keygen 应成功：' + keygen.stdout);
  const again = await capture(function () { return packsCmd.pack(ctxOf(['pack', 'keygen'])); });
  assert.equal(again.code, 1, '已存在密钥时返回 1 且不覆盖');
});

test('入口分发：help / 未知命令 / 用法错误 / 正常命令的退出码', async function () {
  const { dispatch, listCommands } = await import('../src/cli.mjs');
  assert.ok(listCommands().length >= 19);

  const help = await capture(function () { return dispatch(['help']); });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /用法/);

  const unknown = await capture(function () { return dispatch(['no-such-command']); });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /未知命令/);

  const usageError = await capture(function () { return dispatch(['check']); });
  assert.equal(usageError.code, 2, 'CliError 应被入口转成退出码');
  assert.match(usageError.stderr, /未找到任务/);

  const ok = await capture(function () { return dispatch(['list', '--json', '--track=git']); });
  assert.equal(ok.code, 0);
  assert.ok(JSON.parse(ok.stdout).length >= 16);
});

test.after(function () {
  rmSync(HOME, { recursive: true, force: true });
});
