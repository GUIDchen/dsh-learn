import { PASS_SCORE } from './judge.mjs';
import { bar } from './progress.mjs';
// 学习计划生成：把题库编排成"每天做什么"，纯函数、确定性输出。
// 每道题的成本按要素数量与是否需要动手验证估算，再按每日预算是贪心装箱。

export function estimateMinutes(task) {
  const require = (task && task.require) || [];
  const variants = (task && task.variants) || {};
  const variantRules = Object.keys(variants).reduce(function (sum, key) {
    return sum + ((variants[key] && variants[key].require) || []).length;
  }, 0);
  const rules = Math.max(require.length, Object.keys(variants).length ? Math.round(variantRules / Object.keys(variants).length) : 0);
  const base = 8;
  const perRule = 3;
  const verifyBonus = task && task.verify ? 5 : 0;
  const varietyBonus = Object.keys(variants).length > 1 ? 6 : 0;
  return Math.min(40, base + rules * perRule + verifyBonus + varietyBonus);
}

export function buildPlan(tasks, options) {
  const opts = options || {};
  const perDay = Math.max(1, Number(opts.hoursPerDay) || 2) * 60;
  const track = opts.track;
  const list = (tasks || [])
    .filter(function (task) { return !track || task.track === track; })
    .slice()
    .sort(function (a, b) {
      if (a.track !== b.track) return String(a.track).localeCompare(String(b.track));
      return String(a.id).localeCompare(String(b.id));
    });

  const days = [];
  let current = { day: 1, minutes: 0, tasks: [] };
  list.forEach(function (task) {
    const minutes = estimateMinutes(task);
    if (current.tasks.length && current.minutes + minutes > perDay) {
      days.push(current);
      current = { day: days.length + 1, minutes: 0, tasks: [] };
    }
    current.tasks.push({
      id: task.id,
      title: task.title,
      track: task.track,
      minutes: minutes,
      hasVerify: Boolean(task.verify || Object.keys(task.variants || {}).some(function (key) { return variantsVerify(task, key); }))
    });
    current.minutes += minutes;
  });
  if (current.tasks.length) days.push(current);

  return {
    platform: opts.platform || 'generic',
    track: track || 'all',
    hoursPerDay: perDay / 60,
    budgetMinutes: perDay,
    taskCount: list.length,
    totalMinutes: days.reduce(function (sum, day) { return sum + day.minutes; }, 0),
    days: days
  };
}

function variantsVerify(task, key) {
  return Boolean(task.variants && task.variants[key] && task.variants[key].verify);
}

// 计划完成情况：把计划里的每一天与真实提交记录对齐。
// 状态完全从记录推导（与复习队列同样的思路），不额外存一份计划进度，也就不会和实际脱节。
export function planProgress(plan, records) {
  const done = new Map();
  (records || []).forEach(function (item) {
    if ((Number(item.score) || 0) < PASS_SCORE) return;
    if (!done.has(item.taskId)) done.set(item.taskId, item);
  });
  const days = (plan.days || []).map(function (day) {
    const passed = day.tasks.filter(function (task) { return done.has(task.id); });
    return {
      day: day.day,
      minutes: day.minutes,
      total: day.tasks.length,
      passed: passed.length,
      percent: day.tasks.length ? Math.round(passed.length / day.tasks.length * 100) : 0,
      remaining: day.tasks.filter(function (task) { return !done.has(task.id); }).map(function (task) { return task.id; })
    };
  });
  const passedTotal = days.reduce(function (sum, day) { return sum + day.passed; }, 0);
  const minutesLeft = (plan.days || []).reduce(function (sum, day, index) {
    return sum + (days[index].passed === days[index].total ? 0 : day.minutes);
  }, 0);
  return {
    platform: plan.platform,
    track: plan.track,
    hoursPerDay: plan.hoursPerDay,
    days: days,
    total: plan.taskCount,
    passed: passedTotal,
    percent: plan.taskCount ? Math.round(passedTotal / plan.taskCount * 100) : 0,
    daysTotal: days.length,
    daysDone: days.filter(function (row) { return row.total > 0 && row.passed === row.total; }).length,
    estimatedMinutesLeft: minutesLeft,
    estimatedDaysLeft: Math.ceil(minutesLeft / Math.max(1, plan.budgetMinutes))
  };
}

export function renderPlanProgressText(progress) {
  const lines = [];
  lines.push('计划完成情况：平台 ' + progress.platform + '　轨道 ' + progress.track + '　每天 ' + progress.hoursPerDay + ' 小时');
  lines.push('整体 ' + progress.passed + ' / ' + progress.total + ' 题（' + progress.percent + '%）　' + bar(progress.percent)
    + '　整天完成 ' + progress.daysDone + ' / ' + progress.daysTotal);
  lines.push('按当前进度估算还需约 ' + progress.estimatedMinutesLeft + ' 分钟（约 ' + progress.estimatedDaysLeft + ' 天）');
  lines.push('');
  lines.push('| 天 | 通过 / 计划 | 完成度 | 还没过的题 |');
  lines.push('| --- | --- | --- | --- |');
  progress.days.forEach(function (row) {
    const rest = row.remaining.length ? row.remaining.slice(0, 3).join(', ') + (row.remaining.length > 3 ? ' 等 ' + row.remaining.length + ' 题' : '') : '—';
    lines.push('| 第 ' + row.day + ' 天 | ' + row.passed + ' / ' + row.total + ' | ' + row.percent + '% | ' + rest + ' |');
  });
  return lines.join('\n');
}
export function renderPlanText(plan) {
  const lines = [];
  lines.push('学习计划：平台 ' + plan.platform + '　轨道 ' + plan.track + '　每天 ' + plan.hoursPerDay + ' 小时');
  lines.push('共 ' + plan.taskCount + ' 题，预计 ' + plan.totalMinutes + ' 分钟，分 ' + plan.days.length + ' 天');
  plan.days.forEach(function (day) {
    lines.push('');
    lines.push('第 ' + day.day + ' 天（' + day.minutes + ' 分钟）');
    day.tasks.forEach(function (task) {
      lines.push('  [' + task.track + '] ' + task.id + '  ' + task.title + '  ~' + task.minutes + ' 分钟' + (task.hasVerify ? '（含动手验证）' : ''));
    });
  });
  return lines.join('\n');
}
