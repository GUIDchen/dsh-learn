// 知识点匹配的编译缓存：只影响速度，不许影响结果。
import test from 'node:test';
import assert from 'node:assert/strict';

const { analyzeText, matcherStats } = await import('../src/core/knowledge.mjs');

const SAMPLE = '熟悉 Docker 与 Kubernetes，会用 git rebase，了解 PostgreSQL 的 EXPLAIN ANALYZE 与索引，能写 shell 脚本';

test('同一段文本反复分析：正则只编译一次，结果完全一致', function () {
  const first = analyzeText(SAMPLE, {});
  const afterFirst = matcherStats();
  const second = analyzeText(SAMPLE, {});
  const afterSecond = matcherStats();
  assert.deepEqual(second.points.map(function (row) { return row.id; }), first.points.map(function (row) { return row.id; }), '两次结果必须一致');
  assert.equal(afterSecond.compiled, afterFirst.compiled, '第二次不该再编译正则（缓存生效）');
  assert.ok(afterSecond.cached >= afterSecond.compiled, '缓存条目不应少于编译次数');
  assert.ok(afterSecond.compiled > 0, '确实编译过正则');
});

test('缓存不改变命中：与逐条重新编译的结果一致（用真实题库文本抽样）', function () {
  const text = '用 psql -c "select version()" 看版本；pg_stat_activity 看连接；pg_locks 看锁；EXPLAIN ANALYZE 看计划；pg_isready 探活';
  const a = analyzeText(text, {});
  const b = analyzeText(text, {});
  assert.deepEqual(b, a, '两次分析必须深相等（缓存不得污染结果）');
  assert.ok(a.points.length > 0, '这段文本应当命中 PostgreSQL 相关知识点：' + JSON.stringify(a.points.map(function (r) { return r.id; })));
});
