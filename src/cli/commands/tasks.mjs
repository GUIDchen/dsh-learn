// 题目相关命令：list / show / check。
import { listTasks, listTasksByLevel, levelLabel, levelStats, LEVELS, otherPlatformSamples } from '../../core/tasks.mjs';
import { assessAnswer } from '../../core/exec.mjs';
import { locateMissing } from '../../core/feedback.mjs';
import { judge, resolveTask, platformBlocker } from '../../core/judge.mjs';
import { record, load, storagePath } from '../../store.mjs';
import { PASS_SCORE } from '../../core/judge.mjs';

export async function list(ctx) {
  const { args, platform, asJson, out } = ctx;
  const track = typeof args.track === 'string' ? args.track : undefined;
  const level = typeof args.level === 'string' ? args.level : undefined;
  if (level && LEVELS.indexOf(level) === -1 && level !== 'all') {
    console.error('未知难度：' + level + '　可选：' + LEVELS.join(' / '));
    return 2;
  }
  const tasks = listTasksByLevel(level, track).map(function (task) {
    return resolveTask(task, platform);
  });
  if (asJson) {
    out(tasks.map(function (t) {
      return { id: t.id, track: t.track, level: t.level || null, title: t.title, require: t.require.length, verify: Boolean(t.verify) };
    }));
  } else {
    if (level) console.log('筛选难度：' + levelLabel(level) + '　共 ' + tasks.length + ' 题');
    tasks.forEach(function (t) {
      console.log('[' + t.track + '·' + levelLabel(t.level) + '] ' + t.id + '\n    ' + t.title + '（要素 ' + t.require.length + ' 个' + (t.verify ? '，可执行验证' : '') + '）');
    });
    const stats = levelStats();
    console.log('');
    console.log('难度分布：简单 ' + stats.easy + '　中等 ' + stats.medium + '　困难 ' + stats.hard + '　（累计 ' + (stats.easy + stats.medium + stats.hard) + ' 题）');
  }
  return 0;
}

export async function show(ctx) {
  const { args, platform, profile, out, requireTask } = ctx;
  const task = resolveTask(requireTask(args._[1]), platform);
  out({
    id: task.id,
    track: task.track,
    level: task.level || null,
    levelLabel: levelLabel(task.level),
    title: task.title,
    goal: task.goal,
    platform: task.platform,
    hint: task.hint,
    sample: task.sample,
    require: task.require,
    forbid: task.forbid,
    verify: task.verify,
    // 这道题在别的平台怎么写：只带平台名与参考答案，供人对比着记
    otherPlatforms: otherPlatformSamples(requireTask(args._[1]), platform),
    // 题目声明了 platforms 时（只在某些平台上成立），如实告诉调用方当前平台算不算数
    supported: task.supported,
    taskPlatforms: task.taskPlatforms || null,
    platformNotes: profile.notes
  });
}

// 其他平台的参考答案（当前平台不下发自己那一条）

export async function check(ctx) {
  const { args, platform, client, asJson, out, requireTask } = ctx;
  const task = requireTask(args._[1]);
  const answer = args._.slice(2).join(' ');
  const resolved = resolveTask(task, platform);
  // 题目声明了 platforms 且当前平台不在其中：不判分、不记录，也不假装给个分数
  const blocker = platformBlocker(resolved);
  if (blocker) {
    console.error(blocker);
    console.error('（题目：' + task.id + '　权威平台：' + (resolved.taskPlatforms || []).join(' / ') + '）');
    process.exitCode = 2;
    return;
  }
  const result = judge(task, answer, platform);

  // 判定前先取这道题的历史成绩：结果里给出"这次比上次"的对比
  const rows = load().records.filter(function (row) { return row.taskId === task.id; });
  const previousBest = rows.reduce(function (max, row) { return Math.max(max, row.score || 0); }, 0);
  const attempts = rows.length;

  // 记录写不进去（进度目录只读、磁盘满）时**不能吞掉判定结果**：判定是用户要的，
  // 但也要明确告诉他"这次没记上"，并让退出码非 0——不然脚本会以为一切正常。
  let saveError = '';
  let stored = null;
  try {
    stored = record({ client: client, taskId: task.id, score: result.score, verdict: result.verdict, platform: platform, answer: result.answer });
  } catch (err) {
    saveError = err && err.message ? err.message : String(err);
  }
  // 执行型判定：只有显式 --run 才真跑，且只跑只读白名单内的命令
  let execution = null;
  if (args.run) {
    execution = await assessAnswer(task, answer, { run: true, timeout: Number(args.timeout) || undefined });
  }
  const payload = Object.assign({}, result, {
    execution: execution,
    title: task.title,
    platform: platform,
    tipsFromTask: resolved.hint,
    previousBest: attempts ? previousBest : null,
    attempts: attempts + 1,
    delta: attempts ? result.score - previousBest : null,
    storedRecords: stored,
    storage: storagePath(),
    saved: !saveError,
    saveError: saveError || null
  });
  if (asJson) {
    out(payload);
  } else {
    console.log('任务：' + task.title);
    // 变体题在不同平台口径不同：把"按哪个平台判的"写在最前面，避免"我的写法明明对"的困惑
    console.log('平台：' + platform + (resolved.platform && resolved.platform !== platform ? '（题目按 ' + resolved.platform + ' 变体下发）' : '')
      + (resolved.supported ? '' : '（这道题只在 ' + resolved.taskPlatforms.join(' / ') + ' 上有参考答案，当前平台按兜底规则判）'));
    console.log('判定：' + result.verdict + '（' + result.score + ' 分）');
    console.log('反馈：' + result.tips);
    if (result.scoring) console.log('评分：' + result.scoring);
    if (result.matched && result.matched.length) {
      console.log('已命中 ' + result.matched.length + ' / ' + (result.required || result.matched.length) + '：' + result.matched.join('；'));
    }
    // 与历史对比：让命令行也能看到"有没有进步"
    if (attempts === 0) {
      console.log('这是第一次练这道题');
    } else {
      const delta = result.score - previousBest;
      const trend = delta > 0 ? '比上次最好 +' + delta : (delta < 0 ? '比上次最好 ' + delta : '与上次最好持平');
      console.log('上次最好 ' + previousBest + ' 分　本次 ' + result.score + ' 分（' + trend + '）　累计第 ' + (attempts + 1) + ' 次练习'
        + (result.pass && previousBest < PASS_SCORE ? '　首次满分 🎉' : ''));
    }
    if (result.missing && result.missing.length) {
      const located = locateMissing(task, answer, platform);
      located.located.forEach(function (row) { console.log('  定位：' + row.suggestion); });
      located.unmatched.forEach(function (row) { console.log('  定位：答案里没有与「' + row.tip + '」相关的片段'); });
    }
    if (execution) {
      if (!execution.allowed) {
        console.log('执行：未运行（' + execution.reason + '）');
      } else if (!execution.ran) {
        console.log('执行：未运行（' + (execution.reason || '未执行') + '）');
      } else {
        const raw = String(execution.output || '');
        const lines = raw.split(String.fromCharCode(10)).filter(function (row) { return row.trim(); });
        console.log('执行：真的跑了一遍（退出码 ' + String(execution.exitCode === undefined ? '?' : execution.exitCode) + '）'
          + (execution.ok ? '' : '　' + (execution.reason || '') + (execution.advice ? '　' + execution.advice : '')));
        if (lines.length) console.log('  输出：' + lines[0].slice(0, 120) + (lines.length > 1 ? ('（共 ' + lines.length + ' 行）') : ''));
      }
    }
    if (!result.pass) {
      console.log('提示：' + resolved.hint);
      if (resolved.sample) console.log('参考：' + resolved.sample);
    }
    if (saveError) {
      // 判定照常给出，但这次没记上：说清楚原因与下一步，退出码非 0
      console.error('这次没记上：' + saveError);
      console.error('（判定结果不受影响；检查 ' + storagePath() + ' 所在目录的写权限或磁盘空间）');
    } else {
      console.log('已记录到 ' + storagePath() + '（客户端 ' + client + '）');
    }
  }
  return saveError ? 1 : 0;
}
