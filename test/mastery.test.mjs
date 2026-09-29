// 知识点掌握度：可复算、排序可解释、能给出"今天先练哪几道"。
import test from 'node:test';
import assert from 'node:assert/strict';

const { decayFactor, masteryReport, pointMastery } = await import('../src/core/mastery.mjs');
const { TASKS } = await import('../src/core/tasks.mjs');
const { POINTS } = await import('../src/core/knowledge.mjs');

function rec(taskId, score, at) {
  return { id: taskId + '-' + at, taskId: taskId, score: score, verdict: score >= 60 ? '通过' : '未通过', at: at, client: 'test' };
}

test('掌握度：覆盖度与新鲜度都算进去，时间越久打折越多', function () {
  const now = '2026-09-28T00:00:00.000Z';
  assert.equal(decayFactor(now, now), 1, '刚刚练过不打折');
  const half = decayFactor('2026-08-29T00:00:00.000Z', now);
  assert.ok(Math.abs(half - 0.5) < 0.02, '30 天前应当折半：' + half);
  const old = decayFactor('2026-06-28T00:00:00.000Z', now);
  assert.ok(old < 0.2, '三个月前应当快见底：' + old);
  const noTime = decayFactor('', now);
  assert.equal(noTime, 0.5, '没有时间戳的老数据折半（保守）');
});

test('掌握度：练过但没拿下排在没练过的前面，并给出理由', function () {
  const point = POINTS.filter(function (row) { return (row.tasks || []).length >= 3; })[0];
  const ids = point.tasks.slice(0, 3);
  // 只通过其中一道（且不是刚练），其余没练
  const records = [rec(ids[0], 100, '2026-08-01T00:00:00.000Z')];
  const report = masteryReport(records, TASKS, { now: '2026-09-28T00:00:00.000Z', limit: 5 });
  const first = report.weakest[0];
  assert.ok(first.passed > 0, '第一条应当是"练过但没拿下"的那种：' + JSON.stringify(first));
  assert.ok(first.reason.indexOf('没拿下') > -1, first.reason);
  const untouched = report.weakest.filter(function (row) { return row.passed === 0; });
  assert.ok(untouched.length > 0, '后面应当有没练过的');
  assert.ok(untouched[0].reason.indexOf('还没练过') > -1, untouched[0].reason);
});

test('掌握度：nextUp 给出未通过的题并生成可执行命令', function () {
  const point = POINTS.filter(function (row) { return (row.tasks || []).length >= 5; })[0];
  const ids = point.tasks.slice(0, 5);
  const records = ids.slice(0, 2).map(function (id) { return rec(id, 100, '2026-09-27T00:00:00.000Z'); });
  const report = masteryReport(records, TASKS, { now: '2026-09-28T00:00:00.000Z', limit: 3, practiceLimit: 4 });
  assert.ok(report.nextUp.length > 0, '要有今天先练的题');
  report.nextUp.forEach(function (row) {
    assert.ok(ids.indexOf(row.id) === -1 || records.every(function (r) { return r.taskId !== row.id; }), '不该再练已通过的题：' + row.id);
    assert.ok(row.pointName, '要说明来自哪个知识点');
  });
  assert.ok(report.command.indexOf('drill --tasks=') > -1, report.command);
  assert.ok(report.markdown.indexOf('今天先练这') > -1, '报告要给出今天先练');
});

test('掌握度：没练过的知识点档位是未练，且逐点可查', function () {
  const rows = pointMastery([], TASKS, POINTS, { now: '2026-09-28T00:00:00.000Z' });
  const withTasks = rows.filter(function (row) { return row.total > 0; });
  assert.ok(withTasks.length > 0, '要有挂了题的知识点');
  withTasks.slice(0, 5).forEach(function (row) {
    assert.equal(row.mastery, 0, row.id + ' 没练过时掌握度应为 0');
    assert.equal(row.level, '未练', row.id);
  });
});
