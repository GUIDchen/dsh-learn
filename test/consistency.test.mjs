// 跨客户端一致性：CLI 与网页 API 必须对同一份记录给出同一套数字。
// 两边是两套代码路径（CLI 直读 store / 网页走 HTTP → api.mjs），
// 只在一侧加功能就会出现"CLI 说该复习 3 题、网页说 0 题"这种分叉——这个文件就是拦它的。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-learn-consistency-'));
process.env.DSH_LEARN_HOME = HOME;

const store = await import('../src/store.mjs');
// 文档与题库规模只对**内置包**：用户 promote 进 packs/ 的本地包不该把文档数字弄红
const { BUILTIN_TASKS: TASKS, TRACKS, BUILTIN_PACK_IDS: PACK_IDS } = await import('../src/core/tasks.mjs');
const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { createAppServer } = await import('../src/web/server.mjs');
const learnCmd = await import('../src/cli/commands/learn.mjs');
const { createContext } = await import('../src/cli/context.mjs');
const { auditCatalog } = await import('../src/core/catalog-audit.mjs');

// 造一批有代表性的记录：错过的、一次通过的、反复通过的
function seed() {
  const base = Date.now() - 10 * 24 * 60 * 60 * 1000;
  const records = [
    { client: 'mac-air', taskId: 'linux.sed-inplace', score: 40, verdict: '未通过', at: new Date(base).toISOString() },
    { client: 'mac-air', taskId: 'linux.sed-inplace', score: 100, verdict: '通过', at: new Date(base + 3600000).toISOString() },
    { client: 'mac-air', taskId: 'docker.run-web', score: 100, verdict: '通过', at: new Date(base + 7200000).toISOString() },
    { client: 'linux-box', taskId: 'git.switch-create', score: 100, verdict: '通过', at: new Date(base + 10800000).toISOString() },
    { client: 'web-demo', taskId: 'docker.logs-follow', score: 3, verdict: '未通过', at: new Date(base + 14400000).toISOString() }
  ];
  records.forEach(function (row) { store.record(row); });
  store.writeGoals({ dailyTasks: 2, dailyMinutes: 20 });
  return records;
}

const server = createAppServer();
await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
const BASE = 'http://127.0.0.1:' + server.address().port;

async function cliText(fn) {
  const logs = [];
  const original = console.log;
  console.log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return logs.join('\n');
}

async function cliJson(fn) {
  return JSON.parse(await cliText(fn));
}

const seeded = seed();

test('进度汇总：CLI 与 /api/progress 数字一致', async function () {
  const cli = await cliJson(function () { return learnCmd.progress(createContext(['progress', '--json'])); });
  const api = await (await fetch(BASE + '/api/progress')).json();

  assert.deepEqual(cli.byTrack, api.summary.byTrack, '分轨道进度必须一致');
  ['total', 'attempted', 'passed', 'percent'].forEach(function (key) {
    assert.equal(cli[key], api.summary[key], '字段 ' + key + ' 应一致');
  });
  assert.deepEqual(cli.weak.map(function (row) { return row.taskId; }), api.summary.weak.map(function (row) { return row.taskId; }));
  assert.equal(cli.storage.records, api.storage.records, '存储健康度的记录数也应一致');
  assert.equal(api.goal.tasksTarget, 2, '网页应带上学习目标');
  assert.equal(api.goal.tasksToday, 0, '这批记录都是 10 天前的，今天没有通过的题');
});

test('每日一题：CLI 与 /api/daily 选同一道题', async function () {
  const cli = await cliJson(function () { return learnCmd.daily(createContext(['daily', '--json'])); });
  const api = await (await fetch(BASE + '/api/daily?platform=darwin')).json();
  assert.equal(cli.taskId, api.daily.taskId);
  assert.equal(cli.pool, api.daily.pool, '来源（复习/薄弱/新题）也必须一致');
  assert.equal(cli.date, api.daily.date);
});

test('复习队列：CLI 与 /api/review 给出同一批题与同一排期', async function () {
  const cli = await cliJson(function () { return learnCmd.review(createContext(['review', '--json'])); });
  const api = await (await fetch(BASE + '/api/review?limit=10')).json();

  assert.deepEqual(cli.due.map(function (row) { return row.taskId; }), api.due.map(function (row) { return row.taskId; }));
  const cliUpcoming = cli.upcoming.slice(0, 10).map(function (row) { return row.taskId; });
  assert.deepEqual(cliUpcoming, api.upcoming.map(function (row) { return row.taskId; }));
  if (cli.due.length) {
    assert.equal(cli.due[0].dueAt, api.due[0].dueAt, '到期时间必须一致');
    assert.equal(cli.due[0].intervalDays, api.due[0].intervalDays);
  }
});

test('学习目标：CLI 与 /api/goal 读到的目标与进度一致', async function () {
  const cli = await cliJson(function () { return learnCmd.goal(createContext(['goal', '--json'])); });
  const api = await (await fetch(BASE + '/api/goal')).json();
  assert.deepEqual(cli.goal, api.goal, '目标本身应一致');
  assert.deepEqual(cli.progress, api.progress, '今日进度应一致');
});

test('网页提交的记录，CLI 立刻能看到（同一份存储）', async function () {
  const before = await (await fetch(BASE + '/api/progress')).json();
  const response = await fetch(BASE + '/api/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: 'k8s.get-pods-wide', answer: 'kubectl get pods -A -o wide', platform: 'darwin', clientId: 'web-demo' })
  });
  const payload = await response.json();
  assert.equal(payload.result.verdict, '通过');

  const after = await (await fetch(BASE + '/api/progress')).json();
  assert.equal(after.summary.passed, before.summary.passed + 1, '网页提交后通过数 +1');
  assert.equal(after.goal.tasksToday, before.goal.tasksToday + 1, '今日目标进度也应 +1');

  const cli = await cliJson(function () { return learnCmd.progress(createContext(['progress', '--json'])); });
  assert.equal(cli.passed, after.summary.passed, 'CLI 应立即看到网页写进来的记录');
  assert.equal(cli.percent, after.summary.percent);

  const cliGoal = await cliJson(function () { return learnCmd.goal(createContext(['goal', '--json'])); });
  assert.equal(cliGoal.progress.tasksToday, after.goal.tasksToday);
});

test('CLI 提交的记录，网页立刻能查到', async function () {
  const taskCmd = await import('../src/cli/commands/tasks.mjs');
  await cliJson(function () {
    return taskCmd.check(createContext(['check', 'docker.volume-persist', 'docker volume create redis-data && docker run -d -v redis-data:/data --name cache redis:7', '--client=cli-box', '--json']));
  });

  const board = await (await fetch(BASE + '/api/board')).json();
  const row = board.board.filter(function (item) { return item.client === 'cli-box'; })[0];
  assert.ok(row, '网页排行榜应出现 CLI 提交的客户端');
  assert.equal(row.passed, 1);

  const history = await (await fetch(BASE + '/api/history?taskId=docker.volume-persist')).json();
  assert.ok(history.history.some(function (item) { return item.client === 'cli-box' && item.score === 100; }));
});

test('定向练习：CLI drill --json 与 /api/drill 给出同一批题与同一权重', async function () {
  for (const mode of ['weak', 'all', 'new']) {
    const cli = await cliJson(function () { return learnCmd.drill(createContext(['drill', '--json', '--limit=5', '--track=all', mode === 'all' ? '--all' : ''])); });
    const api = await (await fetch(BASE + '/api/drill?mode=' + mode + '&limit=5')).json();

    // 网页在 weak 无结果时会自动回落 new，CLI 也一样，所以按各自返回的 mode 比
    if (cli.mode !== api.mode) continue;
    assert.deepEqual(
      cli.practice.map(function (row) { return [row.taskId, row.weight]; }),
      api.practice.map(function (row) { return [row.taskId, row.weight]; }),
      '模式 ' + mode + ' 下两边应给出同样的题与权重'
    );
  }
});

test('学习报告：CLI 与 /api/report 内容一致（只差生成时间）', async function () {
  const cli = await cliText(function () { return learnCmd.report(createContext(['report'])); });
  const apiText = await (await fetch(BASE + '/api/report')).text();
  const strip = function (text) {
    return String(text).split('\n').filter(function (line) { return line.indexOf('生成时间') === -1; }).join('\n');
  };
  const cliBody = strip(cli).trim();
  const apiBody = strip(apiText).trim();
  assert.equal(cliBody, apiBody, '报告正文必须逐行一致');
  assert.ok(cliBody.indexOf('## 客户端排行') > -1);
  assert.ok(cliBody.indexOf('mac-air') > -1, '报告应包含客户端排行里的真实客户端');
});

test('种子数据本身符合预期（防止测试变成空跑）', function () {
  assert.equal(seeded.length, 5);
  assert.equal(store.load().records.length >= 6, true, '此时应至少有 6 条记录');
});


// 改题库忘了改文档，是真实踩过的坑（题数、轨道分布、变体数写在多处）。
// 这条用例把文档里的数字钉在运行时数据上：数字对不上，测试就红。
test('文档里的题库数字与真实题库一致', function () {
  const doc = readFileSync(join(ROOT, 'docs/COMPLETION-REPORT.md'), 'utf8');
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const byTrack = {};
  TASKS.forEach(function (task) { byTrack[task.track] = (byTrack[task.track] || 0) + 1; });

  assert.ok(doc.indexOf('/ ' + TASKS.length + ' 道题') > -1, '完成报告的题目数应为 ' + TASKS.length);
  assert.ok(readme.indexOf(TASKS.length + ' 道题') > -1, 'README 的题目数应为 ' + TASKS.length);
  assert.ok(doc.indexOf(PACK_IDS.length + ' 个数据包') > -1, '完成报告的数据包数应为 ' + PACK_IDS.length);
  Object.keys(byTrack).forEach(function (track) {
    assert.ok(doc.indexOf(track + ' ' + byTrack[track]) > -1, '完成报告里 ' + track + ' 的题数应为 ' + byTrack[track]);
  });
  const variants = TASKS.filter(function (task) { return task.variants; }).length;
  assert.ok(doc.indexOf(variants + ' 道平台变体题') > -1, '完成报告的平台变体数应为 ' + variants);
  assert.ok(doc.indexOf(TRACKS.length + ' 条轨道') > -1, '完成报告的轨道数应为 ' + TRACKS.length);

  const byLevel = { easy: 0, medium: 0, hard: 0 };
  TASKS.forEach(function (task) { byLevel[task.level || 'medium'] += 1; });
  // 变体样本按平台拆开写了两处（README 与需求文档），只钉总数会让 win32 的数字悄悄过期
  const samples = {};
  TASKS.forEach(function (task) {
    Object.keys(task.variants || {}).forEach(function (platform) { samples[platform] = (samples[platform] || 0) + 1; });
  });
  const readmeLine = readFileSync(join(ROOT, 'README.md'), 'utf8');
  Object.keys(samples).forEach(function (platform) {
    assert.ok(readmeLine.indexOf(platform + ' ' + samples[platform]) > -1, 'README 里 ' + platform + ' 的变体样本数应为 ' + samples[platform]);
  });
  const audit = auditCatalog(TASKS);
  const gaps = audit.platformGaps.length;
  const requirements = readFileSync(join(ROOT, 'docs/REQUIREMENTS.md'), 'utf8');
  assert.ok(requirements.indexOf('平台缺口 ' + gaps) > -1, '需求文档里的平台缺口数应为 ' + gaps);
  const line = '简单 ' + byLevel.easy + ' / 中等 ' + byLevel.medium + ' / 困难 ' + byLevel.hard;
  assert.ok(readme.indexOf(line) > -1, 'README 的难度分布应为 ' + line);
});

// 架构文档的模块表曾经落后于代码一大截（20 个 core 模块只写了 8 个）。
// 这类"悄悄少写"没人会注意到，直到有人照着文档找代码找不到——所以用测试把清单钉住。
test('架构文档的模块表必须覆盖 src/core 与 src/web 的全部模块', function () {
  const doc = readFileSync(join(ROOT, 'docs/ARCHITECTURE.md'), 'utf8');
  const modules = [];
  ['core', 'web'].forEach(function (dir) {
    readdirSync(join(ROOT, 'src', dir))
      .filter(function (name) { return name.endsWith('.mjs'); })
      .forEach(function (name) { modules.push(dir + '/' + name); });
  });
  assert.ok(modules.length >= 20, '模块数量看起来不对：' + modules.length);
  const missing = modules.filter(function (rel) { return doc.indexOf(rel) === -1; });
  assert.deepEqual(missing, [], '架构文档没写到的模块：' + missing.join('、'));
});

// 需求文档的追溯表：每条需求都要指到一个真实存在的证据文件。
// 指错文件、或指到已经删掉的测试，都会让"有验收"变成一句空话。
test('需求追溯表引用的测试文件必须真实存在', function () {
  const doc = readFileSync(join(ROOT, 'docs/REQUIREMENTS.md'), 'utf8');
  const refs = [];
  const re = /test\/[a-z-]+\.test\.mjs/g;
  let hit = re.exec(doc);
  while (hit) {
    refs.push(hit[0]);
    hit = re.exec(doc);
  }
  assert.ok(refs.length >= 8, '追溯表里的证据文件太少，检查是否漏写：' + refs.length);
  refs.forEach(function (rel) {
    assert.ok(existsSync(join(ROOT, rel)), '需求文档引用了不存在的测试：' + rel);
  });
  ['FR-1', 'FR-2', 'FR-3', 'FR-4', 'FR-5', 'FR-6', 'FR-7', 'FR-8', 'FR-9', 'FR-10'].forEach(function (id) {
    assert.ok(doc.indexOf(id) > -1, '需求编号 ' + id + ' 不该从文档里消失');
  });
});

test.after(async function () {
  await new Promise(function (resolve) { server.close(resolve); });
  rmSync(HOME, { recursive: true, force: true });
});
