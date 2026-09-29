// 学习相关命令：progress / daily / report / plan / drill / repl。
import { findTask, listTasks, TASKS } from '../../core/tasks.mjs';
import { judge, resolveTask } from '../../core/judge.mjs';
import { summarize, bar, percentText, pickPractice, streakDays, dailyPick, renderReport, reviewQueue, goalProgress } from '../../core/progress.mjs';
import { buildPlan, renderPlanText, planProgress, renderPlanProgressText } from '../../core/plan.mjs';
import { record, load, storageHealth, readGoals, writeGoals, readNote, readNotes, writeNote, deleteNote, notesPath, goalsPath } from '../../store.mjs';
import { createInterface } from 'node:readline/promises';
import { writeFileSync } from 'node:fs';

export async function progress(ctx) {
  const { asJson, out } = ctx;
  const summary = summarize(load().records, TASKS);
  const health = storageHealth();
  if (asJson) {
    out(Object.assign({}, summary, { storage: health }));
  } else {
    if (health.recoveredFromBackup) console.error('注意：progress.json 损坏过，已从 .bak 恢复（坏文件改名留在 ' + (health.quarantinedFile || '-') + '）');
    if (health.brokenJournalLines) console.error('注意：进度日志里有 ' + health.brokenJournalLines + ' 行无法解析（多半是写入中途被打断），已忽略。');
  }
  if (!asJson) {
    console.log('整体进度 ' + percentText(summary.passed, summary.total, summary.percent) + '　' + bar(summary.percent) + '　通过 ' + summary.passed + ' / ' + summary.total + '（已练习 ' + summary.attempted + ' 题）');
    console.log('连续学习 ' + streakDays(load().records) + ' 天');
    summary.byTrack.forEach(function (row) {
      console.log('  [' + row.track + '] ' + String(row.percent).padStart(3) + '% ' + bar(row.percent, 12) + '　通过 ' + row.passed + '/' + row.total);
    });
    if (summary.weak.length) {
      console.log('需要重练：');
      summary.weak.slice(0, 8).forEach(function (row) {
        console.log('  ' + row.taskId + '（最高 ' + row.best + ' 分，练了 ' + row.attempts + ' 次）' + row.title);
      });
    } else if (summary.attempted) {
      console.log('已练习的题目全部满分。');
    }
  }
}

export async function daily(ctx) {
  const { args, platform, asJson, out } = ctx;
  const picked = dailyPick(load().records, TASKS, {
    track: typeof args.track === 'string' ? args.track : 'all',
    tasks: TASKS
  });
  if (!picked) {
    console.log('题库为空，没有可推荐的内容。');
  } else if (asJson) {
    out(Object.assign({}, picked, { hint: resolveTask(findTask(picked.taskId), platform).hint }));
  } else {
    const task = resolveTask(findTask(picked.taskId), platform);
    // 来源那句话由服务端给（dailyWhy）：三个客户端不再各拼一份
    console.log('每日一题（' + picked.date + '，来源：' + (picked.why || picked.reason || '') + '）');
    console.log('  [' + task.track + '] ' + task.id + '　' + task.title);
    console.log('  目标：' + task.goal);
    console.log('  提示：' + task.hint);
    console.log('  判定：node src/cli.mjs check ' + task.id + ' "<你的命令>" --platform=' + platform);
  }
}

// 复习队列：按间隔重复算出来的"该复习了"，与每日一题共用一套规则
export async function review(ctx) {
  const { args, asJson, out } = ctx;
  const limit = Number(args.limit) || 10;
  const track = typeof args.track === 'string' ? args.track : 'all';
  const queue = reviewQueue(load().records, TASKS, { limit: limit, track: track });

  if (asJson) {
    out(queue);
    return;
  }
  if (!queue.due.length && !queue.upcoming.length) {
    console.log('还没有练过的题，先跑一次 check 或 repl。');
    return;
  }
  console.log('该复习（' + queue.due.length + ' 题）');
  queue.due.forEach(function (row, index) {
    console.log('  ' + (index + 1) + '. [' + row.track + '] ' + row.taskId + '　' + row.title
      + '　（' + row.reason + '，上次 ' + row.lastScore + ' 分，连续通过 ' + row.streak + ' 次）');
  });
  if (!queue.due.length) console.log('  暂时没有到期的题。');
  if (queue.upcoming.length) {
    console.log('之后到期（前 5 条）：');
    queue.upcoming.slice(0, 5).forEach(function (row) {
      console.log('  ' + row.taskId + '　' + String(row.dueAt).slice(0, 10) + '　' + row.reason);
    });
  }
  console.log('提示：node src/cli.mjs drill 会优先带出该复习的题。');
}

// 学习目标：每天几题/多少分钟，以及今天的达成情况
export async function goal(ctx) {
  const { args, asJson, out } = ctx;
  const sub = args._[1] || 'show';
  const current = readGoals();

  if (sub === 'set') {
    const next = writeGoals({
      dailyTasks: args.tasks !== undefined ? args.tasks : undefined,
      dailyMinutes: args.minutes !== undefined ? args.minutes : undefined
    });
    if (asJson) {
      out(next);
    } else {
      console.log('目标已更新：每天 ' + (next.dailyTasks || '不限') + ' 题　' + (next.dailyMinutes || '不限') + ' 分钟');
      console.log('存于 ' + goalsPath());
    }
    return;
  }
  if (sub !== 'show') {
    console.error('用法：node src/cli.mjs goal [show] | goal set [--tasks=3] [--minutes=20]');
    return 2;
  }

  const progressToday = goalProgress(load().records, TASKS, current);
  if (asJson) {
    out({ goal: current, progress: progressToday });
    return;
  }
  console.log('学习目标：每天 ' + (current.dailyTasks || '不限') + ' 题　' + (current.dailyMinutes || '不限') + ' 分钟'
    + (current.hasGoal === false && current.updatedAt ? '（上次更新 ' + String(current.updatedAt).slice(0, 10) + '）' : ''));
  console.log('今日进度：' + progressToday.summary);
  if (progressToday.tasksMet) console.log('任务目标已达成 ✓');
  else if (current.dailyTasks) console.log('还差 ' + Math.max(0, current.dailyTasks - progressToday.tasksToday) + ' 题达成今日目标。');
  if (!current.dailyTasks && !current.dailyMinutes) console.log('提示：node src/cli.mjs goal set --tasks=3 --minutes=20');
}

// 题目笔记：记下自己的坑与心得，按题目保存
export async function note(ctx) {
  const { args, asJson, out } = ctx;
  const taskId = args._[1];
  if (typeof taskId !== 'string') {
    const all = readNotes();
    if (asJson) {
      out(all);
      return;
    }
    const ids = Object.keys(all);
    if (!ids.length) {
      console.log('还没有任何笔记。用法：node src/cli.mjs note <taskId> "内容"');
      return;
    }
    console.log('共 ' + ids.length + ' 条笔记（存于 ' + notesPath() + '）：');
    ids.sort().forEach(function (id) {
      console.log('  ' + id + '　' + String(all[id].updatedAt).slice(0, 10) + '　' + all[id].text.split('\n')[0].slice(0, 60));
    });
    return;
  }

  if (args.delete) {
    const result = deleteNote(taskId);
    console.log(result.deleted ? ('已删除 ' + taskId + ' 的笔记') : (taskId + ' 本来就没有笔记'));
    return;
  }

  const text = args._.slice(2).join(' ');
  if (!text) {
    const existing = readNote(taskId);
    if (asJson) {
      out(existing || { taskId: taskId, note: null });
      return;
    }
    if (!existing) {
      console.log(taskId + ' 还没有笔记。写入：node src/cli.mjs note ' + taskId + ' "你的心得"');
      return;
    }
    console.log(taskId + '（更新于 ' + String(existing.updatedAt).slice(0, 19) + '）：');
    console.log(existing.text);
    return;
  }

  const saved = writeNote(taskId, text);
  if (asJson) {
    out(saved.note);
  } else {
    console.log('已记录 ' + taskId + ' 的笔记（' + saved.note.text.length + ' 字）');
  }
}

export async function report(ctx) {
  const { args } = ctx;
  const markdown = renderReport(load().records, TASKS, {});
  if (typeof args.out === 'string') {
    writeFileSync(args.out, markdown);
    console.log('学习报告已写入 ' + args.out + '（' + markdown.split('\n').length + ' 行）');
  } else {
    console.log(markdown);
  }
}

export async function plan(ctx) {
  const { args, platform, asJson, out } = ctx;
  const planResult = buildPlan(TASKS, {
    platform: platform,
    hoursPerDay: Number(args.hours) || 2,
    track: typeof args.track === 'string' ? args.track : undefined
  });
  // --status：把计划与真实提交记录对齐，回答"这个计划我做到哪了"
  if (args.status) {
    const progress = planProgress(planResult, load().records);
    if (asJson) {
      out(progress);
    } else {
      console.log(renderPlanProgressText(progress));
    }
    return;
  }
  if (asJson) {
    out(planResult);
  } else {
    console.log(renderPlanText(planResult));
  }
}

export async function drill(ctx) {
  const { args, platform, asJson, out } = ctx;
  const limit = Number(args.limit) || 5;
  const trackFilter = typeof args.track === 'string' ? args.track : 'all';
  let mode = args.all ? 'all' : 'weak';

  // --tasks=a,b,c：直接按给定顺序练这几道题（analyze 的输出可以直接接进来）
  if (typeof args.tasks === 'string' && args.tasks.trim()) {
    const rows = args.tasks.split(',').map(function (id) { return id.trim(); }).filter(Boolean);
    const missing = rows.filter(function (id) { return !findTask(id); });
    const picked = rows.filter(function (id) { return findTask(id); }).map(function (id) {
      const task = resolveTask(findTask(id), platform);
      return { taskId: task.id, track: task.track, title: task.title, reason: '来自指定的训练清单', weight: 100 };
    });
    if (missing.length) console.error('忽略不存在的题号：' + missing.join(', '));
    if (!picked.length) {
      console.error('--tasks 里没有有效题号。');
      return 2;
    }
    console.log('指定训练：共 ' + picked.length + ' 题');
    picked.forEach(function (row, index) { console.log('  ' + (index + 1) + '. [' + row.track + '] ' + row.taskId + '　' + row.title); });
    if (process.stdin.isTTY) {
      return runRepl(ctx, picked.map(function (row) { return resolveTask(findTask(row.taskId), platform); }), '指定训练');
    }
    console.log('非交互环境：以上是本次要练的题。');
    return;
  }

  let picked = pickPractice(load().records, TASKS, { mode: mode, limit: limit, track: trackFilter });
  if (mode === 'weak' && !picked.length) {
    mode = 'new';
    picked = pickPractice(load().records, TASKS, { mode: mode, limit: limit, track: trackFilter });
  }
  const modeLabel = { weak: '重练（练过但没满分）', new: '未练习', all: '全量' }[mode];

  if (asJson) {
    // 与网页 /api/drill 保持同一结构，便于脚本与对比测试
    out({ mode: mode, total: picked.length, practice: picked });
    return;
  }
  if (!picked.length) {
    console.log('没有可练的题：该筛选下所有题都已满分。用 --all 可以重练全部。');
  } else {
    console.log('练习模式：' + modeLabel + '　共 ' + picked.length + ' 题（上限 ' + limit + '，--limit 可调）');
    picked.forEach(function (row, index) {
      console.log('  ' + (index + 1) + '. [' + row.track + '] ' + row.taskId + '　' + row.title + '　（' + row.reason + '，权重 ' + row.weight + '）');
    });
    if (process.stdin.isTTY) {
      return runRepl(ctx, picked.map(function (row) { return resolveTask(findTask(row.taskId), platform); }), '定向练习（' + modeLabel + '）');
    } else {
      console.log('非交互环境：以上是需要练的题。交互练习请直接在终端运行同一条命令。');
    }
  }
}

export async function repl(ctx) {
  const { args, platform } = ctx;
  const list = listTasks(typeof args.track === 'string' ? args.track : undefined).map(function (task) {
    return resolveTask(task, platform);
  });
  // 非 TTY 时 runRepl 返回 2：必须把它传出去，否则脚本里会"静默成功"
  return runRepl(ctx, list, '交互练习');
}

// 交互练习：repl 与 drill 共用。非 TTY 直接拒绝启动，避免脚本里卡住。
export async function runRepl(ctx, list, label) {
  const { platform, client, profile } = ctx;
  if (!process.stdin.isTTY) {
    console.error(label + ' 需要交互式终端。非交互场景请用：node src/cli.mjs check <taskId> "<命令>"');
    return 2;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(label + '：共 ' + list.length + ' 题　平台 ' + profile.name + '　客户端 ' + client);
  console.log('可用指令：:hint 提示　:answer 参考答案　:skip 跳过本题　:quit 结束');
  let passed = 0;
  for (let i = 0; i < list.length; i += 1) {
    const task = list[i];
    console.log('');
    console.log('[' + (i + 1) + '/' + list.length + '][' + task.track + '] ' + task.title);
    console.log('目标：' + task.goal);
    let solved = false;
    while (!solved) {
      const raw = (await rl.question('命令 > ')).trim();
      if (raw === ':quit') {
        rl.close();
        console.log('已退出：本次通过 ' + passed + ' / ' + list.length);
        return 0;
      }
      if (raw === ':skip') {
        console.log('已跳过。参考答案：' + task.sample);
        break;
      }
      if (raw === ':hint') {
        console.log('提示：' + task.hint);
        continue;
      }
      if (raw === ':answer') {
        console.log('参考答案：' + task.sample);
        continue;
      }
      const result = judge(task, raw, platform);
      record({ client: client, taskId: task.id, score: result.score, verdict: result.verdict, platform: platform, answer: result.answer });
      console.log('判定：' + result.verdict + '（' + result.score + ' 分）　' + result.tips);
      if (result.pass) {
        passed += 1;
        solved = true;
        console.log('通过，进入下一题。');
      } else {
        console.log('再试一次，或输入 :hint / :answer / :skip。');
      }
    }
  }
  rl.close();
  console.log('');
  console.log('本轮结束：通过 ' + passed + ' / ' + list.length);
  return 0;
}
