// 岗位描述 → 练习清单（计划草案）。
//
// 背景：JD 是描述性文字，`extractCommands` 在 115 份真实语料上抽出 0 条命令，所以"从 JD 出题"
// 不能靠抽命令。真正可行且诚实的是：把 JD 里的技术栈/知识点，映射到题库里**已有的**题，
// 并把"这条要求出现在 JD 的哪句话"作为依据一起给出——生成的是**练习计划**，不是新题。
//
// 计划草案与题目草案的区别会写进 JSON（kind: 'plan'）：它不该被"加入总题库"（没有新题定义），
// 界面据此显示"查看清单"而不是"加入总题库"。
import { POINTS, analyzeText } from './knowledge.mjs';
import { extractStack, stackReport } from './stack.mjs';
import { TASKS } from './tasks.mjs';
import { taskStats } from './progress.mjs';
import { PASS_SCORE } from './judge.mjs';
import { memo } from './cache.mjs';
import { levelLabel, levelRank } from './text.mjs';




// 在原文里找"哪句话提到了这个技术点"——清单里每条都要有出处，不能凭印象推荐
function findEvidence(text, patterns) {
  const lines = String(text || '').split(/\n+/).map(function (row) { return row.trim(); }).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = 0; j < patterns.length; j += 1) {
      if (patterns[j] && lines[i].toLowerCase().indexOf(String(patterns[j]).toLowerCase()) > -1) {
        return lines[i].slice(0, 120);
      }
    }
  }
  return '';
}

export function buildJdPlan(input, options) {
  const opts = options || {};
  const name = input.name || 'job';
  const sources = (input.sources || []).filter(function (row) { return String(row.text || '').trim(); });
  const taskIndex = new Map(TASKS.map(function (task) { return [task.id, task]; }));
  const points = [];
  const terms = [];
  const perSource = [];

  sources.forEach(function (row, position) {
    // 每个来源的分析（analyzeText + extractStack）是纯计算，按来源指纹缓存：
    // 实测点一次"从 JD 生成练习清单"要 150–270ms，就花在这上面，而内容没变就不该重算。
    const fingerprint = 'v1:' + String(row.text.length);
    const analyzed = memo('jdanalysis:' + (row.source || position) + ':' + String(row.index || position), fingerprint, function () {
      const analysis = analyzeText(row.text, { tasks: TASKS });
      const stack = stackReport(extractStack(row.text, { taskIndex: taskIndex }), {});
      return {
        found: (analysis.points || []).map(function (item) { return item.id || item; }),
        terms: (stack.covered || []).map(function (item) { return item.term; })
      };
    });
    const found = analyzed.found;
    const stack = { covered: analyzed.terms.map(function (term) { return { term: term }; }) };
    found.forEach(function (id) { if (points.indexOf(id) === -1) points.push(id); });
    (stack.covered || []).forEach(function (item) { if (terms.indexOf(item.term) === -1) terms.push(item.term); });
    perSource.push({ index: row.index || (position + 1), source: row.source || ('来源 ' + (position + 1)), points: found, terms: (stack.covered || []).map(function (item) { return item.term; }) });
  });

  // 知识点 → 候选题
  const candidates = [];
  points.forEach(function (id) {
    const point = POINTS.filter(function (row) { return row.id === id; })[0];
    if (!point) return;
    (point.tasks || []).forEach(function (taskId) {
      if (candidates.some(function (row) { return row.taskId === taskId; })) return;
      candidates.push({ taskId: taskId, pointId: id, pointName: point.name || id, patterns: (point.patterns || []).concat([point.name || '']) });
    });
  });

  const stats = taskStats(opts.records || [], TASKS);
  const best = new Map();
  stats.known.forEach(function (row) { best.set(row.taskId, row.best); });
  const rows = candidates.map(function (row) {
    const task = taskIndex.get(row.taskId) || {};
    const score = best.has(row.taskId) ? Number(best.get(row.taskId)) : null;
    const passed = score !== null && score >= PASS_SCORE;
    let evidence = '';
    const hit = sources.filter(function (source) { return findEvidence(source.text, row.patterns); })[0];
    if (hit) evidence = findEvidence(hit.text, row.patterns);
    return {
      taskId: row.taskId,
      title: task.title || row.taskId,
      track: task.track || '',
      level: task.level || '',
      pointId: row.pointId,
      pointName: row.pointName,
      best: score,
      passed: passed,
      evidence: evidence,
      reason: passed ? ('已通过（' + score + ' 分）——可当复习') : (score === null ? ('岗位要求命中「' + row.pointName + '」，还没练过') : ('岗位要求命中「' + row.pointName + '」，最高 ' + score + ' 分，差一点'))
    };
  });

  rows.sort(function (a, b) {
    const rank = function (row) { return row.best === null ? 1 : (row.passed ? 2 : 0); };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) {
      const da = levelRank(a.level) - levelRank(b.level);
      if (da !== 0) return da;
    } else {
      const sa = a.best === null ? 0 : a.best;
      const sb = b.best === null ? 0 : b.best;
      if (sa !== sb) return sa - sb;
    }
    return a.taskId.localeCompare(b.taskId);
  });

  const max = Math.max(1, Math.min(50, Number(opts.max) || 10));
  const plan = {
    kind: 'plan',
    id: 'jd-plan-' + String(name).replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
    project: name,
    generatedAt: new Date().toISOString(),
    sources: sources.length,
    points: points,
    terms: terms,
    perSource: perSource,
    total: rows.length,
    nextUp: rows.slice(0, max),
    rows: rows,
    command: 'node src/cli.mjs drill --tasks=' + rows.filter(function (row) { return !row.passed; }).slice(0, 40).map(function (row) { return row.taskId; }).join(',')
  };
  plan.markdown = renderJdPlan(plan);
  return plan;
}

export function renderJdPlan(plan) {
  const out = [];
  out.push('# 岗位描述 → 练习清单（' + plan.project + '）');
  out.push('');
  out.push('- 来源：' + plan.sources + ' 份岗位描述；命中知识点 ' + plan.points.length + ' 个；可练题 ' + plan.total + ' 道');
  out.push('- 说明：JD 里没有可执行命令，所以这里不是"新题"，而是把岗位要求映射到题库里已有的题，并附上原文依据');
  out.push('');
  if (!plan.total) {
    out.push('这份岗位描述没有命中任何知识点（可能是纯销售/运营类岗位，或文本太短）。');
    return out.join('\n') + '\n';
  }
  out.push('## 先练这些（' + plan.nextUp.length + ' 道）');
  out.push('');
  out.push('| # | 题号 | 方向 | 难度 | 为什么练它 | 原文依据 |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  plan.nextUp.forEach(function (row, index) {
    out.push('| ' + (index + 1) + ' | ' + row.taskId + ' | ' + row.track + ' | ' + levelLabel(row.level) + ' | '
      + row.reason + ' | ' + (row.evidence || '（知识点匹配）') + ' |');
  });
  out.push('');
  out.push('## 命中知识点');
  out.push('');
  plan.points.forEach(function (id) {
    const point = POINTS.filter(function (row) { return row.id === id; })[0];
    out.push('- ' + id + (point ? '：' + point.name : ''));
  });
  out.push('');
  out.push('## 下一步');
  out.push('');
  out.push('```');
  out.push(plan.command || '（没有待练的题，可按清单复习）');
  out.push('```');
  return out.join('\n') + '\n';
}
