// 刷新知识点：知识字典长大以后，老项目要能用上新增的知识点与题；没有原文的如实跳过。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-refresh-home-'));
process.env.DSH_LEARN_HOME = home;
const { createProject, ingestIntoProject, readProject, refreshProjectPoints, buildProjectIndex } = await import('../src/core/project.mjs');

test('刷新知识点：重算并存回，且幂等', function () {
  const ingested = ingestIntoProject('refresh-proj', { kind: 'text', source: 'a/jd.txt', text: '任职要求：熟悉 Kubernetes 与 Prometheus；熟悉 PostgreSQL' });
  assert.ok(ingested.project, '收来源要成功');
  const before = readProject('refresh-proj');
  const beforePoints = before.sources[0].points || [];
  // 模拟"字典长大"：把存下来的知识点清空（等价于老项目收录时字典里还没有这些点）
  before.sources[0].points = [];
  before.sources[0].knowledge = 0;
  writeFileSync(join(home, 'projects', 'refresh-proj', 'project.json'), JSON.stringify(before, null, 2));
  const result = refreshProjectPoints('refresh-proj');
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 140));
  assert.equal(result.sources, 1);
  assert.equal(result.changed, 1, '应当有一条补到了知识点：' + JSON.stringify(result));
  assert.ok(result.updated[0].after > 0, '重算后要有知识点');
  assert.ok(result.points > 0 && result.tasks > 0, '索引要有知识点与可练题：' + JSON.stringify({ p: result.points, t: result.tasks }));
  const after = readProject('refresh-proj');
  assert.ok((after.sources[0].points || []).length > 0, '知识点要写回元数据');
  assert.ok(beforePoints.length === 0 || after.sources[0].points.length >= beforePoints.length, '不会丢知识点');
  const again = refreshProjectPoints('refresh-proj');
  assert.equal(again.changed, 0, '再刷一次不该又"补到"（幂等）：' + JSON.stringify(again.updated));
  const index = buildProjectIndex('refresh-proj');
  assert.ok((index.tasks || []).length > 0, '索引里的可练题要在');
});

test('刷新知识点：没有原文的旧来源如实跳过，不猜', function () {
  createProject('refresh-old', {});
  const meta = readProject('refresh-old');
  meta.sources = [{ kind: 'text', source: 'old/jd.txt', at: new Date().toISOString() }];
  writeFileSync(join(home, 'projects', 'refresh-old', 'project.json'), JSON.stringify(meta, null, 2));
  const result = refreshProjectPoints('refresh-old');
  assert.equal(result.ok, true);
  assert.equal(result.changed, 0);
  assert.equal(result.skipped.length, 1, '要如实计入跳过：' + JSON.stringify(result.skipped));
  assert.ok(result.skipped[0].reason.indexOf('没有原文') > -1, result.skipped[0].reason);
  rmSync(home, { recursive: true, force: true });
});
