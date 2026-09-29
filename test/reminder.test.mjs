// 目标提醒：今天完成量口径、三档级别、分钟目标只作展示。
import test from 'node:test';
import assert from 'node:assert/strict';

const { reminder, renderReminder, todayStatus } = await import('../src/core/reminder.mjs');

const records = [
  { taskId: 'a', at: '2026-09-28T09:00:00', score: 100 },
  { taskId: 'a', at: '2026-09-28T10:00:00', score: 100 },   // 同题当天算一次
  { taskId: 'b', at: '2026-09-28T11:00:00', score: 60 },    // 没过不算完成
  { taskId: 'c', at: '2026-09-27T09:00:00', score: 100 }    // 昨天的
];
const at20 = { now: '2026-09-28T20:00:00' };

test('今日口径：今天通过的题数（同题一次），没过/昨天的不算', function () {
  const s = todayStatus(records, { dailyTasks: 3, dailyMinutes: 30 }, at20);
  assert.equal(s.date, '2026-09-28');
  assert.equal(s.done, 1);
  assert.equal(s.attempts, 3, '尝试数照记');
  assert.equal(s.target, 3);
  assert.equal(s.remaining, 2);
  assert.equal(s.met, false);
  assert.equal(s.minutesTarget, 30);
  assert.equal(s.minutesTracked, false, '记录里没有时长字段，不能假装统计');
});

test('三档级别：没设目标 none、已完成 none、还差 info、零练习且过 18 点 warn', function () {
  assert.equal(reminder(records, {}, at20).level, 'none');
  assert.equal(reminder(records, { dailyTasks: 1 }, at20).level, 'none');
  const info = reminder(records, { dailyTasks: 3 }, { now: '2026-09-28T09:00:00' });
  assert.equal(info.level, 'info');
  assert.equal(info.action, 'drill --limit=2');
  assert.ok(info.message.indexOf('还差 2 题') > -1, info.message);
  const warn = reminder([], { dailyTasks: 2 }, at20);
  assert.equal(warn.level, 'warn');
  assert.equal(warn.action, 'drill --limit=1');
});

test('渲染：提醒文字 + 下一步命令；分钟目标说明只作展示', function () {
  const text = renderReminder(reminder(records, { dailyTasks: 3, dailyMinutes: 30 }, at20));
  assert.ok(text.indexOf('今天还差 2 题') > -1, text);
  assert.ok(text.indexOf('不假装统计') > -1, text);
  assert.ok(text.indexOf('node src/cli.mjs drill --limit=2') > -1, text);
});
