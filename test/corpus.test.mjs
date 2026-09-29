// 语料检索：跨项目搜关键词，行号与命中分布要准；没有原文的来源要如实剔除。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-corpus-home-'));
process.env.DSH_LEARN_HOME = home;
const { ingestIntoProject, createProject, readProject } = await import('../src/core/project.mjs');
const { searchCorpus } = await import('../src/core/corpus.mjs');

ingestIntoProject('corpus-a', { kind: 'text', source: 'a/jd1.txt', text: ['岗位职责：负责数据平台', '任职要求：熟悉 PostgreSQL 与索引优化', '熟悉 Python'].join(String.fromCharCode(10)) });
ingestIntoProject('corpus-b', { kind: 'text', source: 'b/jd2.txt', text: ['任职要求：熟悉 PostgreSQL 主从复制', '熟悉 Docker 部署'].join(String.fromCharCode(10)) });

test('语料检索：命中行带项目/来源/行号，跨项目统计正确', function () {
  const result = searchCorpus('PostgreSQL', { limit: 10 });
  assert.equal(result.total, 2, '两个项目各命中一行：' + result.total);
  const names = result.projects.map(function (row) { return row.name; }).sort();
  assert.deepEqual(names, ['corpus-a', 'corpus-b']);
  result.hits.forEach(function (hit) {
    assert.ok(hit.project && hit.source && hit.lineNo > 0, '命中要有出处：' + JSON.stringify(hit));
    assert.ok(hit.line.indexOf('PostgreSQL') > -1, '命中的是原话：' + hit.line);
  });
  const first = result.hits.filter(function (hit) { return hit.project === 'corpus-a'; })[0];
  assert.equal(first.lineNo, 2, '应当是第 2 行：' + first.lineNo);
  assert.ok(result.markdown.indexOf('| 项目 | 来源 | 行号 | 原话 |') > -1);
  assert.ok(result.markdown.indexOf('命中分布') > -1);
});

test('多词默认要求同一行都出现，--any 才放宽', function () {
  // 语料里 PostgreSQL 与 Python 分处两行 → 默认 AND 口径下一行都不命中（这正是 AND 的意义）
  const strict = searchCorpus('PostgreSQL Python', {});
  assert.equal(strict.total, 0, '两词不在同一行时不该命中：' + strict.total);
  const loose = searchCorpus('PostgreSQL Python', { mode: 'any' });
  assert.ok(loose.total >= 2, 'any 模式应当命中更多：' + loose.total);
  assert.equal(loose.mode, 'any');
  assert.ok(loose.markdown.indexOf('任一个') > -1, '报告要写明口径');
});

test('没有原文的来源如实剔除并计数，搜不到时给明确提示', function () {
  const missing = searchCorpus('绝对不存在的词-zzz', {});
  assert.equal(missing.total, 0);
  assert.ok(missing.markdown.indexOf('没有命中') > -1);
  // 造一个没有 textFile 的来源（模拟旧数据）
  createProject('corpus-old', {});
  const meta = readProject('corpus-old');
  meta.sources = [{ kind: 'text', source: 'old/jd.txt', at: new Date().toISOString() }];
  writeFileSync(join(home, 'projects', 'corpus-old', 'project.json'), JSON.stringify(meta, null, 2));
  const result = searchCorpus('PostgreSQL', {});
  assert.ok(result.scanned.withoutText >= 1, '旧数据要计入未参与检索：' + JSON.stringify(result.scanned));
  assert.ok(result.markdown.indexOf('未参与检索') > -1, '报告要提示可 backfill');
  rmSync(home, { recursive: true, force: true });
});
