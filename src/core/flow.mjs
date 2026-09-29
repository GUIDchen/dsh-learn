// 求职学习闭环：把七步串成"现在在哪一步、下一步做什么"。
//
// 每一步的状态都由**真实数据**推出来（练习记录 / 项目目录 / 投递记录），不靠用户自报：
//   学习 → 项目解析学习 → 生成简历 → 搜集招聘信息 → 按岗位补知识点 → 岗位推荐 → 投递
// 界面上就是一条进度线 + 一句"下一步"，CLI 是 flow status / next。
import { PASS_SCORE } from './judge.mjs';
import { taskStats } from './progress.mjs';
import { analyzeText } from './knowledge.mjs';
import { POINTS } from './knowledge.mjs';

export const STAGES = [
  { id: 'learn', name: '学习', goal: '把基础题练到能过' },
  { id: 'project', name: '项目解析学习', goal: '用真实项目 / 仓库出题并练' },
  { id: 'resume', name: '生成简历', goal: '把学到的东西变成可投递要点' },
  { id: 'collect', name: '搜集招聘信息', goal: '搜岗位 JD、结构化后入库' },
  { id: 'gap', name: '按岗位补知识点', goal: '照 JD 要求生成项目与练习清单' },
  { id: 'recommend', name: '岗位推荐', goal: '按匹配度排序，挑值得投的' },
  { id: 'apply', name: '投递', goal: '按岗位链接投递并记录状态' }
];

function passedSet(records, tasks) {
  const stats = taskStats(records, tasks);
  return {
    passed: new Set(stats.known.filter(function (row) { return row.best >= PASS_SCORE; }).map(function (row) { return row.taskId; })),
    best: new Map(stats.known.map(function (row) { return [row.taskId, row.best]; })),
    attempts: new Map(stats.known.map(function (row) { return [row.taskId, row.attempts]; })),
    known: stats.known
  };
}

// 把 JD 的硬要求/加分项逐条映射到知识点：复用同一份字典分析器（不另写一套关键词）
export function pointsFromRequirementLines(lines, limit) {
  const ids = [];
  (lines || []).forEach(function (row) {
    const text = typeof row === 'string' ? row : String((row && row.text) || '');
    const report = analyzeText(text, { limit: limit || 10 });
    (report.modules || []).forEach(function (mod) {
      (mod.points || []).forEach(function (point) { if (ids.indexOf(point.id) === -1) ids.push(point.id); });
    });
  });
  return ids;
}

// 岗位匹配：加权分（0-100）+ 逐项依据。
//   55% 覆盖：这道 JD 能练的题里已通过多少（最直接）
//   30% 硬要求：JD 的「熟悉/掌握」那几行映射到的知识点，其题通过比例（硬要求比加分项重要）
//   15% 方向广度：JD 涉及的方向里，练过的方向占比（换方向时不至于全 0）
// 老记录没存硬要求时如实降级：只按覆盖算，并在依据里说明。
export function matchJobs(jobs, tasks, records) {
  const stats = passedSet(records, tasks);
  const taskIndex = new Map((tasks || []).map(function (task) { return [task.id, task]; }));
  const pointTasks = new Map(POINTS.map(function (point) { return [point.id, (point.tasks || []).filter(function (id) { return taskIndex.has(id); })]; }));
  const passedTracks = new Set();
  (tasks || []).forEach(function (task) { if (stats.passed.has(task.id)) passedTracks.add(task.track); });
  return (jobs || []).map(function (job) {
    const analysis = job.analysis || {};
    const taskIds = (analysis.tasks || []).filter(function (id) { return taskIndex.has(id); });
    const covered = taskIds.filter(function (id) { return stats.passed.has(id); });
    const missing = taskIds.filter(function (id) { return !stats.passed.has(id); });
    const coverage = taskIds.length ? covered.length / taskIds.length : 0;

    const mustTasks = [];
    (analysis.mustHave || []).forEach(function (row) {
      tasksFromRequirementLine(row, tasks, 12).ids.forEach(function (taskId) { if (mustTasks.indexOf(taskId) === -1) mustTasks.push(taskId); });
    });
    const mustCovered = mustTasks.filter(function (id) { return stats.passed.has(id); });
    const mustRatio = mustTasks.length ? mustCovered.length / mustTasks.length : null;

    const tracks = Array.from(new Set(taskIds.map(function (id) { return (taskIndex.get(id) || {}).track; }).filter(Boolean)));
    const tracksTouched = tracks.filter(function (track) { return passedTracks.has(track); });
    const trackRatio = tracks.length ? tracksTouched.length / tracks.length : 0;

    const weighted = mustRatio === null
      ? Math.round((coverage * 0.85 + trackRatio * 0.15) * 100)
      : Math.round((coverage * 0.55 + mustRatio * 0.30 + trackRatio * 0.15) * 100);
    const match = taskIds.length ? weighted : 0;

    const why = [];
    if (taskIds.length) why.push('覆盖 ' + covered.length + '/' + taskIds.length + ' 道（权重 55%）');
    else why.push('还没分析 JD：先跑 jobs analyze，或把岗位描述存进记录');
    if (mustRatio === null) why.push('这条记录没存硬要求（老数据）：只按覆盖与方向算');
    else why.push('硬要求对应的题 ' + mustCovered.length + '/' + mustTasks.length + ' 道（权重 30%）');
    if (tracks.length) why.push('方向覆盖 ' + tracksTouched.length + '/' + tracks.length + '（' + tracks.join('、') + '）（权重 15%）');
    if (missing.length) why.push('缺 ' + missing.length + ' 道（' + missing.slice(0, 3).join('、') + (missing.length > 3 ? ' 等' : '') + '）');
    return {
      jobId: job.id,
      company: job.company,
      position: job.position,
      status: job.status,
      url: job.url || '',
      appliedAt: job.appliedAt || '',
      match: match,
      total: taskIds.length,
      covered: covered.length,
      coverage: Math.round(coverage * 100),
      mustTotal: mustTasks.length,
      mustCovered: mustCovered.length,
      tracks: tracks,
      missing: missing.slice(),
      gapTracks: Array.from(new Set(missing.map(function (id) { return (taskIndex.get(id) || {}).track; }).filter(Boolean))),
      // 岗位属性随行带出（推荐列表与投递材料都要显示；筛选在 recommendJobs 里做）
      location: analysis.location || '',
      salary: analysis.salary || null,
      postedAt: analysis.postedAt || '',
      remote: Boolean(analysis.remote),
      why: why
    };
  }).sort(function (a, b) { return b.match - a.match || b.total - a.total; });
}

// 上架新鲜度：0 = 未知/更早，1 = 一周内，2 = 三天内（只用于同级排序）
export function freshnessRank(postedAt) {
  const text = String(postedAt || '');
  if (!text) return 0;
  if (/今天|昨天|刚刚|1\s*天前|2\s*天前|3\s*天前/.test(text)) return 2;
  const days = text.match(/(\d+)\s*天前/);
  if (days) return Number(days[1]) <= 3 ? 2 : (Number(days[1]) <= 7 ? 1 : 0);
  const weeks = text.match(/(\d+)\s*周前/);
  if (weeks) return Number(weeks[1]) <= 1 ? 1 : 0;
  return 0;
}

export function recommendJobs(jobs, tasks, records, options) {
  const opts = options || {};
  const limit = Math.max(1, Math.min(50, Number(opts.limit) || 5));
  const rows = matchJobs(jobs, tasks, records).filter(function (row) { return row.total > 0; });
  const threshold = Number(opts.threshold) || 0;
  const location = String(opts.location || '').trim();
  const wantMin = Number(opts.salaryMin) || Number(opts.minSalary) || 0;
  const wantMax = Number(opts.salaryMax) || 0;
  const kept = rows
    .filter(function (row) { return row.match >= threshold; })
    .filter(function (row) {
      if (opts.remoteOnly && !row.remote) return false;
      if (location && String(row.location || '').indexOf(location) === -1) return false;
      // 薪资按"区间是否重叠"算，而不是只看下限：期望 25-40K 时，20-30K 的岗位也算有机会谈
      // 没写薪资的岗位不因为"查不到"被筛掉（宁可选错，不可漏投）
      if (wantMin || wantMax) {
        const salary = row.salary || null;
        if (salary && (salary.min || salary.max)) {
          const low = salary.min || salary.max;
          const high = salary.max || salary.min;
          if (wantMax && low > wantMax) return false;
          if (wantMin && high < wantMin) return false;
        }
      }
      return true;
    });
  // 排序：匹配度优先；同级看上架新鲜度（≤3 天 > ≤7 天 > 其它/未知）——发布时间只影响同级顺序，
  // 不会让一个"只匹配 10%"的新岗位压过"匹配 90%"的老岗位。
  if (opts.freshFirst !== false) {
    kept.sort(function (a, b) {
      if (b.match !== a.match) return b.match - a.match;
      const fresh = freshnessRank(b.postedAt) - freshnessRank(a.postedAt);
      if (fresh !== 0) return fresh;
      return String(a.company || '').localeCompare(String(b.company || ''));
    });
  }
  return kept.slice(0, limit);
}

// 七步的状态。input: { records, tasks, projects, jobs, resume, now }
export function flowStatus(input) {
  const opts = input || {};
  const records = opts.records || [];
  const tasks = opts.tasks || [];
  const projects = opts.projects || [];
  const jobs = opts.jobs || [];
  const matches = matchJobs(jobs, tasks, records);
  const stats = passedSet(records, tasks);
  const passedCount = stats.passed.size;
  const attemptedCount = stats.known.length;
  const analyzed = jobs.filter(function (job) { return job.analysis && (job.analysis.tasks || []).length; });
  const bestMatch = matches.filter(function (row) { return row.total > 0; })[0] || null;
  const appliedCount = jobs.filter(function (job) { return job.status && job.status !== 'todo'; }).length;
  const learningReady = passedCount >= 10 && attemptedCount >= 12;
  const projectReady = projects.some(function (row) { return (row.sources || 0) > 0; });

  const stage = function (id, status, progress, evidence, action, blocked) {
    const meta = STAGES.filter(function (row) { return row.id === id; })[0] || {};
    return {
      id: id,
      name: meta.name || id,
      goal: meta.goal || '',
      status: status,
      progress: progress,
      evidence: evidence,
      action: action,
      blocked: blocked || ''
    };
  };

  const stages = [
    stage('learn',
      learningReady ? 'done' : (passedCount > 0 ? 'doing' : 'todo'),
      '通过 ' + passedCount + ' / 练过 ' + attemptedCount + ' 道',
      learningReady ? '已经够生成有内容的简历要点' : '再通过 ' + Math.max(0, 10 - passedCount) + ' 道就够写简历要点',
      { label: '练今天的题', cli: 'node src/cli.mjs daily', web: '学习页 → 每日一题' },
      passedCount === 0 ? '还没练过：先做每日一题' : ''),
    stage('project',
      projectReady ? 'done' : (projects.length ? 'doing' : 'todo'),
      projects.length + ' 个项目',
      projects.length ? '项目目录里有 ' + projects.length + ' 个项目（来源/索引/草案都在里面）' : '还没有项目：收一个仓库或一段文档',
      { label: '收一个项目', cli: 'node src/cli.mjs learn-repo <仓库> --project=<名字>', web: '学习页 → 项目 / 仓库' },
      ''),
    stage('resume',
      projectReady && learningReady ? 'done' : (passedCount > 0 ? 'doing' : 'todo'),
      (opts.resume ? (opts.resume.skills.length + ' 个方向 / ' + opts.resume.highlights.length + ' 条亮点') : '未生成'),
      learningReady ? '数据够了：可以生成简历要点（只写真实练习记录）' : '先攒够练习记录再生成，免得只有一行',
      { label: '生成简历要点', cli: 'node src/cli.mjs flow resume', web: '流程页 → 生成简历' },
      ''),
    stage('collect',
      jobs.length >= 3 ? 'done' : (jobs.length ? 'doing' : 'todo'),
      jobs.length + ' 条岗位记录（已分析 ' + analyzed.length + '）',
      jobs.length ? '搜到并入库 ' + jobs.length + ' 条；已结构化 ' + analyzed.length + ' 条' : '还没有岗位记录：用搜索批量搜，或粘一条 JD',
      { label: '自动搜集岗位', cli: 'node src/cli.mjs flow collect --query="运维 招聘"', web: '流程页 → 搜集招聘信息' },
      ''),
    stage('gap',
      bestMatch && bestMatch.match >= 60 ? 'done' : (analyzed.length ? 'doing' : 'todo'),
      bestMatch ? ('最匹配岗位缺 ' + bestMatch.missing.length + ' 道') : '还没有可比对的岗位',
      bestMatch ? ('「' + bestMatch.company + ' · ' + bestMatch.position + '」匹配度 ' + bestMatch.match + '%：差的题就是下一步练的') : '先搜集并分析岗位，才知道该补什么',
      { label: '按岗位补知识点', cli: 'node src/cli.mjs flow recommend --limit=3', web: '流程页 → 岗位推荐' },
      ''),
    stage('recommend',
      bestMatch ? 'done' : 'todo',
      matches.filter(function (row) { return row.total > 0; }).length + ' 个可比对该岗位',
      bestMatch ? ('最值得投：' + bestMatch.company + ' · ' + bestMatch.position + '（' + bestMatch.match + '%）') : '还没有可推荐的岗位',
      { label: '看推荐岗位', cli: 'node src/cli.mjs flow recommend', web: '流程页 → 岗位推荐' },
      ''),
    stage('apply',
      appliedCount ? 'done' : 'todo',
      appliedCount + ' 条已投',
      appliedCount ? ('已投 ' + appliedCount + ' 条；投递状态在简历投递页维护') : '挑一个推荐的岗位，按链接投出去',
      { label: '按链接投递', cli: 'node src/cli.mjs flow apply <岗位记录 id>', web: '简历投递页 → 岗位链接' },
      '')
  ];

  // 当前步骤 = 第一个没完成的；全完成就是最后一步
  const current = stages.filter(function (row) { return row.status !== 'done'; })[0] || stages[stages.length - 1];
  return {
    stages: stages,
    current: current.id,
    currentName: current.name,
    nextAction: current.action,
    counts: {
      passed: passedCount,
      attempted: attemptedCount,
      projects: projects.length,
      jobs: jobs.length,
      analyzed: analyzed.length,
      applied: appliedCount
    },
    matches: matches.slice(0, 10)
  };
}

export function summarizeFlow(status) {
  return STAGES.map(function (row) {
    const hit = (status.stages || []).filter(function (item) { return item.id === row.id; })[0] || {};
    const mark = hit.status === 'done' ? '✓' : (hit.status === 'doing' ? '…' : '·');
    return mark + row.name;
  }).join(' → ') + '　当前：' + status.currentName + '　下一步：' + status.nextAction.label;
}

// 按岗位要求生成"学习计划 → 项目"：这一步的产物是一个能直接开练的项目 + 说明文件。
// 输入是一份已结构化的岗位（JD 理解 + 可练题），输出是：要补的知识点 → 对应的题 → 可复制的命令。

export function projectNameForJob(job) {
  const raw = (String(job.company || '岗位') + '-' + String(job.position || '未标注')).replace(/[\s/\\]+/g, '-');
  return raw.slice(0, 40);
}

// 知识点 → 题：用字典里挂的题（与"项目索引"同一份口径），再按通过与否分出待练清单
export function studyPlan(job, tasks, records, options) {
  const opts = options || {};
  const stats = passedSet(records, tasks);
  const taskIndex = new Map((tasks || []).map(function (task) { return [task.id, task]; }));
  const pointIds = ((job.analysis || {}).points) || [];
  const rows = pointIds.map(function (id) {
    const point = POINTS.filter(function (item) { return item.id === id; })[0];
    const pointTasks = ((point && point.tasks) || []).filter(function (taskId) { return taskIndex.has(taskId); });
    const missing = pointTasks.filter(function (taskId) { return !stats.passed.has(taskId); });
    return {
      id: id,
      name: point ? point.name : id,
      module: point ? point.module : '',
      tasks: pointTasks.slice(),
      missing: missing,
      missingTracks: Array.from(new Set(missing.map(function (taskId) { return (taskIndex.get(taskId) || {}).track; }).filter(Boolean)))
    };
  }).filter(function (row) { return row.tasks.length > 0; });

  const missingTasks = [];
  rows.forEach(function (row) { row.missing.forEach(function (id) { if (missingTasks.indexOf(id) === -1) missingTasks.push(id); }); });
  const matched = matchJobs([job], tasks, records)[0] || { match: 0, covered: 0, total: 0 };
  const plan = {
    jobId: job.id,
    company: job.company,
    position: job.position,
    url: job.url || '',
    status: job.status || 'todo',
    match: matched.match,
    covered: matched.covered,
    total: matched.total,
    projectName: opts.project || projectNameForJob(job),
    points: rows,
    missingTasks: missingTasks,
    tracks: Array.from(new Set(rows.reduce(function (all, row) { return all.concat(row.missingTracks); }, [])))
  };
  plan.markdown = renderStudyPlan(plan, opts);
  return plan;
}

export function renderStudyPlan(plan, options) {
  const opts = options || {};
  const lines = [];
  lines.push('# 岗位学习计划：' + plan.company + ' · ' + plan.position);
  lines.push('');
  lines.push('- 投递状态：' + plan.status + (plan.appliedAt ? '（' + plan.appliedAt + '）' : ''));
  if (plan.url) lines.push('- 岗位链接：' + plan.url);
  lines.push('- 匹配度：' + plan.match + '%（这道 JD 能练 ' + plan.total + ' 道题，已通过 ' + plan.covered + ' 道）');
  if (plan.tracks.length) lines.push('- 涉及方向：' + plan.tracks.join('、'));
  lines.push('');
  if ((plan.mustHave || []).length) {
    lines.push('## 硬要求（由 JD 理解得出，方括号里是判定依据）');
    lines.push('');
    plan.mustHave.forEach(function (row) { lines.push('- ' + row.text + '　[' + row.evidence + ']'); });
    lines.push('');
  }
  if ((plan.niceToHave || []).length) {
    lines.push('## 加分项');
    lines.push('');
    plan.niceToHave.forEach(function (row) { lines.push('- ' + row.text); });
    lines.push('');
  }
  lines.push('## 要补的知识点 → 先练这些题');
  lines.push('');
  if (!plan.points.length) {
    lines.push('（这条 JD 还没分析出知识点：先 job analyze，或把岗位描述补全一点）');
  } else {
    lines.push('| 知识点 | 待练 | 全部 | 题号 |');
    lines.push('| --- | --- | --- | --- |');
    plan.points.forEach(function (row) {
      lines.push('| ' + row.name + ' | ' + row.missing.length + ' | ' + row.tasks.length + ' | ' + (row.missing.slice(0, 4).join('、') || '已通过') + ' |');
    });
  }
  lines.push('');
  if (plan.missingTasks.length) {
    lines.push('## 开练命令');
    lines.push('');
    lines.push('    node src/cli.mjs drill --tasks=' + plan.missingTasks.join(','));
    lines.push('');
    lines.push('（也可以在这个项目里：node src/cli.mjs project tasks ' + plan.projectName + '）');
  } else if (plan.points.length) {
    lines.push('这道岗位涉及的知识点已经全部通过——可以准备投递了。');
  }
  lines.push('');
  lines.push('> 计划由 dsh-learn 依据练习记录与 JD 生成：匹配度只统计"已通过的题"，不含任何虚构经历。');
  return lines.join('\n') + '\n';
}

// 投递材料：把"这条 JD 要什么"与"你有什么"逐条对上，生成一份可以直接改的投递稿。
// 与简历要点同一份底料（练习记录），区别是**针对性**：只写与这条岗位相关的方向，并主动列出差异。
export function applicationPack(job, tasks, records, options) {
  const opts = options || {};
  const stats = passedSet(records, tasks);
  const taskIndex = new Map((tasks || []).map(function (task) { return [task.id, task]; }));
  const pointTasks = new Map(POINTS.map(function (point) { return [point.id, (point.tasks || []).filter(function (id) { return taskIndex.has(id); })]; }));
  const analysis = job.analysis || {};
  const matched = matchJobs([job], tasks, records)[0] || { match: 0, covered: 0, total: 0, missing: [], gapTracks: [], why: [] };

  // 逐条硬要求 → 知识点 → 题 → 通过情况
  const mustRows = (analysis.mustHave || []).map(function (row) {
    const resolved = tasksFromRequirementLine(row, tasks, 12);
    const pointIds = resolved.points;
    const ids = resolved.ids;
    const passed = ids.filter(function (id) { return stats.passed.has(id); });
    let status = '无对应题';
    if (ids.length) status = passed.length === ids.length ? '已覆盖' : (passed.length ? '部分覆盖' : '待补');
    return {
      text: row.text,
      evidence: row.evidence || '',
      points: pointIds.map(function (id) { const point = POINTS.filter(function (item) { return item.id === id; })[0]; return point ? point.name : id; }),
      total: ids.length,
      passed: passed.length,
      status: status
    };
  });

  // 自我介绍要点：只挑与这条 JD 同方向的练习成果（与简历同一份数据，但换个角度组织）
  const jdTracks = new Set(matched.tracks || []);
  const trackRows = [];
  jdTracks.forEach(function (track) {
    const trackTasks = (tasks || []).filter(function (task) { return task.track === track; });
    const done = trackTasks.filter(function (task) { return stats.passed.has(task.id); });
    if (done.length) trackRows.push({ track: track, passed: done.length, total: trackTasks.length, hard: done.filter(function (task) { return task.level === 'hard'; }).length });
  });
  trackRows.sort(function (a, b) { return b.passed - a.passed; });

  const pack = {
    jobId: job.id,
    company: job.company,
    position: job.position,
    url: job.url || '',
    status: job.status || 'todo',
    appliedAt: job.appliedAt || '',
    location: analysis.location || '',
    salary: analysis.salary || null,
    postedAt: analysis.postedAt || '',
    remote: Boolean(analysis.remote),
    match: matched.match,
    coverage: matched.coverage,
    mustRows: mustRows,
    strengths: trackRows,
    gaps: matched.gapTracks || [],
    missingTasks: matched.missing || [],
    matchWhy: matched.why || [],
    projectName: opts.project || projectNameForJob(job)
  };
  pack.markdown = renderApplicationPack(pack);
  return pack;
}

export function renderApplicationPack(pack) {
  const lines = [];
  lines.push('# 投递材料：' + pack.company + ' · ' + pack.position);
  lines.push('');
  lines.push('| 项 | 值 |');
  lines.push('| --- | --- |');
  lines.push('| 投递状态 | ' + pack.status + (pack.appliedAt ? '（' + pack.appliedAt + '）' : '') + ' |');
  if (pack.url) lines.push('| 岗位链接 | ' + pack.url + ' |');
  if (pack.location) lines.push('| 地点 | ' + pack.location + (pack.remote ? '（可远程）' : '') + ' |');
  if (pack.salary && pack.salary.text) lines.push('| 薪资 | ' + pack.salary.text + ' |');
  if (pack.postedAt) lines.push('| 发布 | ' + pack.postedAt + ' |');
  lines.push('| 匹配度 | ' + pack.match + '%（加权：' + pack.matchWhy.join('；') + '） |');
  lines.push('');
  lines.push('## 一、逐条对硬要求');
  lines.push('');
  if (!pack.mustRows.length) {
    lines.push('（这条记录里没有硬要求：老数据缺分析，先 `jobs analyze <id>` 或重新入库一次）');
  } else {
    lines.push('| 硬要求 | 对应知识点 | 已通过/可练 | 状态 |');
    lines.push('| --- | --- | --- | --- |');
    pack.mustRows.forEach(function (row) {
      lines.push('| ' + row.text + '　[' + row.evidence + '] | ' + (row.points.join('、') || '-') + ' | ' + row.passed + '/' + row.total + ' | ' + row.status + ' |');
    });
  }
  lines.push('');
  lines.push('## 二、可粘贴的自我介绍要点（都来自练习记录）');
  lines.push('');
  if (pack.strengths.length) {
    pack.strengths.slice(0, 4).forEach(function (row) {
      lines.push('- ' + row.track + ' 方向已通过 ' + row.passed + ' 道实操题（该方向共 ' + row.total + ' 道' + (row.hard ? '，含 ' + row.hard + ' 道困难题' : '') + '）');
    });
  } else {
    lines.push('- （这个岗位涉及的方向还没有通过记录：先按下面的差异自陈准备，再补练）');
  }
  lines.push('');
  lines.push('## 三、差异自陈（主动说，比被问到好）');
  lines.push('');
  if (pack.gaps.length) {
    lines.push('- 还没练到的方向：' + pack.gaps.join('、'));
    if (pack.missingTasks.length) lines.push('- 具体要补的题：' + pack.missingTasks.slice(0, 8).join('、') + (pack.missingTasks.length > 8 ? ' 等 ' + pack.missingTasks.length + ' 道' : ''));
    lines.push('- 补练计划：`flow build ' + pack.jobId + '` 会生成项目与学习计划（' + pack.projectName + '）');
  } else {
    lines.push('- 这个岗位涉及的知识点都已经通过：可以直接投。');
  }
  lines.push('');
  lines.push('## 四、投递动作');
  lines.push('');
  if (pack.url) lines.push('- 打开岗位页投递：' + pack.url + '（dsh-learn 不代填表单）');
  lines.push('- 投完记一笔：`node src/cli.mjs flow apply ' + pack.jobId + '`（状态改成已投）');
  lines.push('');
  lines.push('> 这份材料只陈述练习记录里的事实（题号、分数、方向），不含虚构经历；发出去前请自己过一遍表达。');
  return lines.join('\n') + '\n';
}

// 硬要求逐条 → 可练题：先走知识字典；字典没覆盖到时退一步，用这行里的技术词去匹配题目
// （实测："熟悉 Linux 与 Shell，3 年以上运维经验"在字典里映射不到知识点，但 linux/shell 的题是有的——
//  只按字典算会把这条硬要求显示成"无对应题"，而那对用户是误导）。
export function tasksFromRequirementLine(line, tasks, limit) {
  const ids = [];
  const pointIds = pointsFromRequirementLines([line], 6);
  const taskIndex = new Map((tasks || []).map(function (task) { return [task.id, task]; }));
  pointIds.forEach(function (id) {
    const point = POINTS.filter(function (item) { return item.id === id; })[0];
    ((point && point.tasks) || []).forEach(function (taskId) { if (taskIndex.has(taskId) && ids.indexOf(taskId) === -1) ids.push(taskId); });
  });
  const via = pointIds.length ? 'knowledge' : 'token';
  if (!ids.length) {
    const tokens = (String(line || '').toLowerCase().match(/[a-z][a-z0-9+#.-]{1,}/g) || [])
      .filter(function (token) { return token.length >= 3 && ['and', 'the', 'with', 'years', 'year', 'experience'].indexOf(token) === -1; });
    if (tokens.length) {
      (tasks || []).forEach(function (task) {
        if (ids.length >= (limit || 12)) return;
        const hay = (task.id + ' ' + task.title + ' ' + (task.sample || '')).toLowerCase();
        if (tokens.some(function (token) { return hay.indexOf(token) > -1; })) ids.push(task.id);
      });
    }
  }
  return { ids: ids, via: via, points: pointIds };
}
