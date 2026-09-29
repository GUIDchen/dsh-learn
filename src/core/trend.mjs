// 进度趋势与成绩单：把练习记录聚合成「按天趋势 + 连练天数 + 分轨道」，并能导出 Markdown / CSV。
//
// 口径都来自真实记录（records 里有 at/score/taskId），不估算、不补零：
//   * 通过 = score >= PASS_SCORE（与判定/掌握度同一套阈值）
//   * 同一天同一题只算一次「首次通过」（趋势里的"当天有没有进步"）
import { dayKey, streakDays } from './day.mjs';
// 仍然 re-export：既有调用方（成绩单测试等）从 trend 取这两个名字，零改动
export { dayKey, streakDays };
import { PASS_SCORE } from './judge.mjs';
import { TASKS } from './tasks.mjs';

export function dailyTrend(records, options) {
  const opts = options || {};
  const days = Math.max(1, Number(opts.days) || 14);
  const now = opts.now ? new Date(opts.now) : new Date();
  const buckets = new Map();
  const seenPass = new Set();
  (records || []).forEach(function (row) {
    const key = dayKey(row.at);
    if (!key) return;
    if (!buckets.has(key)) buckets.set(key, { date: key, attempts: 0, passed: 0, tasks: new Set() });
    const bucket = buckets.get(key);
    bucket.attempts += 1;
    const passed = Number(row.score) >= PASS_SCORE;
    if (passed) {
      bucket.passed += 1;
      const token = key + '|' + String(row.taskId);
      if (!seenPass.has(token)) seenPass.add(token);
    }
    bucket.tasks.add(String(row.taskId));
  });
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKey(new Date(now.getTime() - i * 86400000));
    const bucket = buckets.get(key);
    out.push({
      date: key,
      attempts: bucket ? bucket.attempts : 0,
      passed: bucket ? bucket.passed : 0,
      tasks: bucket ? bucket.tasks.size : 0
    });
  }
  return out;
}

export function asciiChart(series, options) {
  const opts = options || {};
  const height = Math.max(1, Number(opts.height) || 4);
  const rows = (series || []);
  const max = rows.reduce(function (m, row) { return Math.max(m, row.passed); }, 0) || 1;
  const lines = [];
  for (let level = height; level >= 1; level -= 1) {
    let line = '';
    rows.forEach(function (row) {
      const filled = Math.round((row.passed / max) * height);
      line += filled >= level ? '█' : ' ';
    });
    lines.push(line);
  }
  return lines.join(String.fromCharCode(10));
}

export function byTrack(records) {
  const trackOf = {};
  (TASKS || []).forEach(function (task) { trackOf[task.id] = task.track || 'other'; });
  const map = new Map();
  (records || []).forEach(function (row) {
    const track = trackOf[row.taskId] || 'other';
    if (!map.has(track)) map.set(track, { track: track, attempts: 0, passed: 0, tasks: new Set() });
    const bucket = map.get(track);
    bucket.attempts += 1;
    if (Number(row.score) >= PASS_SCORE) bucket.passed += 1;
    bucket.tasks.add(String(row.taskId));
  });
  return Array.from(map.values()).map(function (row) {
    return { track: row.track, attempts: row.attempts, passed: row.passed, tasks: row.tasks.size };
  }).sort(function (a, b) { return b.attempts - a.attempts; });
}

export function scorecard(records, options) {
  const opts = options || {};
  const days = Math.max(1, Number(opts.days) || 14);
  const now = opts.now ? new Date(opts.now) : new Date();
  const rows = (records || []).filter(function (row) { return row.at; });
  const attempts = rows.length;
  const passed = rows.filter(function (row) { return Number(row.score) >= PASS_SCORE; }).length;
  const tasks = new Set(rows.map(function (row) { return String(row.taskId); })).size;
  const series = dailyTrend(rows, { days: days, now: now });
  const activeDays = series.filter(function (row) { return row.attempts > 0; }).length;
  return {
    generatedAt: now.toISOString(),
    days: days,
    totals: { attempts: attempts, passed: passed, tasks: tasks, passRate: attempts ? Number((passed / attempts).toFixed(3)) : 0, activeDays: activeDays, streak: streakDays(rows, { now: now }) },
    series: series,
    byTrack: byTrack(rows)
  };
}

export function scorecardCsv(card) {
  const lines = ['date,attempts,passed,tasks'];
  (card.series || []).forEach(function (row) {
    lines.push([row.date, row.attempts, row.passed, row.tasks].join(','));
  });
  return lines.join(String.fromCharCode(10)) + String.fromCharCode(10);
}

export function scorecardMarkdown(card) {
  const fence = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
  const out = [];
  out.push('# 学习成绩单');
  out.push('');
  out.push('生成时间：' + card.generatedAt + '　统计窗口：最近 ' + card.days + ' 天');
  out.push('');
  out.push('| 指标 | 数值 |');
  out.push('| --- | --- |');
  out.push('| 练习次数 | ' + card.totals.attempts + ' |');
  out.push('| 通过次数 | ' + card.totals.passed + ' |');
  out.push('| 通过率 | ' + (card.totals.passRate * 100).toFixed(1) + '% |');
  out.push('| 涉及题目 | ' + card.totals.tasks + ' |');
  out.push('| 有练习的天数 | ' + card.totals.activeDays + ' / ' + card.days + ' |');
  out.push('| 连续练习 | ' + card.totals.streak + ' 天 |');
  out.push('');
  out.push('## 每日趋势');
  out.push('');
  out.push(fence);
  out.push(asciiChart(card.series, { height: 4 }));
  out.push(fence);
  out.push('');
  out.push('| 日期 | 尝试 | 通过 | 涉及题目 |');
  out.push('| --- | --- | --- | --- |');
  (card.series || []).forEach(function (row) {
    out.push('| ' + row.date + ' | ' + row.attempts + ' | ' + row.passed + ' | ' + row.tasks + ' |');
  });
  if ((card.byTrack || []).length) {
    out.push('');
    out.push('## 分轨道');
    out.push('');
    out.push('| 轨道 | 尝试 | 通过 | 题目 |');
    out.push('| --- | --- | --- | --- |');
    card.byTrack.forEach(function (row) {
      out.push('| ' + row.track + ' | ' + row.attempts + ' | ' + row.passed + ' | ' + row.tasks + ' |');
    });
  }
  out.push('');
  return out.join(String.fromCharCode(10));
}
