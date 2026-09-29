// 进度模型：纯函数，输入记录与题库，输出完成度、薄弱题与排行榜。
// 不碰文件系统，浏览器端也能直接复用同一份聚合逻辑。
// 通过线只有一处定义（judge.mjs 的 PASS_SCORE），这里不再写死 100。
import { PASS_SCORE } from './judge.mjs';
import { estimateMinutes } from './plan.mjs';

export function sortRecords(records) {
  return (records || []).slice().sort(function (a, b) {
    return String(a.at || '').localeCompare(String(b.at || ''));
  });
}

export function leaderboard(records) {
  const map = new Map();
  sortRecords(records).forEach(function (item) {
    const key = item.client || 'anonymous';
    if (!map.has(key)) {
      map.set(key, { client: key, attempts: 0, passed: 0, best: 0, sum: 0, platform: item.platform || '-', lastAt: item.at });
    }
    const row = map.get(key);
    row.attempts += 1;
    if (item.verdict === '通过') row.passed += 1;
    row.best = Math.max(row.best, Number(item.score) || 0);
    row.sum += Number(item.score) || 0;
    row.platform = item.platform || row.platform;
    row.lastAt = item.at;
  });
  return Array.from(map.values()).map(function (row) {
    row.avg = Math.round(row.sum / row.attempts);
    delete row.sum;
    return row;
  }).sort(function (a, b) { return b.best - a.best || b.passed - a.passed || b.attempts - a.attempts; });
}

export function taskStats(records, tasks) {
  const order = new Map();
  (tasks || []).forEach(function (task, index) { order.set(task.id, index); });
  const map = new Map();
  sortRecords(records).forEach(function (item) {
    if (!map.has(item.taskId)) {
      map.set(item.taskId, { taskId: item.taskId, attempts: 0, best: 0, lastScore: 0, lastVerdict: '未作答', platform: item.platform, at: item.at });
    }
    const row = map.get(item.taskId);
    row.attempts += 1;
    row.best = Math.max(row.best, Number(item.score) || 0);
    row.lastScore = Number(item.score) || 0;
    row.lastVerdict = item.verdict || '未作答';
    row.platform = item.platform || row.platform;
    row.at = item.at;
  });
  const taskById = new Map((tasks || []).map(function (task) { return [task.id, task]; }));
  const known = [];
  const unknown = [];
  map.forEach(function (row, id) {
    const task = taskById.get(id);
    if (task) known.push(Object.assign({ title: task.title, track: task.track }, row));
    else unknown.push(row);
  });
  known.sort(function (a, b) { return (order.get(a.taskId) || 0) - (order.get(b.taskId) || 0); });
  return { known: known, unknown: unknown };
}

export function summarize(records, tasks) {
  const list = tasks || [];
  const stats = taskStats(records, list);
  const passedIds = new Set(stats.known.filter(function (row) { return row.best >= PASS_SCORE; }).map(function (row) { return row.taskId; }));
  const attemptedIds = new Set(stats.known.map(function (row) { return row.taskId; }));

  const trackMap = new Map();
  list.forEach(function (task) {
    if (!trackMap.has(task.track)) trackMap.set(task.track, { track: task.track, total: 0, passed: 0, attempted: 0 });
    const row = trackMap.get(task.track);
    row.total += 1;
    if (passedIds.has(task.id)) row.passed += 1;
    if (attemptedIds.has(task.id)) row.attempted += 1;
  });
  const byTrack = Array.from(trackMap.values()).map(function (row) {
    row.percent = row.total ? Math.round(row.passed / row.total * 100) : 0;
    return row;
  }).sort(function (a, b) { return a.track.localeCompare(b.track); });

  const weak = stats.known
    .filter(function (row) { return row.best < PASS_SCORE; })
    .sort(function (a, b) { return a.best - b.best || b.attempts - a.attempts; })
    .map(function (row) {
      return {
        taskId: row.taskId,
        title: row.title,
        track: row.track,
        best: row.best,
        attempts: row.attempts,
        lastVerdict: row.lastVerdict
      };
    });

  return {
    total: list.length,
    attempted: attemptedIds.size,
    passed: passedIds.size,
    percent: list.length ? Math.round(passedIds.size / list.length * 100) : 0,
    byTrack: byTrack,
    weak: weak
  };
}

// 训练优先级：分数越低、错得越多，权重越高。
// 公式刻意简单可解释：weight = (100 - 最高分) + 还没满分时的次数 * 5。
//
// 次数的加成**只在还没满分时给**。原先是无条件加，实测出一个反直觉的结果：
// 一道满分练过 20 次的题权重 100，压过了 50 分练过两次的题（60 分）和从没练过的题（0）——
// 也就是说"越熟练越该先练"，与界面写的"按薄弱程度加权"正好相反。
// 反复没过确实比一次没过更该练，所以加成保留；但已经满分的题不该再因为练得多而往上排。
export function practiceWeight(best, attempts) {
  const safeBest = Math.max(0, Math.min(PASS_SCORE, Number(best) || 0));
  const tries = safeBest >= PASS_SCORE ? 0 : (Number(attempts) || 0) * 5;
  return (PASS_SCORE - safeBest) + tries;
}

// 挑选要练的题。三种模式：
//   weak（默认）只挑练过但没满分的；new 挑完全没练过的；all 全都要。
// 返回按权重降序的列表，CLI 的 drill 与 Web 首页的"今日建议"共用这一份逻辑。
export function pickPractice(records, tasks, options) {
  const opts = options || {};
  const mode = ['weak', 'new', 'all'].indexOf(opts.mode) > -1 ? opts.mode : 'weak';
  const limit = Math.max(1, Number(opts.limit) || 5);
  const track = opts.track && opts.track !== 'all' ? opts.track : null;
  const pool = (tasks || []).filter(function (task) { return !track || task.track === track; });
  const stats = new Map(taskStats(records, pool).known.map(function (row) { return [row.taskId, row]; }));
  const attempted = new Set((records || []).map(function (item) { return item.taskId; }));

  const candidates = pool.filter(function (task) {
    const row = stats.get(task.id);
    if (mode === 'all') return true;
    if (mode === 'new') return !attempted.has(task.id);
    return Boolean(row) && row.best < PASS_SCORE;
  });

  const rows = candidates.map(function (task) {
    const row = stats.get(task.id);
    const best = row ? row.best : 0;
    const attempts = row ? row.attempts : 0;
    return {
      taskId: task.id,
      title: task.title,
      track: task.track,
      goal: task.goal,
      best: best,
      attempts: attempts,
      weight: row ? practiceWeight(best, attempts) : 0,
      reason: row ? '最高 ' + best + ' 分，练过 ' + attempts + ' 次' : '还没练过'
    };
  });

  rows.sort(function (a, b) {
    if (b.weight !== a.weight) return b.weight - a.weight;
    // 同权重时让"练得少"的排在前面：满分题与没练过的题权重都是 0，
    // 这时该先练没练过的（否则 全部 模式下会把练熟的题排在生题前面）。
    if (a.attempts !== b.attempts) return a.attempts - b.attempts;
    return String(a.taskId).localeCompare(String(b.taskId));
  });
  return rows.slice(0, limit);
}

// 日期口径只有一份实现：core/day.mjs（本地时区）。import 建立本地绑定，并 re-export 给调用方。
import { dayKey, streakDays } from './day.mjs';
export { dayKey, streakDays };

// 连续学习天数：从今天（或昨天，今天还没练也不算断）往前数，直到某个没有记录的日期。

// 每日一题：同一份记录 + 同一天，结果稳定（可校验、可对比）。
// 优先从"练过但没满分"里选，没有就从未练习里选；用日期做种子挑一道。
// 每日一题为什么推荐它：三个客户端显示同一句（见 dailyPick 里的 why）
export function dailyWhy(pool, pick) {
  const row = pick || {};
  if (pool === 'review') return row.reason || '该复习了';
  if (pool === 'weak') return '上次没满分' + (row.best || row.best === 0 ? '（最好 ' + row.best + ' 分）' : '');
  return '还没练过';
}

export function dailyPick(records, tasks, options) {
  const opts = options || {};
  const date = dayKey(opts.date || new Date());
  const pool = (opts.tasks || tasks || []).filter(function (task) {
    return !opts.track || opts.track === 'all' || task.track === opts.track;
  });
  if (!pool.length || !date) return null;

  // 优先级：该复习的 > 练过但没满分 > 完全没练过
  const dueReviews = reviewQueue(records, pool, { now: opts.date || new Date(), limit: pool.length }).due;
  const weak = pickPractice(records, pool, { mode: 'weak', limit: pool.length, track: opts.track });
  const fresh = pickPractice(records, pool, { mode: 'new', limit: pool.length, track: opts.track });
  const poolName = dueReviews.length ? 'review' : (weak.length ? 'weak' : 'new');
  const candidates = dueReviews.length ? dueReviews.map(function (row) {
    return { taskId: row.taskId, title: row.title, track: row.track, best: row.lastScore, attempts: 0, weight: 0, reason: row.reason };
  }) : (weak.length ? weak : fresh);
  if (!candidates.length) return null;

  // 日期 -> 一个稳定的整数种子
  let seed = 0;
  for (let i = 0; i < date.length; i += 1) seed = (seed * 31 + date.charCodeAt(i)) % 100000;
  const chosen = candidates[seed % candidates.length];
  // why 是给界面直接显示的**唯一一份**文案：以前三个客户端各自拼句子，结果
  //   · 网页版把 pool 当成标签又拼了一次（review 时显示"来源：还没练过　该复习了（已逾期 2 天）"，自相矛盾）；
  //   · 命令行在 review 时也写"还没练过"（同样错）；
  //   · 原生端又把服务端的整句话包了一层括号（"该复习了（该复习了（已逾期 1 天））"）。
  // 现在谁都不拼，客户端只负责原样显示。
  return Object.assign({}, chosen, { date: date, pool: poolName, why: dailyWhy(poolName, chosen) });
}

// 学习目标进度：tasksToday 统计"今天通过的题"（同一题当天多次只算一次），
// minutesToday 用 plan.estimateMinutes 折算"今天碰过的题"。
//
// 时长为什么按"碰过"而不是"通过"算：实测（真实 CLI）今天认真做了 3 道题但都没过，
// 界面写的是「今日通过 0 题　约 0 分钟」——投入的时间被记成了零。
// 于是同一个目标里，题数看"通过"（学会了几道），分钟看"练习"（花了多少时间），两者口径不同但都真实。
export function goalProgress(records, tasks, goals, now) {
  const when = now ? new Date(now) : new Date();
  const today = dayKey(when);
  const goal = goals || {};
  const taskById = new Map((tasks || []).map(function (task) { return [task.id, task]; }));
  const passedToday = new Map();

  (records || []).forEach(function (item) {
    if (dayKey(item.at) !== today) return;
    if ((Number(item.score) || 0) < PASS_SCORE) return;
    if (!passedToday.has(item.taskId)) passedToday.set(item.taskId, item);
  });

  // 今天的练习量：每道碰过的题只折一次（同一题反复练不等于练了很多道新题）
  const touchedToday = new Set();
  (records || []).forEach(function (item) {
    if (dayKey(item.at) !== today) return;
    if (item.taskId) touchedToday.add(item.taskId);
  });
  let minutesToday = 0;
  touchedToday.forEach(function (taskId) {
    const task = taskById.get(taskId);
    minutesToday += task ? estimateMinutes(task) : 0;
  });

  const tasksTarget = Math.max(0, Number(goal.dailyTasks) || 0);
  const minutesTarget = Math.max(0, Number(goal.dailyMinutes) || 0);
  return {
    date: today,
    tasksToday: passedToday.size,
    tasksTarget: tasksTarget,
    minutesToday: minutesToday,
    minutesTarget: minutesTarget,
    tasksMet: tasksTarget > 0 && passedToday.size >= tasksTarget,
    minutesMet: minutesTarget > 0 && minutesToday >= minutesTarget,
    hasGoal: tasksTarget > 0 || minutesTarget > 0,
    summary: (tasksTarget > 0 ? ('今日通过 ' + passedToday.size + '/' + tasksTarget + ' 题') : ('今日通过 ' + passedToday.size + ' 题'))
      + (minutesTarget > 0
        ? '　约 ' + minutesToday + '/' + minutesTarget + ' 分钟（含没通过的练习）'
        : '　约 ' + minutesToday + ' 分钟（含没通过的练习）')
  };
}

// ---------------- 复习节奏（间隔重复，规则刻意简单可解释） ----------------
// 未通过 → 1 天后重来；通过就拉长：一次通过 7 天，曾经错过则按"错过几次"给 3 天或 2 天，
// 连续通过 n 次（n≥2）按 7n 天，最长不超过 30 天。
// 状态完全从记录推导，不额外存一份"复习计划"，所以不会和真实练习历史脱节。
//
// 为什么"错过几次"要分开：实测原先无论错过 1 次还是 6 次，回来复习的间隔都是 3 天——
// 一道反复栽跟头的题和一道偶尔手滑的题被同等对待，这与间隔重复的目的（记不牢的题回得更勤）相反。
export const REVIEW_MAX_INTERVAL_DAYS = 30;

export function reviewSchedule(records, taskId, now) {
  const when = now ? new Date(now) : new Date();
  const rows = (records || [])
    .filter(function (item) { return item.taskId === taskId; })
    .slice()
    .sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); });
  if (!rows.length) {
    return { taskId: taskId, attempted: false, due: false, dueAt: null, intervalDays: null, streak: 0, reason: '还没练过' };
  }
  const last = rows[rows.length - 1];
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if ((Number(rows[i].score) || 0) >= PASS_SCORE) streak += 1;
    else break;
  }
  const failures = rows.filter(function (item) { return (Number(item.score) || 0) < PASS_SCORE; }).length;
  const everFailed = failures > 0;
  const passed = (Number(last.score) || 0) >= PASS_SCORE;
  let intervalDays;
  if (!passed) intervalDays = 1;
  else if (streak === 1) intervalDays = everFailed ? (failures >= 3 ? 2 : 3) : 7;
  else intervalDays = Math.min(REVIEW_MAX_INTERVAL_DAYS, 7 * streak);

  const lastAt = new Date(last.at);
  const dueAt = new Date(lastAt.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  const due = dueAt.getTime() <= when.getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const overdueDays = due ? Math.floor((when.getTime() - dueAt.getTime()) / DAY_MS) : 0;
  const remainMs = dueAt.getTime() - when.getTime();
  const waitDays = Math.ceil(remainMs / DAY_MS);
  // 不到一天就别再说"还有 1 天"：实测距到期还有 1 小时时，界面说的是"还有 1 天"，与事实不符。
  // 边界按毫秒判：正好还剩 24 小时仍然说"还有 1 天"，只有真的不到一天才换成小时。
  const waitHours = Math.max(1, Math.ceil(remainMs / (60 * 60 * 1000)));
  return {
    taskId: taskId,
    attempted: true,
    lastAt: last.at,
    lastVerdict: last.verdict,
    lastScore: Number(last.score) || 0,
    streak: streak,
    everFailed: everFailed,
    intervalDays: intervalDays,
    dueAt: dueAt.toISOString(),
    due: due,
    overdueDays: overdueDays,
    // 到期理由要写"逾期了多久"，而不是只说节奏定的天数：
    // 1 天节奏但 3 天没碰，说"1 天前学过"会让人以为自己记错了（网页版/CLI/原生三端都显示这句）
    reason: due
      ? (overdueDays > 0 ? ('该复习了（已逾期 ' + overdueDays + ' 天）') : '该复习了（今天到期）')
      : ('还没到复习时间（还有 ' + (remainMs >= DAY_MS ? waitDays + ' 天' : waitHours + ' 小时') + '）')
  };
}

// 复习队列：把练过的题按"该复习的优先、越久没管越靠前"排出来。
export function reviewQueue(records, tasks, options) {
  const opts = options || {};
  const when = opts.now ? new Date(opts.now) : new Date();
  const limit = Math.max(1, Number(opts.limit) || 10);
  const track = opts.track && opts.track !== 'all' ? opts.track : null;
  const pool = (tasks || []).filter(function (task) { return !track || task.track === track; });

  const rows = pool.map(function (task) {
    const schedule = reviewSchedule(records, task.id, when);
    return Object.assign({ title: task.title, track: task.track }, schedule);
  }).filter(function (row) { return row.attempted; });

  rows.sort(function (a, b) {
    if (a.due !== b.due) return a.due ? -1 : 1;
    if (a.due && b.due) return String(a.dueAt).localeCompare(String(b.dueAt));
    return String(a.dueAt).localeCompare(String(b.dueAt));
  });
  return { due: rows.filter(function (row) { return row.due; }).slice(0, limit), upcoming: rows.filter(function (row) { return !row.due; }) };
}

// 学习报告（Markdown）：CLI 与网页版导出共用同一份渲染逻辑
// 完成度文案：整数够用就整数；不足 1% 但确实有进度时给一位小数（避免「通过 2 题 / 587 题」显示成 0%）
export function percentText(passed, total, rounded) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safePassed = Number(passed) || 0;
  const value = typeof rounded === 'number' ? rounded : Math.round(safePassed / safeTotal * 100);
  if (value === 0 && safePassed > 0) return (Math.round(safePassed / safeTotal * 1000) / 10) + '%';
  return value + '%';
}

export function renderReport(records, tasks, options) {
  const opts = options || {};
  const summary = summarize(records, tasks);
  const stats = taskStats(records, tasks);
  const board = leaderboard(records);
  const streak = streakDays(records, opts.now);
  const lines = [];
  lines.push('# dsh-learn 学习报告');
  lines.push('');
  lines.push('- 生成时间：' + new Date(opts.now || Date.now()).toISOString());
  lines.push('- 题库规模：' + summary.total + ' 题（通过 ' + summary.passed + ' 题）');
  // 587 道题里通过 2 道，取整会显示 0%——「做了事但报告说 0%」最打击人，也最没用。
  // 小于 1% 但确实有进度时给一位小数（0.3%），0 才写 0%。
  lines.push('- 整体完成度：' + percentText(summary.passed, summary.total, summary.percent) + '　连续学习：' + streak + ' 天');
  lines.push('- 提交次数：' + (records || []).length + '　参与客户端：' + board.length);
  lines.push('');
  lines.push('## 分轨道进度');
  lines.push('');
  lines.push('| 轨道 | 通过 / 总数 | 完成度 |');
  lines.push('| --- | --- | --- |');
  // 24 条轨道里 22 条是 0% 的时候，整张表只是刷屏：只列有进度的，其余用一行说明。
  const touched = summary.byTrack.filter(function (row) { return row.passed > 0; });
  const untouched = summary.byTrack.length - touched.length;
  touched.forEach(function (row) {
    lines.push('| ' + row.track + ' | ' + row.passed + ' / ' + row.total + ' | ' + percentText(row.passed, row.total, row.percent) + ' |');
  });
  if (!touched.length) lines.push('| （还没开始） | 0 / ' + summary.total + ' | 0% |');
  if (untouched) {
    lines.push('');
    lines.push('其余 ' + untouched + ' 条轨道还没开始练（共 ' + summary.byTrack.length + ' 条；`node src/cli.mjs list --track=all` 看全部）。');
  }
  lines.push('');
  lines.push('## 需要重练');
  lines.push('');
  if (summary.weak.length) {
    lines.push('| 题目 | 最高分 | 练过次数 | 上次判定 |');
    lines.push('| --- | --- | --- | --- |');
    summary.weak.slice(0, 15).forEach(function (row) {
      lines.push('| ' + row.taskId + ' | ' + row.best + ' | ' + row.attempts + ' | ' + row.lastVerdict + ' |');
    });
  } else {
    lines.push('已练习的题目全部满分。');
  }
  lines.push('');
  lines.push('## 最近提交');
  lines.push('');
  lines.push('| 时间 | 题目 | 判定 | 平台 | 客户端 |');
  lines.push('| --- | --- | --- | --- | --- |');
  (records || []).slice(-20).reverse().forEach(function (item) {
    lines.push('| ' + String(item.at || '').replace('T', ' ').slice(0, 19) + ' | ' + item.taskId + ' | ' + item.verdict
      + '（' + item.score + '） | ' + (item.platform || '-') + ' | ' + (item.client || '-') + ' |');
  });
  lines.push('');
  lines.push('## 客户端排行');
  lines.push('');
  lines.push('| 客户端 | 提交 | 通过 | 最高分 | 均分 | 平台 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  board.forEach(function (row) {
    lines.push('| ' + row.client + ' | ' + row.attempts + ' | ' + row.passed + ' | ' + row.best + ' | ' + row.avg + ' | ' + row.platform + ' |');
  });
  if (stats.unknown.length) {
    lines.push('');
    lines.push('> 有 ' + stats.unknown.length + ' 条记录对应的题目已不在题库里（题库变动或外部包未加载）。');
  }
  return lines.join('\n') + '\n';
}

export function bar(percent, width) {
  const size = width || 16;
  const filled = Math.max(0, Math.min(size, Math.round((percent || 0) / 100 * size)));
  return '[' + '#'.repeat(filled) + '.'.repeat(size - filled) + ']';
}
