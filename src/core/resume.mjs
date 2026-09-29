// 按学习进度生成简历要点：只写真实做过的事，不编经历。
//
// 这一环的边界要说清楚：它生成的是"学习成果摘要"（技能清单 + 项目经历 + 学习数据），
// 不是替用户编造工作经历的简历生成器。每条结论都带证据（通过多少题、哪个项目、哪天练的），
// 用户拿去改成简历语言是下一步的事——但**数字与事实必须是他自己的**。
import { PASS_SCORE } from './judge.mjs';
import { dayKey, streakDays, taskStats } from './progress.mjs';

const LEVELS = [
  { min: 85, hard: 3, label: '熟练' },
  { min: 60, hard: 0, label: '上手' },
  { min: 25, hard: 0, label: '了解' }
];

export function trackLabel(track) {
  return String(track || '').trim();
}

// 技能清单：按轨道聚合"通过题数 / 总题数"，并按通过数加权排序（练得多的排在前面）
export function skillRows(records, tasks) {
  const stats = taskStats(records, tasks);
  const passed = new Set(stats.known.filter(function (row) { return row.best >= PASS_SCORE; }).map(function (row) { return row.taskId; }));
  const byTrack = new Map();
  (tasks || []).forEach(function (task) {
    if (!byTrack.has(task.track)) byTrack.set(task.track, { track: task.track, total: 0, passed: 0, hardPassed: 0, hardTotal: 0 });
    const row = byTrack.get(task.track);
    row.total += 1;
    if (task.level === 'hard') row.hardTotal += 1;
    if (passed.has(task.id)) {
      row.passed += 1;
      if (task.level === 'hard') row.hardPassed += 1;
    }
  });
  return Array.from(byTrack.values())
    .filter(function (row) { return row.passed > 0; })
    .map(function (row) {
      row.percent = row.total ? Math.round(row.passed / row.total * 100) : 0;
      const level = LEVELS.filter(function (item) { return row.percent >= item.min && row.hardPassed >= item.hard; })[0];
      row.level = level ? level.label : '接触过';
      return row;
    })
    .sort(function (a, b) { return b.passed - a.passed || b.percent - a.percent; });
}

// 亮点：从真实数据里挑最值得写进简历的几条，每条都带证据
export function highlights(records, tasks, options) {
  const opts = options || {};
  const stats = taskStats(records, tasks);
  const rows = skillRows(records, tasks);
  const out = [];
  const top = rows[0];
  if (top) {
    out.push({
      text: '在' + top.track + '方向通过了 ' + top.passed + ' 道实操题（' + top.percent + '%）',
      evidence: '难度' + (top.hardPassed > 0 ? '含 ' + top.hardPassed + ' 道困难题' : '以中等题为主') + '，最高分 ' + maxScore(stats, tasks, top.track)
    });
  }
  const hardPassed = (tasks || []).filter(function (task) {
    const row = stats.known.filter(function (item) { return item.taskId === task.id; })[0];
    return task.level === 'hard' && row && row.best >= PASS_SCORE;
  });
  if (hardPassed.length) {
    out.push({ text: '拿下 ' + hardPassed.length + ' 道困难题', evidence: hardPassed.slice(0, 3).map(function (task) { return task.id; }).join('、') + (hardPassed.length > 3 ? ' 等' : '') });
  }
  const projects = opts.projects || [];
  if (projects.length) {
    const names = projects.slice(0, 3).map(function (row) { return row.name; }).join('、');
    out.push({ text: '解析并练习了 ' + projects.length + ' 个真实项目/仓库', evidence: names });
  }
  const streak = streakDays(records, opts.now ? new Date(opts.now) : new Date());
  if (streak >= 2) out.push({ text: '连续 ' + streak + ' 天保持练习', evidence: '按提交记录的自然日计算' });
  const passedCount = Array.from(new Set(stats.known.filter(function (row) { return row.best >= PASS_SCORE; }).map(function (row) { return row.taskId; }))).length;
  if (passedCount) out.push({ text: '累计通过 ' + passedCount + ' 道题', evidence: '提交 ' + stats.known.reduce(function (sum, row) { return sum + row.attempts; }, 0) + ' 次，取历史最好分' });
  return out.slice(0, 6);
}

function maxScore(stats, tasks, track) {
  let best = 0;
  stats.known.forEach(function (row) {
    const task = (tasks || []).filter(function (item) { return item.id === row.taskId; })[0];
    if (task && task.track === track && row.best > best) best = row.best;
  });
  return best;
}

function last7(records, now) {
  const days = [];
  const base = now ? new Date(now) : new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(base.getTime() - i * 86400000);
    days.push(dayKey(day));
  }
  const set = new Set((records || []).map(function (row) { return dayKey(new Date(row.at)); }));
  return { days: days, active: days.filter(function (day) { return set.has(day); }).length };
}

export function buildResume(records, tasks, options) {
  const opts = options || {};
  const stats = taskStats(records, tasks);
  const passedSet = new Set(stats.known.filter(function (row) { return row.best >= PASS_SCORE; }).map(function (row) { return row.taskId; }));
  const attempted = new Set(stats.known.map(function (row) { return row.taskId; }));
  const byTrack = skillRows(records, tasks);
  const activity = last7(records, opts.now);
  const resume = {
    generatedAt: new Date(opts.now || Date.now()).toISOString(),
    headline: byTrack.length
      ? (byTrack[0].track + ' 方向 · 已通过 ' + passedSet.size + ' 道实操题')
      : '还没有通过任何题目：先练几道，简历要点才有据可依',
    skills: byTrack.map(function (row) {
      return { track: row.track, level: row.level, passed: row.passed, total: row.total, percent: row.percent, hardPassed: row.hardPassed, hardTotal: row.hardTotal };
    }),
    highlights: highlights(records, tasks, opts),
    projects: (opts.projects || []).map(function (row) {
      return { name: row.name, sources: row.sources || 0, knowledge: row.knowledge || 0, tasks: row.tasks || 0 };
    }),
    learning: {
      passed: passedSet.size,
      attempted: attempted.size,
      total: (tasks || []).length,
      activeDays7: activity.active,
      streak: streakDays(records, opts.now ? new Date(opts.now) : new Date())
    },
    gaps: byTrack.length >= 1 ? gapTracks(records, tasks, byTrack) : [],
    notes: (opts.notes || []).slice(0, 8)
  };
  resume.markdown = renderResumeMarkdown(resume, opts);
  return resume;
}

// 短板：通过率低于 30% 的轨道（按通过率升序），给"下一步练什么"
export function gapTracks(records, tasks, skillRowsInput) {
  const rows = skillRowsInput || skillRows(records, tasks);
  const weak = [];
  const stats = taskStats(records, tasks);
  const attempted = new Set(stats.known.map(function (row) { return row.taskId; }));
  const touchedTracks = new Set((tasks || []).filter(function (task) { return attempted.has(task.id); }).map(function (task) { return task.track; }));
  (tasks || []).forEach(function (task) {
    if (!touchedTracks.has(task.track)) return;
    const row = rows.filter(function (item) { return item.track === task.track; })[0];
    if (!row) return;
    if (row.percent >= 30) return;
    if (weak.some(function (item) { return item.track === task.track; })) return;
    weak.push({ track: task.track, percent: row.percent, passed: row.passed, total: row.total });
  });
  return weak.sort(function (a, b) { return a.percent - b.percent; }).slice(0, 5);
}

export function renderResumeMarkdown(resume, options) {
  const opts = options || {};
  const lines = [];
  lines.push('# ' + (opts.name || '学习成果摘要') + '（由 dsh-learn 从练习记录生成）');
  lines.push('');
  lines.push('- 生成时间：' + resume.generatedAt.slice(0, 19).replace('T', ' '));
  lines.push('- 一句话：' + resume.headline);
  lines.push('- 学习数据：通过 ' + resume.learning.passed + ' / 练过 ' + resume.learning.attempted + ' / 题库 ' + resume.learning.total
    + '　近 7 天有 ' + resume.learning.activeDays7 + ' 天在练　连续 ' + resume.learning.streak + ' 天');
  lines.push('');
  if (resume.skills.length) {
    lines.push('## 技能（按通过题数排序）');
    lines.push('');
    lines.push('| 方向 | 水平 | 通过/总数 | 通过率 | 困难题 |');
    lines.push('| --- | --- | --- | --- | --- |');
    resume.skills.forEach(function (row) {
      lines.push('| ' + row.track + ' | ' + row.level + ' | ' + row.passed + '/' + row.total + ' | ' + row.percent + '% | ' + row.hardPassed + '/' + row.hardTotal + ' |');
    });
    lines.push('');
  }
  if (resume.highlights.length) {
    lines.push('## 亮点（每条都带依据）');
    lines.push('');
    resume.highlights.forEach(function (row) { lines.push('- ' + row.text + '——' + row.evidence); });
    lines.push('');
  }
  if (resume.projects.length) {
    lines.push('## 项目经历（来自项目目录里真实解析过的项目）');
    lines.push('');
    resume.projects.forEach(function (row) {
      lines.push('- ' + row.name + '：收 ' + row.sources + ' 个来源，命中 ' + row.knowledge + ' 个知识点，产出 ' + row.tasks + ' 道草案题');
    });
    lines.push('');
  }
  if (resume.gaps.length) {
    lines.push('## 待补（通过率偏低的轨道，建议下一轮先练）');
    lines.push('');
    resume.gaps.forEach(function (row) { lines.push('- ' + row.track + '：' + row.percent + '%（' + row.passed + '/' + row.total + '）'); });
    lines.push('');
  }
  lines.push('> 这份摘要只陈述练习记录里的事实（题号、分数、时间、项目），不含虚构的工作经历；');
  lines.push('> 拿去写简历前请自己改写表达，并核对每条依据。');
  return lines.join('\n') + '\n';
}
