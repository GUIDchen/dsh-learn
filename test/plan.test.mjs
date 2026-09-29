import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, estimateMinutes, renderPlanText, planProgress, renderPlanProgressText } from '../src/core/plan.mjs';
import { TASKS } from '../src/core/tasks.mjs';

test('单题成本随要素与验证项上升，且有上限', function () {
  const tiny = estimateMinutes({ require: [{ p: 'a', tip: 'a' }] });
  const big = estimateMinutes({ require: [{ p: 'a', tip: 'a' }, { p: 'b', tip: 'b' }, { p: 'c', tip: 'c' }], verify: { cmd: 'uname -s', expect: 'x' } });
  assert.ok(big > tiny, '要素多的题应更贵');
  const huge = estimateMinutes({ require: new Array(20).fill({ p: 'a', tip: 'a' }), verify: { cmd: 'x', expect: 'x' } });
  assert.ok(huge <= 40, '单题成本应有上限，实际 ' + huge);
});

test('计划按每日预算装箱，且不丢题', function () {
  const plan = buildPlan(TASKS, { platform: 'darwin', hoursPerDay: 1 });
  assert.equal(plan.taskCount, TASKS.length);
  const total = plan.days.reduce(function (sum, day) { return sum + day.tasks.length; }, 0);
  assert.equal(total, TASKS.length, '题目数应守恒');
  plan.days.forEach(function (day) {
    assert.ok(day.minutes > 0);
    assert.ok(day.tasks.length > 0, '不应出现空天');
  });
  const multi = plan.days.filter(function (day) { return day.tasks.length > 1; });
  multi.forEach(function (day) {
    const sum = day.tasks.reduce(function (acc, task) { return acc + task.minutes; }, 0);
    assert.equal(sum, day.minutes);
  });
});

test('预算越大天数越少，且按轨道筛选生效', function () {
  const small = buildPlan(TASKS, { hoursPerDay: 1 });
  const large = buildPlan(TASKS, { hoursPerDay: 4 });
  assert.ok(large.days.length <= small.days.length);
  const dockerOnly = buildPlan(TASKS, { track: 'docker' });
  assert.ok(dockerOnly.taskCount > 0);
  assert.ok(dockerOnly.days.every(function (day) {
    return day.tasks.every(function (task) { return task.track === 'docker'; });
  }));
});

test('文本渲染包含天数与题目，且不泄露参考答案', function () {
  const plan = buildPlan(TASKS, { platform: 'darwin', hoursPerDay: 2 });
  const text = renderPlanText(plan);
  assert.match(text, /第 1 天/);
  assert.match(text, /学习计划：平台 darwin/);
  assert.ok(text.indexOf('docker run -d -p 8080:80') === -1, '计划里不应出现参考答案');
});
test('计划完成情况从提交记录推导：只有满分才算过', function () {
  const plan = buildPlan(TASKS, { track: 'linux', hoursPerDay: 1 });
  const firstDay = plan.days[0];
  const passedId = firstDay.tasks[0].id;
  const partialId = firstDay.tasks[1].id;
  const records = [
    { taskId: passedId, score: 100, verdict: '通过' },
    { taskId: partialId, score: 60, verdict: '部分通过' }
  ];
  const progress = planProgress(plan, records);
  assert.equal(progress.passed, 1, '部分通过不算完成');
  assert.equal(progress.days[0].passed, 1);
  assert.equal(progress.days[0].percent, Math.round(1 / firstDay.tasks.length * 100));
  assert.deepEqual(progress.days[0].remaining, firstDay.tasks.slice(1).map(function (task) { return task.id; }), '没过的题要列出来');
  assert.ok(progress.estimatedMinutesLeft > 0 && progress.estimatedDaysLeft > 0);

  // 第一天全部通过时：整天完成 + 剩余时间减少
  const allPassed = firstDay.tasks.slice(1).map(function (task) {
    return { taskId: task.id, score: 100, verdict: '通过' };
  }).concat(records);
  const full = planProgress(plan, allPassed);
  assert.equal(full.days[0].percent, 100);
  assert.equal(full.daysDone >= 1, true, '第一天应被算作整天完成');
  assert.ok(full.estimatedMinutesLeft < progress.estimatedMinutesLeft);
});

test('计划完成情况的文本渲染带表格与估算', function () {
  const plan = buildPlan(TASKS, { track: 'go', hoursPerDay: 1 });
  const text = renderPlanProgressText(planProgress(plan, []));
  assert.match(text, /计划完成情况：/);
  assert.match(text, /整体 0 \/ /);
  assert.match(text, /还需约 /);
  assert.match(text, /\| 第 1 天 \|/);
});
