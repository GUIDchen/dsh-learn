// 学习页的支撑面板：进度 / 开练 / 历史 / 每日 / 复习 / 目标 / 笔记 / 排行榜 / 知识点。
//
// 从 app.mjs 拆出来的第三个功能性模块。依赖注入：api/$/escapeText 是工具，state 传的是**同一个对象引用**
// ——面板里对 state.byTask / state.streak 等的写入必须对其它模块可见。
// 页面内的按钮绑定也一并搬进来（在 initPanels 时执行，此时 index.html 已经就绪）。
export function initPanels(deps) {
  const api = deps.api;
  const $ = deps.$;
  const escapeText = deps.escapeText;
  const state = deps.state;
  // 这些是学习页面板真正用到、但拆出来时漏注入的：静态检查（lint-unresolved）一次抓出 8 个，
  // 而浏览器冒烟当时没走到历史/目标/排行榜那几条路径，所以没暴露。全部由 app.mjs 注入。
  const post = deps.post;
  const clientId = deps.clientId;
  const bootstrap = deps.bootstrap;
  const refreshAll = deps.refreshAll;
  const renderTaskList = deps.renderTaskList;
  const goToTask = deps.goToTask;
  const bar = deps.bar;
  const percentText = deps.percentText;

function renderVerify(payload) {
  if (payload.probe) {
    const p = payload.probe;
    const lines = p.probes.map(function (item) {
      return '- ' + item.label + '：' + (item.ran ? (item.ok ? '成功' : '失败') : '未执行') + '  [' + item.cmd + ']';
    });
    $('result').innerHTML = '<pre>' + escapeText('平台：' + p.profile.name + '\n' + lines.join('\n') + '\n诊断：' + (p.daemonDown ? p.profile.daemonHint : '未发现守护进程问题')) + '</pre>';
    return;
  }
  const v = payload.verify;
  $('result').innerHTML = '<pre>' + escapeText('执行后端：' + (v.runner || 'local') + '\n验证命令：' + (v.cmd || '-') + '\n结果：'
    + (v.ran ? (v.ok ? '通过' : '未通过') : '未执行') + '\n说明：' + v.reason + (v.output ? '\n输出：\n' + v.output : '')) + '</pre>';
}

// ---------------- 右栏渲染 ----------------
function renderProgress(payload) {
  const summary = payload.summary;
  state.byTask = payload.byTask || {};
  state.streak = payload.streak || 0;
  if (typeof payload.passScore === 'number') state.passScore = payload.passScore;
  if (typeof payload.partialScore === 'number') state.partialScore = payload.partialScore;
  $('streakBadge').textContent = '连续 ' + state.streak + ' 天';
  // 整体完成度用 percentText：587 道题里通过 1–5 道时，取整会显示 0%（做过事却像没做）
  let html = '<div class="ok">整体 ' + percentText(summary.passed, summary.total, summary.percent) + '　<span class="bar">' + bar(summary.percent) + '</span></div>';
  html += '<div class="muted">通过 ' + summary.passed + ' / ' + summary.total + '（已练习 ' + summary.attempted + ' 题）</div>';
  summary.byTrack.forEach(function (row) {
    html += '<div class="muted">[' + escapeText(row.track) + '] ' + String(row.percent).padStart(3) + '% <span class="bar">'
      + bar(row.percent, 10) + '</span> ' + row.passed + '/' + row.total + '</div>';
  });
  if (summary.weak.length) {
    html += '<h2 style="margin-top:10px">需要重练</h2><ul>';
    summary.weak.slice(0, 6).forEach(function (row) {
      html += '<li>' + escapeText(row.taskId) + '（最高 ' + row.best + ' 分）' + '</li>';
    });
    html += '</ul>';
  }
  $('progress').innerHTML = html;
  renderTaskList();
}

function renderDrill(payload) {
  const rows = payload.practice || [];
  if (!rows.length) {
    $('drill').innerHTML = '<div class="muted">这个筛选下没有需要练的题。</div>';
    return;
  }
  const modeLabel = { weak: '重练', new: '未练习', all: '全量' }[payload.mode] || payload.mode;
  // 公式要跟 progress.mjs 的 practiceWeight 一致：次数只对"还没满分"的题加权
  let html = '<div class="muted">模式：' + modeLabel + '，权重 = (100 − 最高分) + 还没满分时的练习次数 × 5（已经满分的题权重回到 0）</div><table><tr><th scope="col">权重</th><th scope="col">题目</th><th scope="col">状态</th><th scope="col"></th></tr>';
  rows.forEach(function (row) {
    html += '<tr><td>' + row.weight + '</td><td><span class="tag">' + escapeText(row.track) + '</span>' + escapeText(row.title) + '</td><td>'
      + escapeText(row.reason) + '</td><td><button class="drillGo" data-id="' + escapeText(row.taskId) + '">练这题</button></td></tr>';
  });
  html += '</table>';
  $('drill').innerHTML = html;
  Array.prototype.forEach.call($('drill').querySelectorAll('.drillGo'), function (button) {
    button.addEventListener('click', function () { goToTask(button.getAttribute('data-id')); });
  });
}

// 当前展示的历史（回填时按行号取，避免把命令原文塞进 HTML 属性里做转义体操）
let historyRows = [];

function renderHistory(payload) {
  const allRows = payload.history || [];
  const filter = ($('historyResult') || {}).value || 'all';
  const rows = allRows.filter(function (row) {
    if (filter === 'passed') return row.verdict === '通过';
    if (filter === 'failed') return row.verdict !== '通过';
    return true;
  });
  historyRows = rows;
  if (!allRows.length) { $('history').innerHTML = '<div class="muted">还没有提交记录</div>'; return; }
  if (!rows.length) {
    $('history').innerHTML = '<div class="muted">最近 ' + allRows.length + ' 条记录里没有' + (filter === 'passed' ? '通过' : '未通过') + '的提交</div>';
    return;
  }
  const passed = rows.filter(function (row) { return row.verdict === '通过'; }).length;
  // 平台列只在真的有平台信息时出现：老记录（没有platform字段）不该留一列空白
  const withPlatform = rows.some(function (row) { return row.platform; });
  let html = '<div class="muted">' + (rows.length === allRows.length ? '共 ' : '显示 ') + rows.length
    + ' 条　通过 ' + passed + '　未通过 ' + (rows.length - passed)
    + '　（点命令可以填回输入框再改）</div>'
    + '<table><tr><th scope="col">时间</th><th scope="col">题目</th>'
    + (withPlatform ? '<th scope="col">平台</th>' : '')
    + '<th scope="col">判定</th><th scope="col">命令</th></tr>';
  rows.forEach(function (row, index) {
    const answer = String(row.answer || '');
    const shown = answer.length > 40 ? answer.slice(0, 40) + '…' : answer;
    html += '<tr><td>' + escapeText(String(row.at || '').replace('T', ' ').slice(5, 19)) + '</td><td>' + escapeText(row.taskId) + '</td>'
      + (withPlatform ? '<td>' + (row.platform ? '<span class="tag">' + escapeText(row.platform) + '</span>' : '') + '</td>' : '')
      + '<td>' + escapeText(row.verdict) + '（' + row.score + '）</td><td class="cmdline">'
      + (answer ? '<button class="ghost cmd-refill" data-index="' + index + '" title="把这行命令填回输入框">' + escapeText(shown) + '</button>'
        : '<span class="muted">（未存命令）</span>') + '</td></tr>';
  });
  $('history').innerHTML = html + '</table>';
}

// 点历史里的命令 → 填回输入框：复盘时最常见的动作是"那次写法差在哪，我改一下再判一次"
function refillFromHistory(index) {
  const row = historyRows[index];
  if (!row) return;
  const answer = String(row.answer || '');
  if (!answer) return;
  $('answer').value = answer;
  $('answer').focus({ preventScroll: true });
  $('submitHint').textContent = '已把 ' + String(row.at || '').replace('T', ' ').slice(5, 16) + ' 那次提交的命令填回输入框，改完直接判定。';
}

function renderPlan(plan) {
  let html = '<div class="muted">平台 ' + escapeText(plan.platform) + '　轨道 ' + escapeText(plan.track) + '　每天 ' + plan.hoursPerDay
    + ' 小时　共 ' + plan.taskCount + ' 题，预计 ' + plan.totalMinutes + ' 分钟，分 ' + plan.days.length + ' 天</div>';
  plan.days.forEach(function (day) {
    html += '<div class="day" style="border-left:3px solid #ccd2da;padding-left:8px;margin:8px 0"><b>第 ' + day.day + ' 天</b>（' + day.minutes + ' 分钟）<ul>';
    day.tasks.forEach(function (task) {
      html += '<li><span class="tag">' + escapeText(task.track) + '</span>' + escapeText(task.title) + '</li>';
    });
    html += '</ul></div>';
  });
  $('plan').innerHTML = html;
}

function renderBoard(rows) {
  if (!rows) return;
  let html = '<table><tr><th scope="col">客户端</th><th scope="col">提交</th><th scope="col">通过</th><th scope="col">最高</th><th scope="col">平台</th></tr>';
  rows.forEach(function (row) {
    html += '<tr><td>' + escapeText(row.client) + '</td><td>' + row.attempts + '</td><td>' + row.passed + '</td><td>' + row.best + '</td><td>' + escapeText(row.platform) + '</td></tr>';
  });
  $('board').innerHTML = rows.length ? html + '</table>' : '<div class="muted">还没有记录</div>';
}

async function loadProgress() {
  try {
    renderProgress(await api('/api/progress'));
  } catch (err) {
    $('progress').innerHTML = '<div class="muted">离线：进度需要连接服务端</div>';
  }
}
async function loadDrill() {
  try {
    const params = new URLSearchParams({ mode: $('drillMode').value, limit: $('drillLimit').value, track: state.track, platform: $('platform').value || '' });
    if (state.analyzeTasks && state.analyzeTasks.length) {
      params.set('tasks', state.analyzeTasks.join(','));
      params.set('limit', String(state.analyzeTasks.length));
    }
    renderDrill(await api('/api/drill?' + params.toString()));
  } catch (err) {
    $('drill').innerHTML = '<div class="muted">离线：建议需要连接服务端</div>';
  }
}
async function loadHistory() {
  try {
    const params = new URLSearchParams({ limit: '15' });
    // 服务端只给最近 N 条，筛选在客户端做（记录本来就不多，省一次往返）
    params.set('limit', '30');
    if (state.taskId) params.set('taskId', state.taskId);
    if ($('historyMine').checked) params.set('clientId', $('clientId').value || clientId());
    renderHistory(await api('/api/history?' + params.toString()));
  } catch (err) {
    $('history').innerHTML = '<div class="muted">离线：历史需要连接服务端</div>';
  }
}
function renderDaily(payload) {
  const daily = payload.daily;
  if (!daily) { $('daily').innerHTML = '<div class="muted">题库为空，没有可推荐的内容。</div>'; return; }
  // 为什么推荐它：服务端给的 why 就是给人看的那句话，页面不再自己拼标签。
  // 之前这里按 pool 拼了"需要重练/还没练过"，review 时会显示成"来源：还没练过　该复习了（已逾期 2 天）"。
  $('daily').innerHTML = '<div class="ok">' + escapeText(daily.date) + '　<span class="tag">' + escapeText(daily.track) + '</span>'
    + escapeText(daily.title) + '</div>'
    + '<div class="muted">来源：' + escapeText(daily.why || daily.reason || '') + '</div>'
    + '<div class="muted">' + escapeText(daily.goal) + '</div>'
    + '<div class="row"><button class="drillGo" data-id="' + escapeText(daily.taskId) + '">开始这道题</button></div>';
  Array.prototype.forEach.call($('daily').querySelectorAll('.drillGo'), function (button) {
    button.addEventListener('click', function () { goToTask(button.getAttribute('data-id')); });
  });
}

async function loadDaily() {
  try {
    const params = new URLSearchParams({ track: state.track, platform: $('platform').value || '' });
    renderDaily(await api('/api/daily?' + params.toString()));
  } catch (err) {
    $('daily').innerHTML = '<div class="muted">离线：每日一题需要连接服务端</div>';
  }
}

function renderReview(payload) {
  const due = payload.due || [];
  const upcoming = payload.upcoming || [];
  if (!due.length && !upcoming.length) {
    $('review').innerHTML = '<div class="muted">还没有练过的题，先做几道吧</div>';
    return;
  }
  let html = '';
  if (!due.length) {
    html += '<div class="muted">今天没有到期要复习的题。</div>';
  } else {
    html += '<table><tr><th scope="col">题目</th><th scope="col">上次</th><th scope="col">节奏</th><th scope="col"></th></tr>';
    due.forEach(function (row) {
      html += '<tr><td><span class="tag">' + escapeText(row.track) + '</span>' + escapeText(row.title) + '</td><td>'
        + row.lastScore + ' 分</td><td>' + escapeText(row.reason) + '</td><td><button class="reviewGo" data-id="'
        + escapeText(row.taskId) + '">复习这道</button></td></tr>';
    });
    html += '</table>';
  }
  if (upcoming.length) {
    html += '<div class="muted">之后到期：' + upcoming.slice(0, 5).map(function (row) {
      return escapeText(row.taskId) + '（' + String(row.dueAt).slice(0, 10) + '）';
    }).join('、') + '</div>';
  }
  $('review').innerHTML = html;
  Array.prototype.forEach.call($('review').querySelectorAll('.reviewGo'), function (button) {
    button.addEventListener('click', function () { goToTask(button.getAttribute('data-id')); });
  });
}

async function loadReview() {
  try {
    const params = new URLSearchParams({ limit: '5', track: state.track });
    renderReview(await api('/api/review?' + params.toString()));
  } catch (err) {
    $('review').innerHTML = '<div class="muted">离线：复习队列需要连接服务端</div>';
  }
}

function renderGoal(payload) {
  const goal = payload.goal || {};
  const progress = payload.progress || {};
  if (document.activeElement !== $('goalTasks')) $('goalTasks').value = goal.dailyTasks || 0;
  if (document.activeElement !== $('goalMinutes')) $('goalMinutes').value = goal.dailyMinutes || 0;
  $('goalProgress').textContent = progress.summary || '';
  const badge = $('goalBadge');
  if (!progress.tasksTarget && !progress.minutesTarget) {
    badge.textContent = '今日 ' + (progress.tasksToday || 0) + ' 题（未设目标）';
    return;
  }
  badge.textContent = '今日 ' + (progress.tasksToday || 0) + '/' + (progress.tasksTarget || 0) + ' 题'
    + (progress.tasksMet ? ' ✓' : '');
}

async function loadGoal() {
  try {
    renderGoal(await api('/api/goal'));
  } catch (err) {
    $('goalProgress').textContent = '离线：目标需要连接服务端';
  }
}

async function saveGoal() {
  try {
    renderGoal(await post('/api/goal', {
      dailyTasks: Number($('goalTasks').value) || 0,
      dailyMinutes: Number($('goalMinutes').value) || 0
    }));
    loadProgress();
  } catch (err) {
    $('goalProgress').textContent = '离线：保存目标需要连接服务端';
  }
}

async function loadNote() {
  if (!state.taskId) {
    $('noteMeta').textContent = '选择一道题后可以记下自己的坑与心得';
    return;
  }
  try {
    const data = await api('/api/note?taskId=' + encodeURIComponent(state.taskId));
    $('noteText').value = data.note ? data.note.text : '';
    $('noteMeta').textContent = data.note
      ? (state.taskId + '　更新于 ' + String(data.note.updatedAt).replace('T', ' ').slice(0, 19))
      : (state.taskId + '　还没有笔记');
  } catch (err) {
    $('noteMeta').textContent = '离线：笔记需要连接服务端';
  }
}

async function saveNote() {
  if (!state.taskId) return;
  try {
    const data = await post('/api/note', { taskId: state.taskId, text: $('noteText').value });
    $('noteMeta').textContent = data.deleted
      ? (state.taskId + '　笔记已清空')
      : (state.taskId + '　已保存于 ' + String(data.note.updatedAt).replace('T', ' ').slice(0, 19));
  } catch (err) {
    $('noteMeta').textContent = '离线：保存笔记需要连接服务端';
  }
}

async function deleteNote() {
  if (!state.taskId) return;
  try {
    await post('/api/note', { taskId: state.taskId, text: '' });
    $('noteText').value = '';
    $('noteMeta').textContent = state.taskId + '　笔记已删除';
  } catch (err) {
    $('noteMeta').textContent = '离线：删除笔记需要连接服务端';
  }
}

async function loadBoard() {
  try {
    renderBoard((await api('/api/board')).board);
  } catch (err) {
    $('board').innerHTML = '<div class="muted">离线：排行榜需要连接服务端</div>';
  }
}

// ---------------- 事件 ----------------
$('platform').addEventListener('change', function () { bootstrap().then(refreshAll); });
$('reviewBtn').addEventListener('click', loadReview);
$('goalSaveBtn').addEventListener('click', saveGoal);
$('noteSaveBtn').addEventListener('click', saveNote);
$('noteDeleteBtn').addEventListener('click', deleteNote);
$('drillBtn').addEventListener('click', loadDrill);

// ---------------- 岗位 / 文档分析（知识点 → 训练清单）----------------
let knowledgeModule = null;
async function loadKnowledge() {
  if (!knowledgeModule) knowledgeModule = await import('/core/knowledge.mjs');
  return knowledgeModule;
}


  return { renderVerify, renderProgress, renderDrill, renderHistory, refillFromHistory, renderPlan, renderBoard, loadProgress, loadDrill, loadHistory, renderDaily, loadDaily, renderReview, loadReview, renderGoal, loadGoal, saveGoal, loadNote, saveNote, deleteNote, loadBoard, loadKnowledge };
}
