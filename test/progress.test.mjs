import test from 'node:test';
import assert from 'node:assert/strict';
import { leaderboard, summarize, taskStats, bar, percentText, pickPractice, practiceWeight, streakDays, dailyPick, dailyWhy, renderReport, dayKey, reviewSchedule, reviewQueue, goalProgress, REVIEW_MAX_INTERVAL_DAYS } from '../src/core/progress.mjs';
import { TASKS } from '../src/core/tasks.mjs';

const records = [
  { client: 'mac-air', taskId: 'docker.run-web', score: 40, verdict: '未通过', platform: 'darwin', at: '2026-01-01T00:00:00.000Z' },
  { client: 'mac-air', taskId: 'docker.run-web', score: 100, verdict: '通过', platform: 'darwin', at: '2026-01-01T00:05:00.000Z' },
  { client: 'linux-box', taskId: 'linux.sed-inplace', score: 37, verdict: '未通过', platform: 'linux', at: '2026-01-01T00:06:00.000Z' },
  { client: 'web-demo', taskId: 'linux.date-offset', score: 100, verdict: '通过', platform: 'darwin', at: '2026-01-01T00:07:00.000Z' }
];

test('排行榜按最高分排序并聚合提交次数', function () {
  const rows = leaderboard(records);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].client, 'mac-air');
  assert.equal(rows[0].best, 100);
  assert.equal(rows[0].attempts, 2);
  assert.equal(rows[0].passed, 1);
  assert.equal(rows[0].avg, 70);
  assert.equal(rows.find(function (r) { return r.client === 'web-demo'; }).attempts, 1);
});

test('按题目聚合保留最后一次判定与最高分', function () {
  const stats = taskStats(records, TASKS);
  const runWeb = stats.known.find(function (row) { return row.taskId === 'docker.run-web'; });
  assert.equal(runWeb.best, 100);
  assert.equal(runWeb.attempts, 2);
  assert.equal(runWeb.lastVerdict, '通过');
  assert.equal(runWeb.title, '后台启动 nginx 并映射端口');
  assert.deepEqual(stats.unknown, []);
});

test('汇总给出总完成度与分轨道进度', function () {
  const summary = summarize(records, TASKS);
  assert.equal(summary.total, TASKS.length);
  assert.equal(summary.passed, 2);
  assert.equal(summary.attempted, 3);
  assert.equal(summary.percent, Math.round(2 / TASKS.length * 100));
  const docker = summary.byTrack.find(function (row) { return row.track === 'docker'; });
  assert.ok(docker.total >= 6);
  assert.equal(docker.attempted, 1);
  const linux = summary.byTrack.find(function (row) { return row.track === 'linux'; });
  assert.equal(linux.passed, 1);
});

test('薄弱题按分数升序列出，已满分的不再出现', function () {
  const summary = summarize(records, TASKS);
  assert.equal(summary.weak.length, 1);
  assert.equal(summary.weak[0].taskId, 'linux.sed-inplace');
  assert.equal(summary.weak[0].best, 37);
  assert.ok(summary.weak.every(function (row) { return row.best < 100; }));
});

test('空记录不炸，进度为 0', function () {
  const summary = summarize([], TASKS);
  assert.equal(summary.attempted, 0);
  assert.equal(summary.percent, 0);
  assert.deepEqual(summary.weak, []);
  assert.deepEqual(leaderboard([]), []);
});

test('训练权重：分数越低、没满分时练得越多越靠前', function () {
  // 原来这里断言 practiceWeight(100, 9) === 45 —— 那是把 bug 当成了规格：
  // 满分题因为练得多被加权，实测 满分练 20 次（100）会压过 50 分练两次（60），
  // 与界面写的「按薄弱程度加权」正好相反。
  assert.equal(practiceWeight(100, 9), 0, '已经满分的题不该因为练得多而加权');
  assert.equal(practiceWeight(0, 1), 105);
  assert.equal(practiceWeight(50, 2), 60);
  assert.ok(practiceWeight(40, 3) > practiceWeight(40, 1), '同样分数，练得多的排前面');
  assert.ok(practiceWeight(20, 1) > practiceWeight(80, 1), '分低的排前面');
  assert.ok(practiceWeight(50, 2) > practiceWeight(100, 20), '没满分的题永远排在满分题前面');
});

// 实测出来的排序病：全部模式下「满分练 20 次」曾经排在「练过两次没过」和「从没练过」前面，
// 也就是把最熟的题推荐成最该练的。权重修好后，同权重还要让「练得少」的排前面。
test('pickPractice：全部模式下没练过的题排在练熟的题前面', function () {
  const now = new Date().toISOString();
  const rows = [];
  for (let i = 0; i < 20; i += 1) rows.push({ client: 'c1', taskId: 't.mastered', score: 100, verdict: '通过', at: now });
  rows.push({ client: 'c1', taskId: 't.failed', score: 40, verdict: '未通过', at: now });
  rows.push({ client: 'c1', taskId: 't.failed', score: 50, verdict: '未通过', at: now });
  const tasks = [
    { id: 't.mastered', track: 'x', title: '满分练了很多次', goal: 'g' },
    { id: 't.failed', track: 'x', title: '练过两次没过', goal: 'g' },
    { id: 't.new', track: 'x', title: '从没练过', goal: 'g' }
  ];
  const order = pickPractice(rows, tasks, { mode: 'all', limit: 3 }).map(function (row) { return row.taskId; });
  assert.deepEqual(order, ['t.failed', 't.new', 't.mastered'], '排序应为：没满分的 → 没练过的 → 练熟的：' + order.join(' → '));
});

test('pickPractice：三种模式与排序、限额、轨道筛选', function () {
  const weak = pickPractice(records, TASKS, { mode: 'weak', limit: 5 });
  assert.equal(weak.length, 1, '只有 sed 那题没满分');
  assert.equal(weak[0].taskId, 'linux.sed-inplace');
  assert.equal(weak[0].weight, practiceWeight(37, 1));
  assert.match(weak[0].reason, /最高 37 分/);

  // 三种模式共用同一套权重公式，避免"全量"与"重练"给出互相矛盾的排序
  const all = pickPractice(records, TASKS, { mode: 'all', limit: 3 });
  assert.equal(all.length, 3);
  // 练过的题必须用同一份公式算权重；没练过的题固定 0（不进薄弱排序，但按「练得少优先」排在练熟的题前面）
  assert.ok(all.every(function (row) {
    return row.attempts === 0 ? row.weight === 0 : row.weight === practiceWeight(row.best, row.attempts);
  }), '全部模式的权重必须与 practiceWeight 一致：' + JSON.stringify(all.map(function (r) { return [r.taskId, r.weight, r.attempts]; })));
  assert.ok(all[0].weight >= all[1].weight && all[1].weight >= all[2].weight, '权重应降序');
  assert.equal(all[0].taskId, 'linux.sed-inplace', '37 分且练过 1 次的那题权重最高');

  const fresh = pickPractice(records, TASKS, { mode: 'new', limit: 100 });
  assert.ok(fresh.length > 0);
  assert.ok(fresh.every(function (row) { return row.attempts === 0 && row.reason === '还没练过'; }));

  const dockerOnly = pickPractice(records, TASKS, { mode: 'all', limit: 100, track: 'docker' });
  assert.ok(dockerOnly.length > 0);
  assert.ok(dockerOnly.every(function (row) { return row.track === 'docker'; }));

  assert.deepEqual(pickPractice([], TASKS, { mode: 'weak' }), []);
  assert.ok(pickPractice([], TASKS, { mode: 'new', limit: 2 }).length === 2);
  assert.deepEqual(pickPractice(records, [], { mode: 'all' }), []);
});

test('连续学习天数：今天没练不算断，从昨天往前数', function () {
  const now = new Date('2026-03-10T20:00:00');
  const mk = function (day) { return { client: 'c', taskId: 't', score: 100, verdict: '通过', at: day + 'T10:00:00' }; };
  assert.equal(streakDays([], now), 0);
  assert.equal(streakDays([mk('2026-03-10')], now), 1);
  assert.equal(streakDays([mk('2026-03-09'), mk('2026-03-08')], now), 2, '今天没练，连续天数从昨天算');
  assert.equal(streakDays([mk('2026-03-10'), mk('2026-03-09'), mk('2026-03-07')], now), 2, '中间断了一天');
  assert.equal(streakDays([{ client: 'c', taskId: 't', score: 0, verdict: '未通过', at: 'bad-date' }], now), 0);
});

test('每日一题：同一天结果稳定，优先挑该复习的题', function () {
  const now = new Date('2026-03-10T09:00:00');
  const first = dailyPick(records, TASKS, { date: now });
  const second = dailyPick(records, TASKS, { date: now });
  assert.ok(first, '应该选出题目');
  assert.equal(first.taskId, second.taskId, '同一天必须稳定');
  assert.equal(first.date, '2026-03-10');
  assert.equal(first.pool, 'review', '这些题早就该复习了，优先出复习题');
  assert.ok(['linux.sed-inplace', 'docker.run-web', 'linux.date-offset'].indexOf(first.taskId) > -1);
  assert.match(first.reason, /该复习了/);

  const other = dailyPick(records, TASKS, { date: new Date('2026-03-11T09:00:00') });
  assert.ok(other.taskId, '换一天也要有结果');

  const noRecords = dailyPick([], TASKS, { date: now });
  assert.equal(noRecords.pool, 'new', '没有练过任何题时从未练习里挑');

  assert.equal(dailyPick([], [], { date: now }), null);
  assert.equal(dailyPick(records, TASKS, { date: 'not-a-date' }), null);
});

test('每日一题：没有到期复习题时，回落到薄弱题再到新题', function () {
  // 刚通过、还没到复习时间
  const fresh = [{ client: 'c', taskId: 'docker.run-web', score: 100, verdict: '通过', at: '2026-04-09T10:00:00' }];
  const now = new Date('2026-04-10T09:00:00');
  const weakFallback = dailyPick(fresh.concat([{ client: 'c', taskId: 'linux.sed-inplace', score: 40, verdict: '未通过', at: '2026-04-10T08:00:00' }]), TASKS, { date: now });
  assert.equal(weakFallback.pool, 'weak', '没过期的题不该被当成今天的任务，薄弱题优先');

  const onlyFresh = dailyPick(fresh, TASKS, { date: now });
  assert.equal(onlyFresh.pool, 'new', '既没有到期复习题也没有薄弱题时，给没练过的题');
});

test('学习报告包含关键小节，且对空记录也能生成', function () {
  const report = renderReport(records, TASKS, { now: new Date('2026-03-10T09:00:00') });
  ['# dsh-learn 学习报告', '## 分轨道进度', '## 需要重练', '## 最近提交', '## 客户端排行', '连续学习'].forEach(function (needle) {
    assert.ok(report.indexOf(needle) > -1, '报告里缺少 ' + needle);
  });
  assert.ok(report.indexOf('linux.sed-inplace') > -1, '薄弱题应出现在报告里');
  assert.ok(report.indexOf('mac-air') > -1, '客户端排行应出现');

  const empty = renderReport([], TASKS, { now: new Date('2026-03-10T09:00:00') });
  assert.ok(empty.indexOf('已练习的题目全部满分。') > -1, '空记录时应给出可读说明');
  assert.ok(empty.length > 200);
});

// 每日一题的"为什么推荐"只有一份文案（服务端 dailyWhy 生成），三个客户端原样显示。
// 以前各自拼句子，实测出三种错法：网页版 review 时显示"来源：还没练过　该复习了（已逾期 2 天）"（自相矛盾）、
// 命令行 review 时写"还没练过"、原生端把整句又包了一层括号（"该复习了（该复习了（已逾期 1 天））"）。
test('每日一题的理由：服务端只给一句话，三个客户端原样显示', function () {
  const now = new Date('2026-03-10T09:00:00');
  const rows = [
    { client: 'c', taskId: 'linux.sed-inplace', score: 40, verdict: '未通过', at: '2026-03-06T09:00:00' }
  ];
  const review = dailyPick(rows, TASKS, { date: now });
  assert.equal(review.pool, 'review');
  assert.match(review.why, /^该复习了（/, 'review 的 why 要直接可显示：' + review.why);
  assert.equal(review.why, review.reason, 'review 的 why 就是复习计划算出的那句话');

  // 刚刚没过（还没到期）→ 该重练；从没练过 → 还没练过
  const weak = dailyPick([{ client: 'c', taskId: 'linux.sed-inplace', score: 40, verdict: '未通过', at: '2026-03-10T08:00:00' }], TASKS, { date: now });
  assert.equal(weak.pool, 'weak');
  assert.match(weak.why, /^上次没满分（最好 40 分）$/, 'weak 的 why：' + weak.why);
  const fresh = dailyPick([], TASKS, { date: now });
  assert.equal(fresh.pool, 'new');
  assert.equal(fresh.why, '还没练过');
  assert.equal(dailyWhy('new', {}), '还没练过');
  assert.equal(dailyWhy('review', {}), '该复习了', '缺 reason 时也要给一句能显示的');
});
test('复习节奏：未通过 1 天、一次通过 7 天、错过再通过 3 天、连续通过 7n 天封顶 30', function () {
  const now = new Date('2026-04-01T10:00:00');
  const mk = function (score, at) { return { client: 'c', taskId: 't', score: score, verdict: score >= 100 ? '通过' : '未通过', at: at }; };

  const never = reviewSchedule([], 't', now);
  assert.equal(never.attempted, false);
  assert.equal(never.reason, '还没练过');

  const failed = reviewSchedule([mk(40, '2026-03-30T10:00:00')], 't', now);
  assert.equal(failed.intervalDays, 1);
  assert.equal(failed.due, true, '两天前没通过，现在就该复习');
  assert.ok(failed.overdueDays >= 1);

  const firstPass = reviewSchedule([mk(100, '2026-03-30T10:00:00')], 't', now);
  assert.equal(firstPass.intervalDays, 7);
  assert.equal(firstPass.due, false);
  assert.match(firstPass.reason, /还没到复习时间/);

  const passedAfterFail = reviewSchedule([mk(40, '2026-03-28T10:00:00'), mk(100, '2026-03-30T10:00:00')], 't', now);
  assert.equal(passedAfterFail.intervalDays, 3, '错过再通过，间隔应短一些');
  assert.equal(passedAfterFail.streak, 1);

  const twoStreak = reviewSchedule([mk(100, '2026-03-29T10:00:00'), mk(100, '2026-03-30T10:00:00')], 't', now);
  assert.equal(twoStreak.intervalDays, 14);

  const longStreak = reviewSchedule([1, 2, 3, 4, 5, 6].map(function (day) { return mk(100, '2026-03-' + (24 + day) + 'T10:00:00'); }), 't', now);
  assert.equal(longStreak.streak, 6);
  assert.equal(longStreak.intervalDays, REVIEW_MAX_INTERVAL_DAYS, '间隔应封顶在 30 天');
});


// 实测出来的两个毛病：
//   1) 无论错过 1 次还是 6 次，通过后的复习间隔都是 3 天——反复栽跟头的题该回得更勤；
//   2) 距到期还有 1 小时时，界面写的是「还有 1 天」。
test('复习节奏：错过越多回得越勤，倒计时按实际距离选单位', function () {
  const now = new Date('2026-06-01T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const mk = function (taskId, score, daysAgo) {
    return { client: 'c', taskId: taskId, score: score, verdict: score >= 100 ? '通过' : '未通过', at: new Date(now.getTime() - daysAgo * day).toISOString() };
  };
  const one = reviewSchedule([mk('t', 40, 3), mk('t', 100, 2)], 't', now);
  assert.equal(one.intervalDays, 3, '错过一次再通过 → 3 天');
  const three = reviewSchedule([mk('t', 40, 6), mk('t', 30, 5), mk('t', 60, 4), mk('t', 100, 2)], 't', now);
  assert.equal(three.intervalDays, 2, '错过三次再通过 → 2 天（回得更勤）');
  const six = reviewSchedule([mk('t', 20, 9), mk('t', 30, 8), mk('t', 40, 7), mk('t', 50, 6), mk('t', 60, 5), mk('t', 70, 4), mk('t', 100, 2)], 't', now);
  assert.equal(six.intervalDays, 2, '错过六次再通过 → 同样是 2 天');
  assert.ok(three.intervalDays < reviewSchedule([mk('t', 100, 2)], 't', now).intervalDays, '错过过的题间隔必须短于一次通过（7 天）');

  // 连续通过之后仍然按 7n 走，不受失败次数影响
  const afterStreak = reviewSchedule([mk('t', 40, 30), mk('t', 100, 20), mk('t', 100, 10), mk('t', 100, 2)], 't', now);
  assert.equal(afterStreak.streak, 3);
  assert.equal(afterStreak.intervalDays, 21, '连续通过 3 次 → 21 天，与错过次数无关');

  // 倒计时单位：还剩 1 小时说小时，正好 24 小时仍说 1 天
  const anHour = reviewSchedule([{ client: 'c', taskId: 't', score: 100, verdict: '通过', at: new Date(now.getTime() - (7 * day - 60 * 60 * 1000)).toISOString() }], 't', now);
  assert.match(anHour.reason, /还有 1 小时/, '还剩 1 小时不能说成 1 天：' + anHour.reason);
  const exactlyDay = reviewSchedule([{ client: 'c', taskId: 't', score: 100, verdict: '通过', at: new Date(now.getTime() - 6 * day).toISOString() }], 't', now);
  assert.match(exactlyDay.reason, /还有 1 天/, '正好还剩一天时仍按天说：' + exactlyDay.reason);
});
test('复习队列：到期的排在前面，其余按到期时间排', function () {
  const now = new Date('2026-04-10T10:00:00');
  const records = [
    { client: 'c', taskId: 'docker.run-web', score: 100, verdict: '通过', at: '2026-04-01T10:00:00' },      // 7 天后到期 → 已过期
    { client: 'c', taskId: 'linux.stat-size', score: 100, verdict: '通过', at: '2026-04-09T10:00:00' },      // 还没到
    { client: 'c', taskId: 'git.switch-create', score: 40, verdict: '未通过', at: '2026-04-10T09:00:00' }    // 1 天后到期
  ];
  const queue = reviewQueue(records, TASKS, { now: now, limit: 5 });
  assert.equal(queue.due.length, 1, '只有 4-01 那道通过题已经到期');
  assert.equal(queue.due[0].taskId, 'docker.run-web');
  assert.equal(queue.upcoming.length, 2);
  assert.ok(queue.upcoming.every(function (row) { return row.due === false; }));
  // 到期理由要说清"逾期了多久"：只说节奏定的天数会让人以为自己记错了
  assert.equal(queue.due[0].overdueDays, 2);
  assert.match(queue.due[0].reason, /已逾期 2 天/, '到期理由应写明逾期天数：' + queue.due[0].reason);
  // 倒计时要按实际距离选单位：不到一天说小时（实测原来把"还有 1 小时"说成"还有 1 天"）
  assert.match(queue.upcoming[0].reason, /还没到复习时间（还有 \d+ (天|小时)）/, '未到期理由保留倒计时：' + queue.upcoming[0].reason);
  assert.match(queue.upcoming[0].reason, /还有 23 小时/, '一小时前没过、1 天节奏 → 还剩 23 小时：' + queue.upcoming[0].reason);
  const waitDaysRow = queue.upcoming.filter(function (row) { return row.taskId === 'linux.stat-size'; })[0];
  assert.match(waitDaysRow.reason, /还有 6 天/, '一天前一次通过、7 天节奏 → 还剩 6 天：' + waitDaysRow.reason);

  const trackOnly = reviewQueue(records, TASKS, { now: now, limit: 5, track: 'git' });
  assert.ok(trackOnly.due.concat(trackOnly.upcoming).every(function (row) { return row.track === 'git'; }));

  assert.deepEqual(reviewQueue([], TASKS, { now: now }).due, []);
});

// 日期一律按"学习者本地时区"算：记录存的是 UTC ISO，但跨天要按本地日切。
// 这几条把边界钉住（曾经在设计上就是对的，但没人测过，重构一次就可能悄悄改坏）。
test('跨天边界：本地日切分、连续天数、未来时间戳与坏时间戳', function () {
  const local = function (text) { return new Date(text).toISOString(); };   // 本地时间 → UTC 存储
  const mk = function (text) { return { client: 'c', taskId: 't', score: 100, verdict: '通过', at: local(text) }; };

  // 1) 昨天 23:50 练过，今天 00:10 来看：连续天数应为 1（今天还没练不算断）
  const lastNight = [mk('2026-09-26T23:50:00')];
  assert.equal(dayKey(lastNight[0].at), '2026-09-26', '记录应落在本地日 9-26');
  assert.equal(streakDays(lastNight, new Date('2026-09-27T00:10:00')), 1);

  // 2) 今天凌晨 00:05 的记录属于"今天"
  const goal = goalProgress([mk('2026-09-27T00:05:00')], TASKS, { dailyTasks: 3 }, new Date('2026-09-27T00:20:00'));
  assert.equal(goal.tasksToday, 1, '凌晨的记录要算进今天');
  assert.equal(streakDays([mk('2026-09-27T00:30:00')], new Date('2026-09-27T01:00:00')), 1);

  // 3) 中间断了就只数到今天
  const gap = [mk('2026-09-24T10:00:00'), mk('2026-09-27T09:00:00')];
  assert.equal(streakDays(gap, new Date('2026-09-27T10:00:00')), 1);

  // 4) 未来时间戳（时钟漂移）不该被当成"今天练过"
  assert.equal(streakDays([mk('2026-12-31T10:00:00')], new Date('2026-09-27T10:00:00')), 0);

  // 5) 坏时间戳跳过而不是崩
  assert.equal(dayKey('不是时间'), null);
  assert.equal(streakDays([{ client: 'c', taskId: 't', score: 100, verdict: '通过', at: '不是时间' }], new Date('2026-09-27T10:00:00')), 0);
});

test('每日一题优先给"该复习的题"', function () {
  const now = new Date('2026-04-10T10:00:00');
  const records = [{ client: 'c', taskId: 'docker.run-web', score: 100, verdict: '通过', at: '2026-04-01T10:00:00' }];
  const picked = dailyPick(records, TASKS, { date: now });
  assert.equal(picked.pool, 'review');
  assert.equal(picked.taskId, 'docker.run-web');
  assert.match(picked.reason, /该复习了/);
});

test('学习目标：统计今天通过的题与折算时长', function () {
  const now = new Date('2026-04-10T20:00:00');
  const records = [
    { client: 'c', taskId: 'docker.run-web', score: 100, verdict: '通过', at: '2026-04-10T09:00:00' },
    { client: 'c', taskId: 'docker.run-web', score: 100, verdict: '通过', at: '2026-04-10T09:30:00' },
    { client: 'c', taskId: 'git.switch-create', score: 100, verdict: '通过', at: '2026-04-10T10:00:00' },
    { client: 'c', taskId: 'linux.stat-size', score: 40, verdict: '未通过', at: '2026-04-10T11:00:00' },
    { client: 'c', taskId: 'k8s.get-pods-wide', score: 100, verdict: '通过', at: '2026-04-09T11:00:00' }
  ];
  const progressToday = goalProgress(records, TASKS, { dailyTasks: 3, dailyMinutes: 20 }, now);
  assert.equal(progressToday.date, '2026-04-10');
  assert.equal(progressToday.tasksToday, 2, '同一题当天通过多次只算一次；昨天的题不算');
  assert.equal(progressToday.tasksMet, false);
  assert.ok(progressToday.minutesToday > 0);
  assert.match(progressToday.summary, /今日通过 2\/3 题/);

  const noGoal = goalProgress(records, TASKS, {}, now);
  assert.equal(noGoal.hasGoal, false);
  assert.equal(noGoal.tasksMet, false, '没设目标就不该报"已达成"');
});


// 实测：今天认真做了 3 道题但都没过，界面写的是「今日通过 0 题　约 0 分钟」——
// 投入的时间被记成零。现在分钟按「今天碰过的题」折算（题数仍按「通过」算），两者口径不同但都真实。
test('学习目标：没通过的练习也算投入时长（题数仍只算通过）', function () {
  const now = new Date('2026-04-10T20:00:00');
  const records = [
    { client: 'c', taskId: 'docker.run-web', score: 40, verdict: '未通过', at: '2026-04-10T09:00:00' },
    { client: 'c', taskId: 'docker.run-web', score: 50, verdict: '未通过', at: '2026-04-10T09:10:00' },
    { client: 'c', taskId: 'git.switch-create', score: 30, verdict: '未通过', at: '2026-04-10T09:20:00' }
  ];
  const progress = goalProgress(records, TASKS, { dailyTasks: 3, dailyMinutes: 20 }, now);
  assert.equal(progress.tasksToday, 0, '一道都没通过，题数就是 0');
  assert.ok(progress.minutesToday > 0, '练过就该有时长，不能是 0：' + progress.minutesToday);
  assert.match(progress.summary, /含没通过的练习/, '文案要说清分钟包含没通过的练习：' + progress.summary);
  assert.equal(progress.minutesMet, progress.minutesToday >= 20, '时长目标按投入算');

  // 同一题反复练不等于练了很多道新题：分钟只按题折一次
  const once = goalProgress([records[0]], TASKS, {}, now).minutesToday;
  const twice = goalProgress([records[0], records[1]], TASKS, {}, now).minutesToday;
  assert.equal(twice, once, '同一道题练两次，折算时长不变');
});
// 实测：587 道题里通过 1 道，学习报告写的是「整体完成度：0%」——做了事却像没做。
// 另外 24 条轨道里 22 条是 0% 时，整张表只是刷屏（报告 57 行 → 只列有进度的 34 行）。
test('学习报告：不足 1% 的进度给小数，0% 的轨道不占表格', function () {
  assert.equal(percentText(1, 587, 0), '0.2%', '有进度但不足 1% 时要给一位小数');
  assert.equal(percentText(0, 587, 0), '0%', '真的没有进度才写 0%');
  assert.equal(percentText(2, 3, 67), '67%', '整数够用时保持整数');
  assert.equal(percentText(43, 43, 100), '100%');

  const now = new Date('2026-04-10T10:00:00');
  const records = [
    { client: 'c', taskId: 'docker.run-web', score: 100, verdict: '通过', at: '2026-04-10T09:00:00' },
    { client: 'c', taskId: 'netops.iperf3', score: 33, verdict: '未通过', at: '2026-04-10T09:10:00' }
  ];
  const report = renderReport(records, TASKS, { now: now });
  assert.match(report, /整体完成度：0\.0%|整体完成度：0\.1%|整体完成度：0\.2%/, '报告里的完成度要给小数：' + report.split(String.fromCharCode(10))[4]);
  assert.match(report, /其余 \d+ 条轨道还没开始练/, '没进度的轨道用一行说明，不占表格');
  assert.equal(/\| c \| 0 \/ 11 \|/.test(report), false, '0% 的轨道不该出现在表格里');
  assert.match(report, /\| docker \| 1 \/ 43 \| 2% \|/, '有进度的轨道要留着');

  // 一道都没通过时，表格给一行占位，而不是空表
  const empty = renderReport([{ client: 'c', taskId: 'netops.iperf3', score: 33, verdict: '未通过', at: '2026-04-10T09:10:00' }], TASKS, { now: now });
  assert.match(empty, /\| （还没开始） \| 0 \/ \d+ \| 0% \|/, '没通过任何题时表格要有占位行');
});
test('进度条渲染稳定', function () {
  assert.equal(bar(0, 4), '[....]');
  assert.equal(bar(100, 4), '[####]');
  assert.equal(bar(50, 4), '[##..]');
});
