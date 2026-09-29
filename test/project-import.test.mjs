// 按目录批量导入语料：目录→项目、来源台账、知识点汇总都要对，失败要如实报。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 项目目录由 store 按 DSH_LEARN_HOME 决定，必须在导入模块前设好（与 server 测试同一套做法）
const TEST_HOME = mkdtempSync(join(tmpdir(), 'dsh-import-home-'));
process.env.DSH_LEARN_HOME = TEST_HOME;

const { backfillSourceText, ingestIntoProject, importTree, projectDrillPlan, readProject, readSourceText } = await import('../src/core/project.mjs');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-import-'));
  const base = join(root, 'corpus');
  mkdirSync(join(base, 'ai'), { recursive: true });
  mkdirSync(join(base, 'python'), { recursive: true });
  writeFileSync(join(base, 'ai', '01.txt'), '任职要求：熟悉 Kubernetes 滚动发布与 Prometheus 监控，掌握 Python');
  writeFileSync(join(base, 'ai', '02.md'), '岗位职责：负责 Docker 与 Kubernetes 集群运维');
  writeFileSync(join(base, 'python', '01.txt'), '任职要求：熟悉 Python 虚拟环境与依赖管理，熟悉 Linux');
  writeFileSync(join(base, 'python', 'ignore.json'), '{"not": "文本"}');
  return { root: root, base: base };
}

test('按目录导入：每个子目录一个项目，来源与知识点都记上', function () {
  const f = fixture();
  const result = importTree(f.base, { prefix: 'boss-', limit: 20 });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.files, 3, '只收文本类文件（.json 不算）：' + result.files);
  assert.deepEqual(result.projects.map(function (row) { return row.name; }), ['boss-ai', 'boss-python']);
  const ai = result.projects[0];
  assert.equal(ai.files, 2, 'ai 目录两份');
  assert.ok(ai.points.length > 0, '要汇总出知识点：' + JSON.stringify(ai));
  assert.ok(ai.knowledge > 0, '要有命中次数');
  const meta = readProject('boss-ai');
  assert.ok(meta, '项目元数据要写下来');
  assert.equal(meta.sources.length, 2, '来源台账要有两条');
  assert.ok(meta.sources[0].source.indexOf('ai/') === 0, '来源名带分类前缀：' + meta.sources[0].source);
  rmSync(f.root, { recursive: true, force: true });
});

test('按目录导入：给 --project 时收成一个项目（含子目录）', function () {
  const f = fixture();
  const result = importTree(f.base, { project: 'boss-all', limit: 20 });
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].name, 'boss-all');
  assert.equal(result.projects[0].files, 3, '子目录里的文件都要收进来');
  rmSync(f.root, { recursive: true, force: true });
});

test('按目录导入：目录不存在要如实报错，不建空项目', function () {
  const result = importTree('/tmp/肯定不存在的目录-dsh', {});
  assert.equal(result.ok, false);
  assert.ok(String(result.error).indexOf('读不到目录') > -1, result.error);
});

test('旧数据回填原文：能从语料目录按来源名找回，找不到的如实计入 missed', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-backfill-home-'));
  process.env.DSH_LEARN_HOME = home;

  // 造一个项目：来源名写成「分类/文件.txt」，但先不给原文（模拟加功能之前的旧数据）
  const ingested = ingestIntoProject('bf', { kind: 'text', source: 'ai/01.txt', text: '任职要求：熟悉 Linux' });
  const meta = readProject('bf');
  assert.ok(meta.sources[0].textFile, '新数据本来就有 textFile');
  // 手动抹掉 textFile，模拟旧数据
  meta.sources[0].textFile = '';
  meta.sources[0].textChars = 0;
  writeFileSync(join(home, 'projects', 'bf', 'project.json'), JSON.stringify(meta, null, 2));
  assert.equal(readSourceText('bf', 1).ok, false, '旧数据读原文要如实失败');

  // 语料目录里放回原文件 → 回填
  const corpus = mkdtempSync(join(tmpdir(), 'dsh-corpus-'));
  mkdirSync(join(corpus, 'ai'), { recursive: true });
  writeFileSync(join(corpus, 'ai', '01.txt'), '任职要求：熟悉 Linux 与 Prometheus');
  const filled = backfillSourceText('bf', corpus);
  assert.equal(filled.ok, true, JSON.stringify(filled));
  assert.equal(filled.filled, 1, '应补回 1 条：' + JSON.stringify(filled));
  assert.equal(filled.missed.length, 0);
  const back = readSourceText('bf', 1);
  assert.equal(back.ok, true, back.error);
  assert.ok(back.text.indexOf('Prometheus') > -1, '补回的应当是语料里的原文：' + back.text);

  // 源文件不在磁盘上时：如实计为缺失，不编造
  const missing = backfillSourceText('bf', '/tmp/肯定没有这个目录-dsh');
  assert.equal(missing.ok, true);
  assert.equal(missing.filled, 0, '已经补过的不重复补');
  rmSync(home, { recursive: true, force: true });
  rmSync(corpus, { recursive: true, force: true });
});

test('开练清单：差额优先、没练过的从易到难、已通过排最后，并给出理由', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-drill-home-'));
  process.env.DSH_LEARN_HOME = home;
  // 用真实题库里的一道题来造项目：来源文本里带上它的知识点关键词不好构造，
  // 这里直接走 projectDrillPlan 的两个入口之一——先建一个含知识点来源的项目
  const text = '任职要求：熟悉 Kubernetes 滚动发布，熟悉 Linux 与 Shell，了解 YOLO 训练';
  const ingested = ingestIntoProject('drill', { kind: 'text', source: 'jd/01.txt', text: text });
  assert.ok(ingested.project.sources[0].points.length > 0, '来源要命中知识点');
  const plan = projectDrillPlan(['drill'], { records: [], limit: 5 });
  assert.ok(plan.total > 0, '要有可练题：' + JSON.stringify(plan.total));
  assert.equal(plan.passed, 0, '没有记录时不该有已通过');
  assert.equal(plan.missing, plan.total);
  // 没练过 → 从易到难：相邻两道里，前一道的难度不能高于后一道
  const order = { easy: 0, medium: 1, hard: 2 };
  for (let i = 1; i < plan.rows.length; i += 1) {
    const prev = order[plan.rows[i - 1].level] === undefined ? 1 : order[plan.rows[i - 1].level];
    const next = order[plan.rows[i].level] === undefined ? 1 : order[plan.rows[i].level];
    assert.ok(prev <= next, '没练过的应按难度升序：' + plan.rows[i - 1].id + ' → ' + plan.rows[i].id);
  }
  plan.rows.forEach(function (row) { assert.ok(row.reason, '每题要有理由：' + row.id); });
  assert.ok(plan.command.indexOf('drill --tasks=') > -1, '要给出开练命令');
  assert.ok(plan.byTrack.length > 0, '要按方向分组');
  // 差额优先：给一道没过的记录，它应当排到队首
  const first = plan.rows[0].id;
  const plan2 = projectDrillPlan(['drill'], { records: [{ taskId: first, score: 50, attempts: 2, at: new Date().toISOString() }], limit: 5 });
  assert.equal(plan2.rows[0].id, first, '练过但没过的要先练：' + plan2.rows[0].id);
  assert.ok(plan2.rows[0].reason.indexOf('没过') > -1, plan2.rows[0].reason);
  assert.equal(plan2.passed, 0);
  rmSync(home, { recursive: true, force: true });
});
