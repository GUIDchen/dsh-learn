// 进度趋势与成绩单：按天聚合、连练天数、ASCII 趋势、Markdown/CSV 形状。
import test from 'node:test';
import assert from 'node:assert/strict';

const { asciiChart, dailyTrend, scorecard, scorecardCsv, scorecardMarkdown, streakDays } = await import('../src/core/trend.mjs');

const now = new Date('2026-09-28T10:00:00Z');
const rows = [
  { taskId: 'go.env-check', at: '2026-09-26T09:00:00Z', score: 100 },
  { taskId: 'go.env-check', at: '2026-09-27T09:00:00Z', score: 60 },
  { taskId: 'git.version-check', at: '2026-09-28T08:00:00Z', score: 100 },
  { taskId: 'git.version-check', at: '2026-09-28T09:00:00Z', score: 100 }
];

test('按天聚合：窗口对齐、不补假数据、通过口径与判定一致', function () {
  const series = dailyTrend(rows, { days: 4, now: now });
  assert.deepEqual(series.map(function (r) { return r.date; }), ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28']);
  assert.equal(series[0].attempts, 0, '没有记录的天就是 0，不估算');
  assert.equal(series[1].passed, 1);
  assert.equal(series[2].passed, 0, 'score 60 不算通过');
  assert.equal(series[3].attempts, 2);
  assert.equal(series[3].passed, 2);
  assert.equal(series[3].tasks, 1, '同一天同一题只算一道');
});

test('连练天数：今天没练不算断，昨天也没练才算断', function () {
  assert.equal(streakDays(rows, { now: now }), 3);
  assert.equal(streakDays(rows, { now: new Date('2026-09-29T10:00:00Z') }), 3, '今天还没练，仍算连续 3 天');
  assert.equal(streakDays(rows, { now: new Date('2026-09-31T10:00:00Z') }), 0, '中间断了就归零');
});

test('ASCII 趋势：有记录才有柱子，最大值那列最高', function () {
  const chart = asciiChart(dailyTrend(rows, { days: 3, now: now }), { height: 3 });
  const lines = chart.split(String.fromCharCode(10));
  assert.equal(lines.length, 3);
  assert.ok(lines[2].indexOf('█') > -1, '有通过的当天底部应当是实的：' + JSON.stringify(lines));
  assert.ok(lines[0].replace(/ /g, '').length <= lines[2].replace(/ /g, '').length);
});

test('成绩单：总览、Markdown 与 CSV 结构都对', function () {
  const card = scorecard(rows, { days: 4, now: now });
  assert.equal(card.totals.attempts, 4);
  assert.equal(card.totals.passed, 3);
  assert.equal(card.totals.passRate, 0.75);
  assert.equal(card.totals.tasks, 2);
  assert.equal(card.totals.activeDays, 3);
  assert.equal(card.totals.streak, 3);
  assert.ok(card.byTrack.length >= 1, '要能分轨道统计');
  const md = scorecardMarkdown(card);
  assert.ok(md.indexOf('# 学习成绩单') === 0);
  assert.ok(md.indexOf('| 通过率 | 75.0% |') > -1, md.slice(0, 400));
  assert.ok(md.indexOf('## 每日趋势') > -1);
  const csv = scorecardCsv(card);
  assert.equal(csv.split(String.fromCharCode(10))[0], 'date,attempts,passed,tasks');
  assert.equal(csv.trim().split(String.fromCharCode(10)).length, 5);
  assert.ok(scorecard([], { days: 2, now: now }).totals.passRate === 0, '空记录不能除零');
});
