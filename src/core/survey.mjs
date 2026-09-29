// 多岗位调研：把 N 份岗位要求（BOSS 等平台抓来的、粘的、截图的）聚合成"市场需求画像"。
//
// 求职者真正需要知道的三件事，这里都要能给：
//   ① 哪些技术栈在多数岗位里出现（跨岗位通用技能，优先级最高）
//   ② 每个技术栈我们有没有题可练、覆盖到什么程度（软件能不能支撑学习）
//   ③ 出现频率高但我们没覆盖的（补词库/补题库的排期依据）
import { annotateOnlyFor, extractStack, stackReport, STACK_LEXICON } from './stack.mjs';
import { POINTS } from './knowledge.mjs';

export function surveyJds(items, options) {
  const opts = options || {};
  const tasks = opts.tasks || [];
  const taskIndex = new Map(tasks.map(function (task) { return [task.id, task]; }));;
  const minJobs = Math.max(1, Number(opts.minJobs) || 1);
  const jobs = (items || []).filter(function (item) { return String(item.text || '').trim(); });
  const byTerm = new Map();
  const perJob = [];

  jobs.forEach(function (item, index) {
    const rows = extractStack(String(item.text), { taskIndex: taskIndex, points: POINTS });
    const report = stackReport(rows, {});
    perJob.push({
      name: item.name || ('岗位 ' + (index + 1)),
      source: item.source || '',
      terms: rows.map(function (row) { return row.term; }),
      categories: report.categories.map(function (cat) { return cat.name; }),
      points: report.stats.points,
      tasks: report.stats.tasks,
      uncovered: report.uncovered.map(function (row) { return row.term; })
    });
    rows.forEach(function (row) {
      if (!byTerm.has(row.term)) {
        byTerm.set(row.term, {
          term: row.term,
          category: row.category,
          aliases: row.aliases,
          jobs: 0,
          points: row.points,
          pointNames: row.pointNames,
          tasks: row.tasks,
          covered: row.covered,
          samples: []
        });
      }
      const hit = byTerm.get(row.term);
      hit.jobs += 1;
      if (row.evidence.length) hit.samples.push({ job: item.name || '', line: row.evidence[0] });
    });
  });

  const total = jobs.length;
  const terms = Array.from(byTerm.values()).map(function (row) {
    row.share = total ? Math.round(row.jobs / total * 100) : 0;
    return row;
  }).sort(function (a, b) { return b.jobs - a.jobs || a.term.localeCompare(b.term); });

  const categoryMap = new Map();
  terms.forEach(function (row) {
    if (!categoryMap.has(row.category)) categoryMap.set(row.category, { name: row.category, jobs: row.jobs, terms: [] });
    const cat = categoryMap.get(row.category);
    cat.terms.push(row.term);
  });
  const categories = Array.from(categoryMap.values()).sort(function (a, b) { return b.terms.length - a.terms.length; });

  // 先分清两类未覆盖，再算"通用技能"与建议：只标注的那些（硬件/云控制台/专用芯片）不是练习目标，
  // 否则它们会因为"出现在 100% 的岗位里"被推荐成 priority-practice（实测踩过）。
  const uncoveredRows = terms.filter(function (row) { return !row.covered; });
  const annotated = uncoveredRows.filter(function (row) { return annotateOnlyFor(row.term); }).map(function (row) {
    const note = annotateOnlyFor(row.term);
    return Object.assign({}, row, { reason: note.reason, suggestion: note.suggestion || '' });
  });
  const annotatedTerms = annotated.map(function (row) { return row.term; });
  const gaps = uncoveredRows.filter(function (row) { return annotatedTerms.indexOf(row.term) === -1; });
  const common = terms.filter(function (row) { return row.share >= 50 && annotatedTerms.indexOf(row.term) === -1; });
  const rare = terms.filter(function (row) { return row.jobs >= minJobs && !row.covered; });

  // 建议：按"出现岗位数 × 是否已覆盖"排序，直接当补课表/补题库排期用
  const suggestions = [];
  gaps.forEach(function (row) {
    suggestions.push({
      kind: 'lexicon-and-tasks',
      term: row.term,
      jobs: row.jobs,
      why: row.term + ' 在 ' + row.jobs + '/' + total + ' 个岗位里出现，但知识字典没有对应知识点/题'
    });
  });
  common.forEach(function (row) {
    suggestions.push({
      kind: 'priority-practice',
      term: row.term,
      jobs: row.jobs,
      why: row.term + ' 是跨岗位通用技能（' + row.share + '% 的岗位要求），可练 ' + row.tasks.length + ' 道' + (row.tasks.length === 0 ? '——需要补题' : '')
    });
  });
  const weakTerms = terms.filter(function (row) { return row.covered && row.jobs >= 2 && row.tasks.length <= 3; });
  weakTerms.forEach(function (row) {
    suggestions.push({
      kind: 'add-tasks',
      term: row.term,
      jobs: row.jobs,
      why: row.term + ' 有知识点但只有 ' + row.tasks.length + ' 道题（' + row.jobs + ' 个岗位要求），题量偏少'
    });
  });

  const survey = {
    jobs: total,
    perJob: perJob,
    terms: terms,
    categories: categories,
    common: common,
    gaps: gaps,
    annotated: annotated,
    suggestions: suggestions,
    stats: {
      jobs: total,
      terms: terms.length,
      categories: categories.length,
      common: common.length,
      covered: terms.filter(function (row) { return row.covered; }).length,
      gaps: gaps.length,
      annotated: annotated.length,
      lexiconSize: STACK_LEXICON.length
    }
  };
  survey.markdown = renderSurvey(survey, { minJobs: minJobs });
  return survey;
}

export function renderSurvey(survey, options) {
  const opts = options || {};
  const out = [];
  out.push('# 岗位技术需求调研（' + survey.stats.jobs + ' 份岗位要求）');
  out.push('');
  out.push('- 覆盖到的技术栈：' + survey.stats.terms + ' 项 / ' + survey.stats.categories + ' 类（词库 ' + survey.stats.lexiconSize + ' 条）');
  out.push('- 跨岗位通用技能（≥50% 岗位要求）：' + survey.stats.common + ' 项');
  out.push('- 知识字典未覆盖（该补题）：' + survey.stats.gaps + ' 项');
  out.push('');
  out.push('## 一、需求热度排行（出现在多少个岗位里）');
  out.push('');
  out.push('| 技术栈 | 类别 | 岗位数 | 占比 | 可练题 | 覆盖 |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  survey.terms.forEach(function (row) {
    out.push('| ' + row.term + ' | ' + row.category + ' | ' + row.jobs + '/' + survey.jobs + ' | ' + row.share + '% | ' + row.tasks.length + ' | ' + (row.covered ? '✓' : '✗ 缺') + ' |');
  });
  out.push('');
  out.push('## 二、跨岗位通用技能（优先级最高）');
  out.push('');
  if (!survey.common.length) out.push('（没有达到 50% 的技术栈）');
  survey.common.forEach(function (row) {
    out.push('- **' + row.term + '**（' + row.jobs + '/' + survey.jobs + '，' + row.share + '%）：可练 ' + row.tasks.length + ' 道' + (row.covered ? '' : '——⚠ 字典未覆盖'));
  });
  out.push('');
  out.push('## 三、缺口（该补题 vs 只标注）');
  out.push('');
  out.push('**该补题**：');
  out.push('');
  if (!survey.gaps.length) out.push('- 无——本次提到的技术栈要么已有知识点，要么属于下面的"只标注"。');
  survey.gaps.forEach(function (row) {
    out.push('- ' + row.term + '（' + row.category + '）：' + row.jobs + '/' + survey.jobs + ' 个岗位要求，别名 ' + row.aliases.join('/'));
    if (row.samples.length) out.push('    - 原文：' + row.samples[0].line.slice(0, 80));
  });
  out.push('');
  out.push('**只标注（只调研不出题，附原因）**：');
  out.push('');
  if (!survey.annotated.length) {
    out.push('- 无。');
  } else {
    survey.annotated.forEach(function (row) {
      out.push('- ' + row.term + '（' + row.category + '）：' + row.jobs + '/' + survey.jobs + ' 个岗位要求');
      out.push('    - 为什么不出题：' + row.reason);
      if (row.suggestion) out.push('    - 建议：' + row.suggestion);
    });
  }
  out.push('');
  out.push('## 四、行动建议（按影响面排序）');
  out.push('');
  survey.suggestions.slice(0, 20).forEach(function (row) { out.push('- [' + row.kind + '] ' + row.why); });
  out.push('');
  out.push('## 五、逐份岗位摘要');
  out.push('');
  survey.perJob.forEach(function (row) {
    out.push('- ' + row.name + '：技术栈 ' + row.terms.length + ' 项 / ' + row.categories.length + ' 类，知识点 ' + row.points + '，可练 ' + row.tasks + ' 道'
      + (row.uncovered.length ? '；未覆盖 ' + row.uncovered.join('、') : ''));
  });
  out.push('');
  out.push('> 调研结论由 dsh-learn 依据输入的岗位要求生成：热度=出现岗位数，覆盖=知识字典里有没有对应知识点与题；未覆盖的如实列出，不做猜测。');
  return out.join('\n') + '\n';
}

// 分组调研：把语料按方向（分类目录 / 岗位集合）分别画像，再给一张跨方向对比矩阵。
//
// 为什么单独做：一锅端的调研会得出"C/C++ 25%、Python 25%"这种平均结论，看不出方向差异；
// 而求职者真正要选的是方向——哪些技术栈是这个方向的"入场券"（本方向高频），哪些是全网通用（跨方向都高频）。
//
// 输出：① 每个方向的画像（热点、该补题、只标注）② 矩阵：技术栈 × 方向（出现岗位数）
//      ③ 共性（出现在 ≥ 半数方向）与专有（只在 1 个方向出现）
export function surveyGroups(groups, options) {
  const opts = options || {};
  const tasks = opts.tasks || [];
  const taskIndex = new Map(tasks.map(function (task) { return [task.id, task]; }));
  const rows = (groups || []).map(function (group) {
    const survey = surveyJds(group.items || [], { tasks: tasks, minJobs: opts.minJobs });
    return { name: group.name, survey: survey };
  }).filter(function (row) { return row.survey.jobs > 0; });

  // 矩阵：term → 每个方向的岗位数
  const termMap = new Map();
  rows.forEach(function (row) {
    row.survey.terms.forEach(function (term) {
      if (!termMap.has(term.term)) {
        termMap.set(term.term, {
          term: term.term,
          category: term.category,
          covered: term.covered,
          annotateOnly: Boolean(term.annotateOnly),
          byGroup: {},
          total: 0
        });
      }
      const hit = termMap.get(term.term);
      hit.byGroup[row.name] = (hit.byGroup[row.name] || 0) + term.jobs;
      hit.total += term.jobs;
    });
  });
  const matrix = Array.from(termMap.values()).sort(function (a, b) { return b.total - a.total || a.term.localeCompare(b.term); });
  const groupCount = rows.length;
  const shared = matrix.filter(function (row) { return Object.keys(row.byGroup).length >= Math.max(2, Math.ceil(groupCount / 2)); });
  const unique = matrix.filter(function (row) { return Object.keys(row.byGroup).length === 1; });

  const result = {
    groups: rows,
    matrix: matrix,
    shared: shared,
    unique: unique,
    stats: {
      groups: groupCount,
      jobs: rows.reduce(function (sum, row) { return sum + row.survey.jobs; }, 0),
      terms: matrix.length,
      shared: shared.length,
      unique: unique.length
    }
  };
  result.markdown = renderGroupSurvey(result, { taskIndex: taskIndex });
  return result;
}

export function renderGroupSurvey(result, options) {
  const opts = options || {};
  const out = [];
  const names = result.groups.map(function (row) { return row.name; });
  out.push('# 分方向岗位要求画像（' + result.stats.groups + ' 个方向 / ' + result.stats.jobs + ' 份岗位）');
  out.push('');
  out.push('- 覆盖技术栈：' + result.stats.terms + ' 项；跨方向共性 ' + result.stats.shared + ' 项；方向专有 ' + result.stats.unique + ' 项');
  out.push('- 读法：矩阵里数字是"该方向有多少份岗位提到它"；共性项是入场券，专有项是方向标识');
  out.push('');
  out.push('## 一、技术栈 × 方向 矩阵');
  out.push('');
  out.push('| 技术栈 | 类别 | ' + names.join(' | ') + ' | 合计 | 覆盖 |');
  out.push('| --- | --- | ' + names.map(function () { return '---'; }).join(' | ') + ' | --- | --- |');
  result.matrix.forEach(function (row) {
    out.push('| ' + row.term + ' | ' + row.category + ' | '
      + names.map(function (name) { return row.byGroup[name] ? String(row.byGroup[name]) : '·'; }).join(' | ')
      + ' | ' + row.total + ' | ' + (row.covered ? '✓' : (row.annotateOnly ? '✎ 只标注' : '✗ 缺')) + ' |');
  });
  out.push('');
  out.push('## 二、跨方向共性（多半是入场券）');
  out.push('');
  if (!result.shared.length) out.push('（没有出现在半数以上方向的技术栈）');
  result.shared.forEach(function (row) {
    out.push('- ' + row.term + '：' + Object.keys(row.byGroup).length + '/' + result.stats.groups + ' 个方向，合计 ' + row.total + ' 份岗位提到');
  });
  out.push('');
  out.push('## 三、方向专有（只在 1 个方向出现）');
  out.push('');
  if (!result.unique.length) out.push('（没有仅出现在单一方向的技术栈）');
  result.unique.forEach(function (row) {
    const name = Object.keys(row.byGroup)[0];
    out.push('- ' + name + ' 专属：' + row.term + '（' + row.byGroup[name] + ' 份岗位）');
  });
  out.push('');
  out.push('## 四、逐方向画像');
  out.push('');
  result.groups.forEach(function (row) {
    const survey = row.survey;
    const top = survey.terms.slice(0, 8).map(function (term) { return term.term + '(' + term.jobs + ')'; }).join('、');
    out.push('### ' + row.name + '（' + survey.jobs + ' 份）');
    out.push('');
    out.push('- 热点：' + (top || '（无）'));
    out.push('- 该补题：' + (survey.gaps.length ? survey.gaps.map(function (g) { return g.term; }).join('、') : '无'));
    out.push('- 只标注：' + (survey.annotated.length ? survey.annotated.map(function (g) { return g.term; }).join('、') : '无'));
    out.push('');
  });
  out.push('> 分方向结论由 dsh-learn 依据各方向语料分别统计；矩阵数字是岗位份数，不代表权重，也不含猜测。');
  return out.join('\n') + '\n';
}
