// 把"这份 JD / 文档 / 截图里到底说了什么"描述成一份完整报告：
//   ① 基本信息（来源、公司、岗位、级别、地点、薪资、发布时间）
//   ② 内容结构（分类、职责分段、硬要求/加分项，每条带判定依据）
//   ③ 技术栈（按类别，每项标：出现在哪一行、命中哪些知识点、可练多少题、字典有没有覆盖）
//   ④ 知识点与可练题清单（按技术栈分组）
//   ⑤ 字典未覆盖清单（这是"该补题库"的信号，不藏起来）
import { POINTS } from './knowledge.mjs';
import { extractStack, stackReport } from './stack.mjs';
import { summarizeUnderstanding, understandText } from './understand.mjs';

export function describeExtraction(text, options) {
  const opts = options || {};
  const tasks = opts.tasks || [];
  const taskIndex = new Map(tasks.map(function (task) { return [task.id, task]; }));
  const understood = opts.understood || understandText(String(text || ''), { limit: 20 });
  const report = stackReport(extractStack(String(text || ''), { taskIndex: taskIndex }), {});
  const coveredTasks = opts.passedIds || new Set();
  const description = {
    source: opts.source || '文本',
    kind: understood.kind,
    company: understood.company,
    position: understood.position,
    seniority: understood.seniority,
    education: understood.education,
    years: understood.years,
    location: understood.location,
    salary: understood.salary,
    postedAt: understood.postedAt,
    remote: understood.remote,
    sections: understood.sections,
    responsibilities: understood.responsibilities,
    mustHave: understood.mustHave,
    niceToHave: understood.niceToHave,
    headline: summarizeUnderstanding(understood),
    report: report
  };
  description.markdown = renderDescription(description, { passedIds: coveredTasks, taskIndex: taskIndex });
  return description;
}

export function renderDescription(description, options) {
  const opts = options || {};
  const passed = opts.passedIds || new Set();
  const taskIndex = opts.taskIndex || new Map();
  const report = description.report;
  const out = [];
  out.push('# 内容描述与提取：' + (description.position || description.company || '（未标注对象）'));
  out.push('');
  out.push('## 一、基本信息');
  out.push('');
  out.push('| 项 | 值 |');
  out.push('| --- | --- |');
  out.push('| 来源 | ' + description.source + ' |');
  out.push('| 类型 | ' + description.kind + ' |');
  out.push('| 公司 | ' + (description.company || '（未识别）') + ' |');
  out.push('| 岗位 | ' + (description.position || '（未识别）') + ' |');
  out.push('| 级别 / 年限 | ' + (description.seniority || '-') + (description.years ? ' / ' + description.years + ' 年' : '') + ' |');
  out.push('| 地点 | ' + (description.location || '-') + (description.remote ? '（可远程）' : '') + ' |');
  out.push('| 薪资 | ' + ((description.salary && description.salary.text) || '-') + ' |');
  out.push('| 发布 | ' + (description.postedAt || '-') + ' |');
  out.push('| 提取规模 | 技术栈 ' + report.stats.terms + ' 项 / ' + report.stats.categories + ' 类；知识点 ' + report.stats.points + ' 个；可练题 ' + report.stats.tasks + ' 道 |');
  out.push('');
  out.push('## 二、内容结构');
  out.push('');
  if (description.responsibilities.length) {
    out.push('**职责分段**');
    out.push('');
    description.responsibilities.forEach(function (row) { out.push('- ' + row); });
    out.push('');
  }
  if (description.mustHave.length) {
    out.push('**硬要求（' + description.mustHave.length + ' 条，方括号里是判定依据）**');
    out.push('');
    description.mustHave.forEach(function (row) { out.push('- ' + row.text + '　[' + row.evidence + ']'); });
    out.push('');
  }
  if (description.niceToHave.length) {
    out.push('**加分项（' + description.niceToHave.length + ' 条）**');
    out.push('');
    description.niceToHave.forEach(function (row) { out.push('- ' + row.text); });
    out.push('');
  }
  out.push('## 三、技术栈（按类别，含覆盖情况）');
  out.push('');
  out.push('| 类别 | 技术栈 | 知识点 | 可练题 | 覆盖 |');
  out.push('| --- | --- | --- | --- | --- |');
  report.categories.forEach(function (cat) {
    out.push('| ' + cat.name + ' | ' + cat.items.map(function (item) { return item.term; }).join('、')
      + ' | ' + cat.items.reduce(function (sum, item) { return sum + item.points.length; }, 0)
      + ' | ' + cat.items.reduce(function (sum, item) { return sum + item.tasks.length; }, 0)
      + ' | ' + cat.items.filter(function (item) { return item.covered; }).length + '/' + cat.items.length + ' |');
  });
  out.push('');
  out.push('### 每个技术栈对应什么（依据 + 知识点 + 题）');
  out.push('');
  report.rows.forEach(function (row) {
    const done = row.tasks.filter(function (id) { return passed.has(id); }).length;
    out.push('- **' + row.term + '**（' + row.category + '）'
      + (row.covered ? '' : (row.annotateOnly ? '　✎ 只标注：' + (row.annotateReason || '') : '　⚠ 知识字典未覆盖'))
      + '：知识点 ' + (row.pointNames.join('、') || '无')
      + '；可练 ' + row.tasks.length + ' 道' + (row.tasks.length ? '（已通过 ' + done + '）' : ''));
    row.evidence.forEach(function (line) { out.push('    - 原文：' + line.slice(0, 90)); });
  });
  out.push('');
  out.push('## 四、知识点与可练题清单');
  out.push('');
  const pointIds = [];
  report.rows.forEach(function (row) { row.points.forEach(function (id) { if (pointIds.indexOf(id) === -1) pointIds.push(id); }); });
  if (!pointIds.length) {
    out.push('（没有命中任何知识点：要么这段内容不是技术岗位，要么该补题库/词表）');
  } else {
    pointIds.forEach(function (id) {
      const point = POINTS.filter(function (item) { return item.id === id; })[0];
      if (!point) return;
      const playable = (point.tasks || []).filter(function (taskId) { return taskIndex.size === 0 || taskIndex.has(taskId); });
      const done = playable.filter(function (taskId) { return passed.has(taskId); }).length;
      out.push('- ' + point.name + '（' + point.module + ' / ' + point.level + '）：' + playable.length + ' 道，已通过 ' + done);
      if (point.tip) out.push('    - 提示：' + point.tip);
    });
  }
  out.push('');
  out.push('## 五、字典未覆盖（该补题 / 只标注）');
  out.push('');
  out.push('**该补题**：');
  out.push('');
  if (!report.uncovered.length) {
    out.push('- 无——本次提到的技术栈要么有对应知识点，要么属于下面的"只标注"。');
  } else {
    report.uncovered.forEach(function (row) { out.push('- ' + row.term + '（' + row.category + '）：' + (row.aliases.join('、'))); });
    out.push('');
    out.push('> 这些词在 JD 里出现了，但没有对应知识点/题目——可以先按它们在浏览器里练手，或者把题补进题库。');
  }
  out.push('');
  out.push('**只标注（只调研不出题，附原因）**：');
  out.push('');
  if (!(report.annotated || []).length) {
    out.push('- 无。');
  } else {
    (report.annotated || []).forEach(function (row) {
      out.push('- ' + row.term + '（' + row.category + '）：' + row.annotateReason);
      if (row.annotateSuggestion) out.push('    - 建议：' + row.annotateSuggestion);
    });
  }
  out.push('');
  out.push('> 描述与提取由 dsh-learn 依据输入文本生成；每条技术栈都带原文依据，未覆盖的如实列出，不做猜测补充。');
  return out.join('\n') + '\n';
}
