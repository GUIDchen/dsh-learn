// 注意：store/project 的 HOME 在**模块导入时**固定，所以必须先用临时目录，再动态导入（第 16 轮踩过这个坑）。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const HOME = mkdtempSync(join(tmpdir(), 'dsh-project-filter-'));
process.env.DSH_LEARN_HOME = HOME;
// 项目筛选与检索：三端共用 core/project.mjs#filterProjects 的口径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const { filterProjects, missingTextSources, projectSearchHit } = await import('../src/core/project.mjs');
const { createProject, projectDir } = await import('../src/core/project.mjs');

function row(name, extra) {
  return Object.assign({ name: name, displayName: name, sources: [] }, extra || {});
}

test('检索命中面：项目名 / 来源文件名 / 知识点 id 与中文名', function () {
  const item = row('boss-yolo', { sources: [{ source: 'yolo/01-BOSS直聘.txt', knowledge: 3, tasks: 1, points: ['yolo.train'] }] });
  assert.equal(projectSearchHit(item, 'boss').hit, true);
  assert.ok(projectSearchHit(item, 'boss').fields.indexOf('项目名') > -1);
  const bySource = projectSearchHit(item, 'BOSS直聘');
  assert.equal(bySource.hit, true, '来源文件名要能搜到');
  const byPoint = projectSearchHit(item, 'yolo.train');
  assert.equal(byPoint.hit, true, '知识点 id 要能搜到');
  assert.ok(byPoint.fields.indexOf('知识点') > -1, JSON.stringify(byPoint.fields));
  assert.equal(projectSearchHit(item, '不存在的词').hit, false);
  assert.equal(projectSearchHit(item, '').hit, true, '空词等于不过滤');
});

test('缺原文判定：旧数据（没有 textFile）与文件被删都算缺', function () {
  createProject('filter-demo', {});
  const dir = projectDir('filter-demo', {});
  const meta = row('filter-demo', { sources: [{ source: 'a.txt' }, { source: 'b.txt', textFile: 'sources/0002-b.txt' }] });
  const missing = missingTextSources(meta, {});
  assert.equal(missing.length, 2, '两条都缺：一条没 textFile、一条文件不存在');
  mkdirSync(join(dir, 'sources'), { recursive: true });
  writeFileSync(join(dir, 'sources/0002-b.txt'), '正文');
  assert.equal(missingTextSources(meta, {}).length, 1, '补上文件后只剩一条缺');
});

test('筛选与排序：missingText 过滤 + 四种排序', function () {
  const a = row('a', { updatedAt: '2026-01-01T00:00:00Z', sources: [{ knowledge: 5, tasks: 1 }] });
  const b = row('b', { updatedAt: '2026-09-01T00:00:00Z', sources: [{ knowledge: 1, tasks: 9 }, { knowledge: 1, tasks: 1 }] });
  const c = row('c', { updatedAt: '2026-05-01T00:00:00Z', sources: [] });
  const rows = [a, b, c];
  assert.deepEqual(filterProjects(rows, {}).map(function (r) { return r.name; }), ['b', 'c', 'a'], '默认按最近更新');
  assert.deepEqual(filterProjects(rows, { sort: 'name' }).map(function (r) { return r.name; }), ['a', 'b', 'c']);
  assert.deepEqual(filterProjects(rows, { sort: 'sources' }).map(function (r) { return r.name; }), ['b', 'a', 'c']);
  assert.deepEqual(filterProjects(rows, { sort: 'knowledge' }).map(function (r) { return r.name; }), ['a', 'b', 'c']);
  assert.deepEqual(filterProjects(rows, { sort: 'tasks' }).map(function (r) { return r.name; }), ['b', 'a', 'c']);
  // missingText 过滤：c 没有来源 → 不算缺；a、b 的来源没有 textFile → 都缺
  assert.deepEqual(filterProjects(rows, { missingText: true }).map(function (r) { return r.name; }).sort(), ['a', 'b']);
  // 组合：关键词 + 排序
  assert.deepEqual(filterProjects(rows, { query: 'b', sort: 'name' }).map(function (r) { return r.name; }), ['b']);
});

test.after(function () { rmSync(HOME, { recursive: true, force: true }); });
