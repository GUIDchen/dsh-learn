// 目标提醒：把「今天的练习量」和用户设的每日目标比一下，给出可执行的提醒。
//
// 口径（与趋势/成绩单同一套）：
//   * 今天完成 = 今天**通过的题数**（同一题当天只算一次），attempts 另外记着；
//   * minutesTracked = false：记录里没有时长字段，所以分钟目标只作为展示，不假装能统计；
//   * 提醒级别：none（已完成 / 没设目标）、info（还差几题）、warn（今天一题没练且已过 18:00）。
import { PASS_SCORE } from './judge.mjs';
import { dayKey } from './day.mjs';   // 日期口径的唯一实现

export function todayStatus(records, goals, options) {
  const opts = options || {};
  const now = opts.now ? new Date(opts.now) : new Date();
  const key = dayKey(now);
  const today = (records || []).filter(function (row) { return dayKey(row.at) === key; });
  const passed = new Set(today.filter(function (row) { return Number(row.score) >= PASS_SCORE; }).map(function (row) { return String(row.taskId); }));
  const target = Math.max(0, Number(goals && goals.dailyTasks) || 0);
  const done = passed.size;
  const remaining = Math.max(0, target - done);
  return {
    date: key,
    done: done,
    target: target,
    remaining: remaining,
    attempts: today.length,
    percent: target ? Math.min(1, done / target) : 1,
    met: target === 0 ? true : done >= target,
    minutesTarget: Math.max(0, Number(goals && goals.dailyMinutes) || 0),
    minutesTracked: false
  };
}

export function reminder(records, goals, options) {
  const opts = options || {};
  const now = opts.now ? new Date(opts.now) : new Date();
  const status = todayStatus(records, goals, { now: now });
  const hour = now.getHours();
  if (!status.target) {
    return { level: 'none', status: status, message: '还没有设每日目标：node src/cli.mjs goal set --tasks=3', action: 'goal set --tasks=3' };
  }
  if (status.met) {
    return { level: 'none', status: status, message: '今天的目标已完成：' + status.done + ' / ' + status.target + ' 题', action: null };
  }
  if (status.done === 0 && hour >= 18) {
    return { level: 'warn', status: status, message: '今天还一题没练（现在 ' + hour + ' 点）：先来一道？', action: 'drill --limit=1' };
  }
  return {
    level: 'info', status: status,
    message: '今天还差 ' + status.remaining + ' 题（已完成 ' + status.done + ' / ' + status.target + '）',
    action: 'drill --limit=' + status.remaining
  };
}

export function renderReminder(result) {
  const mark = result.level === 'warn' ? '提醒' : (result.level === 'info' ? '进度' : '目标');
  const lines = ['[' + mark + '] ' + result.message];
  if (result.status && result.status.minutesTarget) {
    lines.push('　　每日分钟目标 ' + result.status.minutesTarget + ' 分钟（练习记录里没有时长字段，这里只作展示，不假装统计）');
  }
  if (result.action) lines.push('　　下一步：node src/cli.mjs ' + result.action);
  return lines.join(String.fromCharCode(10));
}
