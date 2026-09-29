// 日期口径回归：UTC+8 凌晨的练习，进度与趋势/提醒必须同一天（这正是修掉的那个 bug）。
//
// 为什么要开子进程：dayKey 用**本地时区**，而进程时区只能靠 TZ 环境变量在启动时决定。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function runTz(tz) {
  const script = [
    "const { dayKey: dTrend } = await import('" + ROOT + "src/core/trend.mjs');",
    "const { dayKey: dProg, streakDays } = await import('" + ROOT + "src/core/progress.mjs');",
    "const { reminder } = await import('" + ROOT + "src/core/reminder.mjs');",
    "const rec = [{ taskId: 'a', at: '2026-09-29T00:30:00+08:00', score: 100 }];",
    "const now = '2026-09-29T01:00:00+08:00';",
    "const r = reminder(rec, { dailyTasks: 1 }, { now: now });",
    "console.log(JSON.stringify({ tz: process.env.TZ, trend: dTrend(rec[0].at), progress: dProg(rec[0].at), streak: streakDays(rec, { now: now }), level: r.level, message: r.message }));"
  ].join(String.fromCharCode(10));
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { TZ: tz })
  });
  assert.equal(out.status, 0, '子进程应当成功：' + String(out.stderr || '').slice(0, 300));
  return JSON.parse(out.stdout);
}

test('UTC+8：凌晨 00:30 的练习算「今天」，两个口径一致，提醒不会说还没练', function () {
  const got = runTz('Asia/Shanghai');
  assert.equal(got.tz, 'Asia/Shanghai');
  assert.equal(got.trend, got.progress, '趋势与进度的分日必须一致（修前一个按 UTC、一个按本地）');
  assert.equal(got.trend, '2026-09-29', '凌晨本地练习属于本地当天：' + got.trend);
  assert.equal(got.streak, 1);
  assert.equal(got.level, 'none', '已完成不该提醒：' + got.message);
  assert.ok(got.message.indexOf('已完成') > -1, got.message);
});

test('UTC：同一时刻同样自洽（差异只在时区，不在实现）', function () {
  const got = runTz('UTC');
  assert.equal(got.trend, got.progress);
  assert.equal(got.trend, '2026-09-28', 'UTC 下那一刻仍是 28 号：' + got.trend);
  assert.equal(got.level, 'none', 'UTC 下也算同一天完成：' + got.message);
});
