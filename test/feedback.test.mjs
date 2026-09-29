// 判定反馈定位：只给未命中的要素定位，且优先长片段（否则短片段行行都满分）。
import test from 'node:test';
import assert from 'node:assert/strict';

const { literalFragments, locateMissing, locateRule, longestCommon } = await import('../src/core/feedback.mjs');
const { TASKS } = await import('../src/core/tasks.mjs');

test('从正则里抽字面片段', function () {
  const frags = literalFragments('psql\\s+-c\\s+"?(SELECT|EXPLAIN)');
  assert.ok(frags.indexOf('psql') > -1, JSON.stringify(frags));
  assert.ok(frags.indexOf('-c') > -1, JSON.stringify(frags));
  assert.ok(frags.indexOf('SELECT') > -1 || frags.indexOf('EXPLAIN') > -1, JSON.stringify(frags));
  assert.deepEqual(literalFragments(''), []);
});

test('最长公共子串：用于衡量"这一行像不像"', function () {
  assert.equal(longestCommon('git --version', 'git --versionx'), 13);
  assert.equal(longestCommon('abc', 'xyz'), 0);
});

test('定位优先长片段：短词命中不算"最接近"', function () {
  const rule = { p: 'kubectl\\s+get\\s+pods', tip: '应使用 kubectl get pods' };
  const lines = ['kubectl describe pod web', 'kubectl get pod web'];
  const hit = locateRule(rule, lines);
  assert.ok(hit, '应当定位到一行');
  assert.equal(hit.index, 1, '更接近的是第 2 行：' + JSON.stringify(hit));
  assert.ok(hit.matched >= 3, '至少要匹配上一个有意义的片段：' + JSON.stringify(hit));
});

test('只对未命中的要素给定位；命中的不啰嗦', function () {
  const task = TASKS.filter(function (row) { return row.id === 'git.version-check'; })[0];
  const ok = locateMissing(task, 'git --version', 'darwin');
  assert.deepEqual(ok.located, [], '全命中时不该有定位建议');
  assert.deepEqual(ok.unmatched, []);
  const partial = locateMissing(task, 'git status', 'darwin');
  assert.ok(partial.located.length + partial.unmatched.length > 0, '未命中时要给出定位或如实说没有相关片段');
  if (partial.located.length) {
    const row = partial.located[0];
    assert.ok(row.line >= 1 && row.suggestion.indexOf('第 ' + row.line + ' 行') > -1, JSON.stringify(row));
  }
  const empty = locateMissing(task, '', 'darwin');
  assert.deepEqual(empty.located, [], '空答案不给行号建议');
});
