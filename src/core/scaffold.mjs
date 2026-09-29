// 按岗位要求生成"可交付的项目"：项目书 + 验收清单 + 命令清单。
//
// 边界要说清楚：这里**不替用户写代码**，而是把"这条 JD 要求什么"翻译成一份能照着做的工程说明书——
// 每条硬要求 → 对应知识点 → 该跑的命令（取自题库参考答案的第一行）→ 练哪几道题 → 做成什么样才算完成（done-when）。
// 这样"按岗位要求生成项目"落地成：一个带 JD、带索引、带说明书、带勾选清单的项目目录。
import { PASS_SCORE } from './judge.mjs';
import { taskStats } from './progress.mjs';
import { tasksFromRequirementLine } from './flow.mjs';
import { POINTS } from './knowledge.mjs';

export const SCAFFOLD_FILES = ['项目书.md', 'checklist.md', 'notes/命令清单.md'];

// 从参考答案里挑第一条像命令的行（题库的 sample 是可直接执行的命令或小脚本）
export function firstCommand(sample) {
  const rows = String(sample || '').split(/\r?\n/);
  for (const row of rows) {
    const text = row.trim();
    if (!text) continue;
    if (text.startsWith('#')) continue;
    if (/^(\$|sudo|docker|kubectl|systemctl|git|npm|python3?|go|awk|sed|find|tar|ps|ss|netstat|df|du|free|top|journalctl|openssl|curl|nmap|nc)\b/.test(text) || /^[a-z][a-z0-9._-]*\s+\S/i.test(text)) {
      return text.slice(0, 120);
    }
  }
  return '';
}

export function buildScaffold(job, tasks, records, options) {
  const opts = options || {};
  const stats = taskStats(records, tasks);
  const passedIds = new Set(stats.known.filter(function (row) { return row.best >= PASS_SCORE; }).map(function (row) { return row.taskId; }));
  const taskIndex = new Map((tasks || []).map(function (task) { return [task.id, task]; }));
  const pointName = function (id) {
    const point = POINTS.filter(function (item) { return item.id === id; })[0];
    return point ? point.name : id;
  };

  const deliverables = ((job.analysis && job.analysis.mustHave) || []).map(function (row) {
    const resolved = tasksFromRequirementLine(row.text, tasks, 12);
    const rows = resolved.ids.map(function (id) { return taskIndex.get(id); }).filter(Boolean);
    const passed = rows.filter(function (task) { return passedIds.has(task.id); });
    const commands = [];
    rows.forEach(function (task) {
      const command = firstCommand(task.sample);
      if (command && commands.indexOf(command) === -1) commands.push(command);
    });
    return {
      requirement: row.text,
      evidence: row.evidence || '',
      via: resolved.via,
      points: resolved.points.map(pointName),
      tasks: rows.map(function (task) { return task.id; }),
      passed: passed.length,
      commands: commands.slice(0, 6),
      doneWhen: commands.length
        ? ('能不看答案独立跑出并解释：' + commands.slice(0, 2).join('　|　'))
        : '这条要求暂时没挂上题：按 JD 原文自己写一份操作记录（做了什么、看到什么、怎么判断成功）'
    };
  });

  const allCommands = [];
  deliverables.forEach(function (row) { row.commands.forEach(function (cmd) { if (allCommands.indexOf(cmd) === -1) allCommands.push(cmd); }); });
  const allTasks = [];
  deliverables.forEach(function (row) { row.tasks.forEach(function (id) { if (allTasks.indexOf(id) === -1) allTasks.push(id); }); });
  const missingTasks = allTasks.filter(function (id) { return !passedIds.has(id); });
  const half = Math.max(1, Math.ceil(allCommands.length / 2));

  const scaffold = {
    jobId: job.id,
    company: job.company,
    position: job.position,
    url: job.url || '',
    projectName: opts.project || '',
    deliverables: deliverables,
    commands: allCommands,
    tasks: allTasks,
    missingTasks: missingTasks,
    milestones: [
      { name: '第一步：把命令跑通', goal: '照着命令清单在真实环境（或 Docker）里跑一遍，把输出记下来；跑不通的先看题目提示。', done: '至少 ' + half + ' 条命令有自己记录的输出' },
      { name: '第二步：做出交付物', goal: '每条硬要求交一份东西：操作记录 / 配置 / 脚本 / 排查报告都行，只要别人能照着复现。', done: deliverables.length + ' 条硬要求都有对应产物（checklist.md 逐条勾）' },
      { name: '第三步：自己验一遍', goal: '把差额题全部练到通过，并跑一次工具自检；这一步过了，简历里就能写这个项目。', done: missingTasks.length ? ('待通过 ' + missingTasks.length + ' 道题') : '相关题已全部通过' }
    ]
  };
  scaffold.checklist = renderChecklist(scaffold);
  scaffold.book = renderProjectBook(scaffold);
  scaffold.commandSheet = renderCommandSheet(scaffold);
  return scaffold;
}

export function renderProjectBook(scaffold) {
  const out = [];
  out.push('# 项目书：' + scaffold.company + ' · ' + scaffold.position);
  out.push('');
  out.push('> 由 dsh-learn 按岗位要求生成：把 JD 的硬要求翻译成"要做出什么、用什么命令、怎么算做完"。');
  out.push('> 它不替你写代码，也不编经历——每条要求后面标的题号，都是你可以在本机真跑一遍的。');
  out.push('');
  if (scaffold.url) { out.push('- 岗位链接：' + scaffold.url); out.push(''); }
  out.push('## 一、这个项目要交付什么');
  out.push('');
  if (!scaffold.deliverables.length) {
    out.push('（这条岗位记录里没有硬要求：先 jobs analyze，或重新入库一次 JD）');
  } else {
    out.push('| # | 岗位要求 | 对应知识点 | 要跑的命令 | 完成标准 | 已通过 |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    scaffold.deliverables.forEach(function (row, index) {
      const tick = String.fromCharCode(96);
      const cmds = row.commands.map(function (cmd) { return tick + cmd + tick; }).join('<br>') || '—';
      out.push('| ' + (index + 1) + ' | ' + row.requirement + '　[' + row.evidence + '] | ' + (row.points.join('、') || '（字典未覆盖，按 JD 原文）')
        + ' | ' + cmds + ' | ' + row.doneWhen + ' | ' + row.passed + '/' + row.tasks.length + ' |');
    });
  }
  out.push('');
  out.push('## 二、里程碑');
  out.push('');
  scaffold.milestones.forEach(function (row, index) {
    out.push('### ' + (index + 1) + '. ' + row.name);
    out.push('');
    out.push('- 做什么：' + row.goal);
    out.push('- 算完成：' + row.done);
    out.push('');
  });
  out.push('## 三、怎么自检');
  out.push('');
  out.push('- 练差额题：node src/cli.mjs drill --tasks=' + (scaffold.missingTasks.slice(0, 12).join(',') || '（无）'));
  out.push('- 看这个项目：node src/cli.mjs project show ' + scaffold.projectName);
  out.push('- 交之前跑一遍：node src/cli.mjs flow pack ' + scaffold.jobId + '（逐条对硬要求的投递材料）');
  out.push('');
  out.push('## 四、写进简历时可以这么说（都基于你真跑过的东西）');
  out.push('');
  out.push('- 按这份 JD 的要求，独立完成了 ' + scaffold.deliverables.length + ' 项任务（' + scaffold.commands.length + ' 条命令、' + scaffold.tasks.length + ' 道对应实操题）');
  out.push('- 产物：项目书.md / checklist.md / notes/命令清单.md 与自己的操作记录');
  out.push('');
  out.push('> 提醒：简历措辞请自己改写；上面两句只把"你确实做过的事"说清楚，没有替你加任何经历。');
  return out.join('\n') + '\n';
}

export function renderChecklist(scaffold) {
  const out = [];
  out.push('# 验收清单：' + scaffold.company + ' · ' + scaffold.position);
  out.push('');
  out.push('> 逐条勾：每条要求"有产物 + 命令能复现"才算完成。工具不会替你勾——它只负责把标准写清楚。');
  out.push('');
  if (!scaffold.deliverables.length) out.push('- [ ] 先把 JD 存进记录并分析（jobs add / jobs analyze）');
  scaffold.deliverables.forEach(function (row) {
    out.push('## ' + row.requirement);
    out.push('');
    out.push('- [ ] 命令都跑过一遍：' + (row.commands.join('　|　') || '（按 JD 原文自己定）'));
    out.push('- [ ] 有可复现的产物（操作记录 / 配置 / 脚本 / 报告），存在这个项目目录里');
    out.push('- [ ] 对应题练到通过：' + (row.tasks.join('、') || '（无）'));
    out.push('- [ ] 能在 3 分钟内讲清楚这条要求的原理与坑');
    out.push('');
  });
  out.push('## 收尾');
  out.push('');
  scaffold.milestones.forEach(function (row) { out.push('- [ ] ' + row.name + '：' + row.done); });
  out.push('- [ ] 生成投递材料：node src/cli.mjs flow pack ' + scaffold.jobId);
  out.push('- [ ] 记投递：node src/cli.mjs flow apply ' + scaffold.jobId);
  return out.join('\n') + '\n';
}

export function renderCommandSheet(scaffold) {
  const out = [];
  out.push('# 命令清单（按岗位要求分组）');
  out.push('');
  out.push('> 命令取自题库里对应题的参考答案（本机可执行）。跑之前想清楚"预期看到什么"，跑完把输出记下来。');
  out.push('');
  scaffold.deliverables.forEach(function (row) {
    out.push('## ' + row.requirement);
    out.push('');
    if (!row.commands.length) { out.push('（这条要求没挂上题，命令自己按 JD 定）'); out.push(''); return; }
    row.commands.forEach(function (cmd) { out.push('    ' + cmd); });
    out.push('');
    out.push('对应题：' + row.tasks.join('、'));
    out.push('');
  });
  return out.join('\n') + '\n';
}
