// 投递页（求职记录）：列表 / 统计 / 新增与编辑 / JD 分析 / 跟进提示 / 一键转项目。
//
// 从 app.mjs 拆出来的第二个功能性模块（第一个是 pack.mjs）。依赖注入，不让模块反向 import app.mjs。
// 对外只暴露 loadJobs / renderJobs 两个入口，其余都是页面内部实现。
export function initJobsPanel(deps) {
  const api = deps.api;
  const $ = deps.$;
  const escapeText = deps.escapeText;
  const startDrillWith = deps.startDrillWith;
  const showPage = deps.showPage;

const jobsState = { jobs: [], stats: null, statuses: [], editing: '' };

async function loadJobs() {
  const box = $('jobList');
  if (!box) return;
  const status = $('jobFilter') ? $('jobFilter').value : 'all';
  const query = $('jobQuery') ? $('jobQuery').value.trim() : '';
  try {
    const payload = await api('/api/jobs?status=' + encodeURIComponent(status || 'all') + '&q=' + encodeURIComponent(query));
    jobsState.jobs = payload.jobs || [];
    jobsState.stats = payload.stats || null;
    jobsState.statuses = payload.statuses || [];
    jobsState.follow = payload.follow || null;
    fillJobStatusSelects();
    renderJobs();
    renderJobStats();
    renderJobFollowUps();
  } catch (err) {
    box.innerHTML = '<div class="muted">读取失败：' + escapeText(err.message) + '</div>';
  }
}

function fillJobStatusSelects() {
  const rows = jobsState.statuses || [];
  const filter = $('jobFilter');
  const status = $('jobStatus');
  if (filter && filter.options.length !== rows.length + 1) {
    filter.innerHTML = '<option value="all">全部状态</option>' + rows.map(function (row) {
      return '<option value="' + escapeText(row.id) + '">' + escapeText(row.label) + '</option>';
    }).join('');
  }
  if (status && status.options.length !== rows.length) {
    status.innerHTML = rows.map(function (row) {
      return '<option value="' + escapeText(row.id) + '">' + escapeText(row.label) + '</option>';
    }).join('');
  }
}

function renderJobStats() {
  const box = $('jobStats');
  if (!box || !jobsState.stats) return;
  const stats = jobsState.stats;
  const parts = (jobsState.statuses || []).map(function (row) {
    return row.label + ' ' + String((stats.byStatus || {})[row.id] || 0);
  });
  box.textContent = '共 ' + String(stats.total) + ' 条（已投 ' + String(stats.applied) + '）　' + parts.join('　')
    + (stats.latest ? '　最近投递 ' + stats.latest : '');
}

function jobById(id) {
  return (jobsState.jobs || []).filter(function (row) { return row.id === id; })[0] || null;
}

function jobStatusLabel(status) {
  const hit = (jobsState.statuses || []).filter(function (row) { return row.id === status; })[0];
  return hit ? hit.label : status;
}

function renderJobs() {
  const box = $('jobList');
  if (!box) return;
  const rows = jobsState.jobs || [];
  if (!rows.length) {
    box.innerHTML = '<div class="muted">还没有投递记录：上面填公司 / 岗位 / 状态就能存一条；把 JD 粘进「岗位描述」后可以一键分析出知识点与可练题。</div>';
    return;
  }
  box.innerHTML = rows.map(function (job) {
    const analysis = job.analysis || null;
    let html = '<div class="job-row" data-job="' + escapeText(job.id) + '">'
      + '<div class="row" style="margin:0">'
      + '<span class="job-status s-' + escapeText(job.status) + '">' + escapeText(jobStatusLabel(job.status)) + '</span>'
      + '<strong>' + escapeText(job.company) + '</strong>　' + escapeText(job.position)
      + '<span class="muted">' + escapeText(job.appliedAt || '未投')
      + (job.url ? '　<a href="' + escapeText(job.url) + '" target="_blank" rel="noreferrer">岗位链接</a>' : '')
      + '</span></div>'
      + (analysis
        ? '<div class="muted">JD 分析：知识点 ' + String((analysis.points || []).length) + ' 个 → 可练题 ' + String((analysis.tasks || []).length) + ' 道</div>'
        : '<div class="muted">还没分析 JD' + (job.jd ? '' : '（这条没存 JD）') + '</div>')
      + (job.note ? '<div class="muted">备注：' + escapeText(job.note) + '</div>' : '')
      + renderJobTimeline(job)
      + '<div class="row" style="margin:4px 0 0">'
      + '<button class="ghost jobAnalyze" data-job="' + escapeText(job.id) + '">分析 JD</button>'
      + '<button class="ghost jobDrill" data-job="' + escapeText(job.id) + '">练相关题</button>'
      + '<button class="ghost jobProject" data-job="' + escapeText(job.id) + '">建项目并收 JD</button>'
      + '<button class="ghost jobEdit" data-job="' + escapeText(job.id) + '">编辑</button>'
      + '<button class="ghost jobDelete" data-job="' + escapeText(job.id) + '">删除</button>'
      + '</div></div>';
    return html;
  }).join('');
  Array.prototype.forEach.call(box.querySelectorAll('.jobAnalyze'), function (button) {
    button.addEventListener('click', function () { analyzeJob(button.getAttribute('data-job')); });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.jobDrill'), function (button) {
    button.addEventListener('click', function () { drillJob(button.getAttribute('data-job')); });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.jobProject'), function (button) {
    button.addEventListener('click', function () { jobToProject(button.getAttribute('data-job')); });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.jobEdit'), function (button) {
    button.addEventListener('click', function () { editJob(button.getAttribute('data-job')); });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.jobDelete'), function (button) {
    button.addEventListener('click', function () { deleteJob(button.getAttribute('data-job')); });
  });
}

// 状态时间线：什么时候从什么状态变成什么状态、当时记了什么
function renderJobTimeline(job) {
  const history = job.history || [];
  if (!history.length) return '<div class="muted">还没有跟进记录（改状态或写备注就会追加）。</div>';
  const rows = history.slice(-6).map(function (entry) {
    const from = entry.from ? (jobStatusLabel(entry.from) + ' → ') : '';
    return '<li>' + escapeText(entry.at || '') + '　' + from + escapeText(jobStatusLabel(entry.status))
      + (entry.note ? '　' + escapeText(entry.note) : '') + '</li>';
  }).join('');
  return '<details class="job-timeline"><summary>跟进记录（' + String(history.length) + ' 条）</summary><ul class="pp-plan">' + rows + '</ul></details>';
}

// 待跟进：接口已经在 follow 里算好（与 CLI jobs follow、core 同一份口径）
function renderJobFollowUps() {
  const box = $('jobFollow');
  if (!box) return;
  const follow = jobsState.follow;
  if (!follow) { box.innerHTML = ''; return; }
  const stale = follow.followUps || [];
  if (!follow.waiting) {
    box.innerHTML = '<div class="muted">投递跟进：当前没有在等消息的投递（已投 / 面试中 才需要跟进）。</div>';
    return;
  }
  let html = '<div class="row"><strong>投递跟进</strong><span class="muted">在等消息 ' + String(follow.waiting) + ' 条'
    + (stale.length ? ('，其中 <strong>' + String(stale.length) + ' 条超过 ' + String(follow.staleDays) + ' 天没动静</strong>') : ('（都还在 ' + String(follow.staleDays) + ' 天等待期内）'))
    + '</span></div>';
  if (stale.length) {
    html += '<ul class="pp-plan">' + stale.map(function (row) {
      return '<li>' + escapeText(row.company) + ' · ' + escapeText(row.position) + '（' + String(row.days) + ' 天没动静）　<span class="muted">建议：发一条礼貌的进度询问，然后记一笔</span></li>';
    }).join('') + '</ul>';
  }
  box.innerHTML = html;
}

function jobMessage(text, cls) {
  const box = $('jobMsg');
  if (box) box.innerHTML = '<span class="' + (cls || 'muted') + '">' + escapeText(text) + '</span>';
}

function readJobForm() {
  return {
    id: jobsState.editing || '',
    company: $('jobCompany').value.trim(),
    position: $('jobPosition').value.trim(),
    url: $('jobUrl').value.trim(),
    status: $('jobStatus').value,
    appliedAt: $('jobDate').value,
    note: $('jobNote').value.trim(),
    jd: $('jobJd').value.trim()
  };
}

async function saveJob() {
  jobMessage('保存中…');
  try {
    const payload = await api('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'save', job: readJobForm() })
    });
    jobMessage((payload.created ? '已新增：' : '已更新：') + payload.job.company + ' · ' + payload.job.position);
    jobsState.editing = '';
    await loadJobs();
  } catch (err) {
    jobMessage('保存失败：' + err.message, 'warn-text');
  }
}

function resetJobForm() {
  jobsState.editing = '';
  ['jobCompany', 'jobPosition', 'jobUrl', 'jobNote', 'jobJd', 'jobDate'].forEach(function (id) { if ($(id)) $(id).value = ''; });
  if ($('jobStatus')) $('jobStatus').value = 'todo';
  jobMessage('已清空表单');
}

function editJob(id) {
  const job = jobById(id);
  if (!job) return;
  jobsState.editing = job.id;
  $('jobCompany').value = job.company || '';
  $('jobPosition').value = job.position || '';
  $('jobUrl').value = job.url || '';
  $('jobStatus').value = job.status || 'todo';
  $('jobDate').value = job.appliedAt || '';
  $('jobNote').value = job.note || '';
  $('jobJd').value = job.jd || '';
  jobMessage('正在编辑「' + job.company + ' · ' + job.position + '」——改完点保存');
}

async function deleteJob(id) {
  const job = jobById(id);
  if (!job) return;
  if (!window.confirm('删除这条投递记录？' + String.fromCharCode(10) + job.company + ' · ' + job.position)) return;
  try {
    await api('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: id })
    });
    jobMessage('已删除：' + job.company + ' · ' + job.position);
    if (jobsState.editing === id) jobsState.editing = '';
    await loadJobs();
  } catch (err) {
    jobMessage('删除失败：' + err.message, 'warn-text');
  }
}

async function analyzeJob(id) {
  jobMessage('分析 JD 中…');
  try {
    const payload = await api('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'analyze', id: id })
    });
    jobMessage('分析完成：知识点 ' + String(payload.analysis.points.length) + ' 个 → 可练题 ' + String(payload.analysis.tasks.length) + ' 道');
    await loadJobs();
  } catch (err) {
    jobMessage('分析失败：' + err.message, 'warn-text');
  }
}

function drillJob(id) {
  const job = jobById(id);
  if (!job) return;
  const tasks = (job.analysis && job.analysis.tasks) || [];
  if (!tasks.length) {
    jobMessage('这条还没有可练题：先点「分析 JD」（没存 JD 就把岗位描述粘进去）', 'warn-text');
    return;
  }
  startDrillWith(tasks);
  showPage('learn');
  jobMessage('已按这条 JD 生成开练清单：' + String(tasks.length) + ' 道');
}

async function jobToProject(id) {
  const job = jobById(id);
  if (!job) return;
  const text = job.jd || (job.company + ' ' + job.position);
  const name = (job.company + '-' + job.position).replace(/[\s/]+/g, '-').slice(0, 40);
  jobMessage('正在建项目 ' + name + ' …');
  try {
    const payload = await api('/api/project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name, kind: 'text', text: text })
    });
    const matched = (payload.knowledge || {}).matched || 0;
    jobMessage('已建项目 ' + payload.project + '：知识点 ' + String(matched) + ' 个，草案题 ' + String(payload.tasks || 0) + ' 道——到「项目管理」页看它');
  } catch (err) {
    jobMessage('建项目失败：' + err.message, 'warn-text');
  }
}

function bindJobsPage() {
  if (!$('jobSave')) return;
  $('jobSave').addEventListener('click', saveJob);
  $('jobReset').addEventListener('click', resetJobForm);
  $('jobReload').addEventListener('click', function () { loadJobs(); });
  $('jobFilter').addEventListener('change', function () { loadJobs(); });
  $('jobQuery').addEventListener('input', function () { loadJobs(); });
  // 回车即保存：这个表单是"想到一条就记一条"，不该逼人去点按钮
  ['jobCompany', 'jobPosition', 'jobUrl', 'jobNote'].forEach(function (id) {
    const el = $(id);
    if (el) el.addEventListener('keydown', function (event) { if (event.key === 'Enter') saveJob(); });
  });
}


  bindJobsPage();
  return { loadJobs: loadJobs, renderJobs: renderJobs };
}
