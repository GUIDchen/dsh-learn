// 投递跟进：状态时间线要留痕、待跟进口径要准（只催已投/面试中）。
import test from 'node:test';
import assert from 'node:assert/strict';

const { jobFollowUps, mergeJob, renderFollowUps, lastTouchedAt } = await import('../src/core/jobs.mjs');

function seed(rows, input, now) {
  const merged = mergeJob(rows, input, { now: now });
  assert.equal(merged.ok, true, JSON.stringify(merged.errors));
  return merged;
}

test('状态时间线：新建记一条，改状态记来源与备注', function () {
  let rows = [];
  let result = seed(rows, { company: '甲公司', position: '运维工程师', status: 'applied', appliedAt: '2026-09-20', note: '内推' }, '2026-09-20');
  rows = result.jobs;
  assert.equal(rows[0].history.length, 1, '新建要有第一条历史');
  assert.equal(rows[0].history[0].status, 'applied');
  assert.equal(rows[0].history[0].note, '内推');
  result = seed(rows, { id: rows[0].id, company: '甲公司', position: '运维工程师', status: 'interview', note: '约了下周二一面' }, '2026-09-24');
  rows = result.jobs;
  assert.equal(rows[0].history.length, 2, '改状态要追加一条：' + JSON.stringify(rows[0].history));
  assert.equal(rows[0].history[1].status, 'interview');
  assert.equal(rows[0].history[1].from, 'applied', '要记住从哪个状态变过来的');
  assert.equal(rows[0].history[1].at, '2026-09-24');
  assert.equal(lastTouchedAt(rows[0]), '2026-09-24', '最后动作取最新一条');
});

test('待跟进：只催已投/面试中，超过阈值才算', function () {
  let rows = [];
  rows = seed(rows, { company: '甲公司', position: '运维', status: 'applied', appliedAt: '2026-09-20' }, '2026-09-20').jobs;
  rows = seed(rows, { company: '乙公司', position: 'SRE', status: 'applied', appliedAt: '2026-09-26' }, '2026-09-26').jobs;
  rows = seed(rows, { company: '丙公司', position: '待投岗位', status: 'todo' }, '2026-09-28').jobs;
  rows = seed(rows, { company: '丁公司', position: '已结束', status: 'closed', appliedAt: '2026-09-01' }, '2026-09-01').jobs;
  const follow = jobFollowUps(rows, { now: '2026-09-28', staleDays: 5 });
  assert.equal(follow.waiting.length, 2, '只有已投的两条在等消息：' + follow.waiting.length);
  assert.equal(follow.followUps.length, 1, '只有 8 天那条要跟进：' + JSON.stringify(follow.followUps));
  assert.equal(follow.followUps[0].company, '甲公司');
  assert.equal(follow.followUps[0].days, 8);
  const todo = follow.rows.filter(function (row) { return row.status === 'todo'; })[0];
  assert.equal(todo.followUp, false, '待投不催');
  assert.ok(todo.reason.indexOf('还没投') > -1, todo.reason);
  const closed = follow.rows.filter(function (row) { return row.status === 'closed'; })[0];
  assert.equal(closed.followUp, false, '已结束不催');
  assert.ok(follow.markdown.indexOf('| 公司 | 岗位 | 状态 | 最后一次动作 | 无动静 | 建议 |') > -1);
  assert.ok(follow.markdown.indexOf('先跟这几家') > -1, '要给出先跟哪几家');
});

test('还没有投递时，跟进报告如实说明', function () {
  const follow = jobFollowUps([], { now: '2026-09-28' });
  assert.equal(follow.waiting.length, 0);
  assert.ok(follow.markdown.indexOf('当前没有在等消息的投递') > -1, follow.markdown.slice(0, 80));
  assert.ok(renderFollowUps(follow).indexOf('# 投递跟进') > -1);
});
