// 项目/仓库的渲染与来源查看（从 web/app.mjs 整块搬出，函数体原样）。
//
// 为什么单独成文件：app.mjs 顶到 2999 行（预算 3000），而这一组「项目结果 / 项目列表 / 来源详情 /
// 草案」是内聚的：它只需要 app 注入 12 个依赖（其余互相调用在组内）。
// 调用方式：initRepo(deps) 返回同一批函数；app.mjs 里通过 repo.xxx 或解构后调用。
import { baseName } from './format.mjs';   // 纯工具（与 app.mjs 同一个来源）

export function initRepo(deps) {
  const $ = deps.$;
  const api = deps.api;
  const escapeText = deps.escapeText;
  const projectName = deps.projectName;
  const loadProjectSources = deps.loadProjectSources;
  const startDrillWith = deps.startDrillWith;
  const openProject = deps.openProject;
  const draftMessage = deps.draftMessage;
  const renderDraftResult = deps.renderDraftResult;
  const loadDrafts = deps.loadDrafts;
  const showPage = deps.showPage;
  const loadProjectPage = deps.loadProjectPage;
  const runProjectDraft = deps.runProjectDraft;
  // ppSelected 是 app.mjs 里的 let（当前选中项目），跨文件要活绑定 -> 注入读写访问器
  const getPpSelected = deps.getPpSelected;
  const setPpSelected = deps.setPpSelected;

function renderProjectResult(payload) {
  const box = $('projectResult');
  if (!box) return;
  let html = '<div class="ok">项目 ' + escapeText(payload.project) + '</div>';
  // 来源方式：复用上次克隆 / 直连 / 走了镜像 / 本地目录——同一份结果，来源不同可信度也不同
  if (payload.via) {
    const viaText = payload.via === 'local' ? '本地目录'
      : payload.via === 'reuse' ? '复用上次的克隆（没重新下载）'
        : payload.via === 'direct' ? '直连 GitHub 克隆'
          : (String(payload.via).indexOf('mirror:') === 0 ? '镜像克隆（' + String(payload.via).slice('mirror:'.length) + '）' : '克隆（' + payload.via + '）');
    html += '<div class="muted">来源方式：' + escapeText(viaText) + (payload.source ? '　' + escapeText(payload.source) : '') + '</div>';
  }
  if (payload.signals && payload.signals.length) {
    html += '<div class="muted">技术信号：' + payload.signals.map(function (row) { return row.id + '（' + row.note + '）'; }).join('、') + '</div>';
  }
  if (payload.knowledge) {
    html += '<div>识别出 ' + payload.knowledge.matched + ' 个知识点，覆盖 ' + payload.knowledge.modules.length + ' 个模块</div>';
    html += '<ul>';
    payload.knowledge.modules.slice(0, 6).forEach(function (mod) {
      html += '<li>' + escapeText(mod.name) + '：' + escapeText(mod.points.join('、')) + '</li>';
    });
    html += '</ul>';
  }
  html += '<div class="muted">草案题 ' + (payload.tasks || 0) + ' 道' + (payload.tasks ? '：先人工改写题面，再跑 node src/cli.mjs pack promote 与 audit' : '（这次没抽到命令示例）') + '</div>';
  if (payload.artifacts && payload.artifacts.length) {
    html += '<div class="muted">写入项目目录：</div><ul>';
    payload.artifacts.forEach(function (rel) { html += '<li><code>' + escapeText(rel) + '</code></li>'; });
    html += '</ul>';
  }
  box.innerHTML = html;
  // 解析完就直接把草案列出来：少一步"再点一次列出草案"
  if (payload.tasks && payload.tasks > 0 && $('draftDetail')) {
    $('draftDetail').innerHTML = '<div class="muted">下面列出了这次生成的草案：先「预览」看复核提醒，再「校验并转正式包」。</div>';
    loadDrafts();
  }
}

// 项目列表：每个项目下方挂一个可折叠的「来源与原文」区域（用户要求：来源贴着项目、折叠放置）

function renderProjectList(payload) {
  const box = $('projectResult');
  if (!box) return;
  const rows = payload.projects || [];
  if (!rows.length) { box.innerHTML = '<div class="muted">还没有项目：填个名字点「建立项目」。</div>'; return; }
  const total = typeof payload.total === 'number' ? payload.total : rows.length;
  const filters = payload.filters || {};
  const note = [];
  if (filters.query) note.push('关键词「' + filters.query + '」');
  if (filters.missingText) note.push('只看缺原文');
  if (filters.sort && filters.sort !== 'updated') note.push('按 ' + filters.sort + ' 排序');
  let html = '<div class="muted">' + (note.length ? ('命中 ' + rows.length + ' / ' + total + ' 个项目（' + note.join('、') + '）') : ('共 ' + total + ' 个项目'))
    + '（点名字看详情；点项目下方的「来源与原文」展开来源）：</div><ul class="pp-tree">';
  rows.forEach(function (row) {
    const hit = (row.match && row.match.length) ? ('　<span class="muted">命中：' + escapeText(Array.from(new Set(row.match)).join('/')) + '</span>') : '';
    const missing = row.missingText ? ('　<span class="tag">缺原文 ' + row.missingText + ' 条</span>') : '';
    const name = escapeText(row.name);
    html += '<li class="pp-item">'
      + '<div class="pp-head"><button class="ghost projectOpen" data-name="' + name + '">'
      + escapeText(row.displayName || row.name) + '</button>'
      + '<span class="muted">　来源 ' + row.sources + ' 个　知识点 ' + (row.knowledge || 0) + '　草案题 ' + (row.tasks || 0) + missing
      + '　更新于 ' + escapeText(String(row.updatedAt || '').replace('T', ' ').slice(0, 19)) + hit + '</span>'
      + '<button class="ghost pp-sources-toggle" data-name="' + name + '" aria-expanded="false">来源与原文（' + row.sources + '）</button></div>'
      + '<div class="pp-sources" data-name="' + name + '" data-loaded="0" hidden></div>'
      + '</li>';
  });
  box.innerHTML = html + '</ul>';
  Array.prototype.forEach.call(box.querySelectorAll('.projectOpen'), function (button) {
    button.addEventListener('click', function () { openProject(button.getAttribute('data-name')); });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.pp-sources-toggle'), function (button) {
    button.addEventListener('click', function () {
      const name = button.getAttribute('data-name');
      const pane = button.closest('.pp-item').querySelector('.pp-sources');
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (open) { pane.hidden = true; return; }
      if (pane.getAttribute('data-loaded') === '1') { pane.hidden = false; return; }
      loadProjectSources(name, pane);
    });
  });
}


// 项目行的三个动作：重命名（改目录名 + 元数据）、删除（删目录，二次确认）、移除（只在本地隐藏，不动磁盘）

function renderSourceDetail(payload, name, index) {
  const box = $('ppSourceText');
  const d = payload.description || {};
  const salary = (d.salary && d.salary.text) ? d.salary.text : '-';
  const fields = [
    ['类型', d.kind === 'jd' ? '岗位描述（JD）' : (d.kind || '文本')],
    ['公司', d.company || '（没解析出来）'],
    ['岗位', d.position || '-'],
    ['经验 / 级别', (d.seniority || '-') + (d.years ? (' / ' + String(d.years) + ' 年') : '')],
    ['学历', d.education || '-'],
    ['城市', (d.location || '-') + (d.remote ? '（可远程）' : '')],
    ['薪资', salary],
    ['发布', d.postedAt || '-']
  ];
  let html = '<div class="muted">项目 ' + escapeText(name) + '　第 ' + String(index) + ' 条　' + escapeText(payload.source || '') + '　原文 ' + String((payload.text || '').length) + ' 字</div>';
  if (payload.cardOnly) {
    html += '<div class="warn-text">这条来源只有列表卡片：详情页没抓到，下面的字段是从卡片本身解析的，职位描述正文不完整。</div>';
  }
  html += '<table class="kv"><tbody>' + fields.map(function (row) {
    return '<tr><th>' + escapeText(row[0]) + '</th><td>' + escapeText(String(row[1])) + '</td></tr>';
  }).join('') + '</tbody></table>';
  if ((d.stack || []).length) html += '<div>技能标签：' + d.stack.slice(0, 20).map(function (x) { return '<span class="tag">' + escapeText(x) + '</span>'; }).join(' ') + '</div>';
  if ((d.points || []).length) {
    html += '<div>命中知识点 ' + String(d.points.length) + ' 个：' + d.points.slice(0, 12).map(function (p) { return '<span class="tag">' + escapeText(p.name || p.id) + '</span>'; }).join(' ') + '</div>';
  }
  if ((d.tasks || []).length) {
    html += '<div class="row"><button class="ghost" id="ppSourceDrill">练这些题（' + String(d.tasks.length) + ' 道）</button></div>';
  }
  html += '<details><summary>原始文本（' + String((payload.text || '').length) + ' 字，岗位描述 / 文档原封不动）</summary>'
    + '<pre class="pp-raw">' + escapeText(payload.text || '') + '</pre></details>';
  box.innerHTML = html;
  if ($('ppSourceDrill')) $('ppSourceDrill').addEventListener('click', function () { startDrillWith(d.tasks || []); showPage('learn'); });
  box.scrollIntoView({ block: 'nearest' });
}


// 草案接口只收文件名（拒绝路径是安全契约）。项目页拿到的是 drafts/xxx.json，这里取最后一段。


// 项目页的小工具：筛选/排序即时生效；回填原文按目录把老来源的原文补回来
if ($('ppFilter')) $('ppFilter').addEventListener('input', function () { if (typeof loadProjectPage === 'function') loadProjectPage(); });
if ($('ppSort')) $('ppSort').addEventListener('change', function () { if (typeof loadProjectPage === 'function') loadProjectPage(); });
if ($('ppSourceFilter')) $('ppSourceFilter').addEventListener('input', function () {
  // 只重渲染已经展开的来源区域（没展开的不去拉数据），筛的是文件名 + 公司/城市/学历/经验
  Array.prototype.forEach.call(document.querySelectorAll('.pp-sources'), function (box) {
    if (!box.hidden && box._sources) renderSourceButtons(box, box.getAttribute('data-name'), box._sources);
  });
});
if ($('ppBackfillBtn')) {
  $('ppBackfillBtn').addEventListener('click', async function () {
    const dir = $('ppBackfillDir') ? $('ppBackfillDir').value.trim() : '';
    $('ppMsg').textContent = '回填中…';
    try {
      const payload = await projectApi({ action: 'backfill', dir: dir });
      const filled = (payload.projects || []).reduce(function (sum, row) { return sum + (row.filled || 0); }, 0);
      $('ppMsg').textContent = '回填完成：补回 ' + String(filled) + ' 条原文（没找到原文件的会如实计为缺失）';
      loadProjectPage();
      if (getPpSelected()) loadProjectSources(getPpSelected());
    } catch (err) {
      $('ppMsg').textContent = '回填失败：' + err.message;
    }
  });
}

function renderSourceButtons(box, name, sources) {
  const filter = ($('ppSourceFilter') ? $('ppSourceFilter').value.trim().toLowerCase() : '');
  const rows = sources.map(function (row, index) { return { row: row, index: index + 1 }; });
  const shown = filter ? rows.filter(function (item) {
    const s = item.row.summary || {};
    const hay = [item.row.source, s.company, s.city, s.education, s.experience, s.position].join(' ').toLowerCase();
    return hay.indexOf(filter) > -1;
  }) : rows;
  if (!sources.length) { box.innerHTML = '<div class="muted">这个项目还没有来源。</div>'; return; }
  let html = '<div class="muted">共 ' + String(sources.length) + ' 条来源' + (filter ? ('（筛出 ' + String(shown.length) + ' 条）') : '') + '　点一条看职位描述：</div>';
  html += shown.map(function (item) {
    const row = item.row;
    const s = row.summary || {};
    const meta = [s.company, s.city, (s.education ? '学历 ' + s.education : ''), s.experience].filter(Boolean).join(' · ');
    return '<button class="ghost ppSource" data-name="' + escapeText(name) + '" data-index="' + String(item.index) + '">'
      + String(item.index) + '. ' + escapeText(row.source || '（无名字）')
      + '<span class="muted">　原文 ' + String(row.chars || 0) + ' 字'
      + (row.cardOnly ? '　<span class="tag">只有列表卡片</span>' : '') + '</span>'
      + (meta ? ('<div class="muted pp-src-meta">' + escapeText(meta) + '</div>') : '')
      + '</button>';
  }).join('');
  box.innerHTML = html;
  Array.prototype.forEach.call(box.querySelectorAll('.ppSource'), function (button) {
    button.addEventListener('click', function () { showSourceText(button.getAttribute('data-name'), button.getAttribute('data-index')); });
  });
}

// 展开某个项目的来源（点项目名时顺带展开，和以前的行为保持一致）

async function openProjectSources(name) {
  const box = document.querySelector('.pp-sources[data-name="' + CSS.escape(name) + '"]');
  if (!box) return;
  const toggle = box.parentElement ? box.parentElement.querySelector('.pp-sources-toggle') : null;
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  if (box.getAttribute('data-loaded') === '1') { box.hidden = false; return; }
  await loadProjectSources(name, box);
}

// 职位描述详情（右侧）：字段表 + 技能标签 + 知识点/可练题 + 原文折叠

function projectApi(body) {
  return api('/api/project', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// 点开一个项目：看它收了哪些来源、各自产出什么文件；顺带提供删除（要二次确认）
// 把一串题号变成「可以开练的建议清单」：分析面板与项目面板共用这一份。
// 存本机（刷新后还能接着练），再让建议面板按这份清单刷新。

function projectMessage(text, cls) {
  const box = $('projectResult');
  if (!box) return;
  box.innerHTML = '<div class="' + (cls || 'muted') + '">' + escapeText(text) + '</div>';
}

async function showSourceText(name, index) {
  const box = $('ppSourceText');
  if (!box) return;
  box.innerHTML = '<div class="muted">正在读取…</div>';
  if ($('ppSourceTitle')) $('ppSourceTitle').textContent = '职位描述详情';
  try {
    const payload = await api('/api/project?name=' + encodeURIComponent(name) + '&source=' + encodeURIComponent(index));
    renderSourceDetail(payload, name, index);
  } catch (err) {
    box.innerHTML = '<div class="warn-text">读取失败：' + escapeText(err.message) + '</div>';
  }
}

function renderProjectDrafts(rows, name) {
  const box = $('ppDraftList');
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = '<div class="muted">这个项目里还没有草案：截图 / 纯文字通常只有知识点，命令示例（链接或仓库）才会出草案。</div>';
    $('ppDraftDetail').innerHTML = '';
    return;
  }
  box.innerHTML = rows.map(function (row) {
    const isPlan = row.kind === 'plan';
    return '<div class="row">'
      + '<code>' + escapeText(row.file) + '</code>　' + String((row.tasks || []).length) + (isPlan ? ' 道可练' : ' 题')
      + (isPlan ? '<span class="badge">计划清单</span>' : '')
      + (row.broken ? '<span class="badge">损坏</span>' : '')
      + (row.inCatalog ? '<span class="badge">已在总题库</span>' : '')
      + (isPlan
        ? '<button class="ghost ppDraftDrill" data-file="' + escapeText(baseName(row.file)) + '">按清单开练</button>'
        : '<button class="ghost ppDraftPreview" data-file="' + escapeText(baseName(row.file)) + '">预览</button>'
          + (row.inCatalog ? '' : '<button class="ghost ppDraftCatalog" data-file="' + escapeText(baseName(row.file)) + '">加入总题库…</button>')
          + '<button class="ghost ppDraftStage" data-file="' + escapeText(baseName(row.file)) + '">暂存到项目</button>')
      + '</div>';
  }).join('');
  $('ppDraftDetail').innerHTML = '';
  Array.prototype.forEach.call(box.querySelectorAll('.ppDraftPreview'), function (button) {
    button.addEventListener('click', function () { runProjectDraft(name, button.getAttribute('data-file'), true, false); });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.ppDraftCatalog'), function (button) {
    button.addEventListener('click', function () { runProjectDraft(name, button.getAttribute('data-file'), true, true); });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.ppDraftStage'), function (button) {
    button.addEventListener('click', function () { runProjectDraft(name, button.getAttribute('data-file'), false, false); });
  });
  // 计划草案不能入总题库（没有新题定义）：按钮改成直接按清单开练
  const planRows = {};
  rows.forEach(function (row) { if (row.kind === 'plan') planRows[baseName(row.file)] = row.planTasks || []; });
  Array.prototype.forEach.call(box.querySelectorAll('.ppDraftDrill'), function (button) {
    button.addEventListener('click', function () {
      const list = planRows[button.getAttribute('data-file')] || [];
      if (!list.length) { $('ppMsg').textContent = '这份计划里没有待练的题。'; return; }
      startDrillWith(list);
      showPage('learn');
    });
  });
}

// 预览或入库一份草案：dryRun=true 先看一遍；catalog=true 是加入总题库（否则只进项目暂存区）

function renderDraftList(payload) {
  const box = $('draftList');
  if (!box) return;
  const rows = payload.drafts || [];
  if (!rows.length) { box.innerHTML = '<div class="muted">这个项目里还没有草案：先收一次仓库或链接（截图/文字通常只有知识点，没有命令示例）。</div>'; return; }
  let html = '<div class="muted">共 ' + rows.length + ' 份草案：</div>';
  rows.forEach(function (row) {
    // 已在总题库的草案直接标出来：不然用户会反复点「加入总题库」，而他早就加过了
    html += '<div class="row"><code>' + escapeText(row.file) + '</code>　' + row.tasks + ' 题'
      + (row.inCatalog ? '<span class="badge">已在总题库</span>' : '')
      + '<button class="ghost draftInspect" data-file="' + escapeText(row.file) + '">预览</button>'
      + (row.inCatalog ? '' : '<button class="ghost draftCatalog" data-file="' + escapeText(row.file) + '">加入总题库…</button>')
      + '<button class="ghost draftPromote" data-file="' + escapeText(row.file) + '">转到项目暂存区</button></div>';
  });
  box.innerHTML = html;
  Array.prototype.forEach.call(box.querySelectorAll('.draftInspect'), function (button) {
    button.addEventListener('click', function () { runDraft(button.getAttribute('data-file'), true); });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.draftPromote'), function (button) {
    button.addEventListener('click', function () { runDraft(button.getAttribute('data-file'), false); });
  });
  // 列表上直接走总题库那一路：先预览，确认按钮由 renderDraftResult 给出
  Array.prototype.forEach.call(box.querySelectorAll('.draftCatalog'), function (button) {
    button.addEventListener('click', function () { runDraft(button.getAttribute('data-file'), true, 'catalog'); });
  });
}

async function runDraft(file, dryRun, scope) {
  const name = projectName();
  if (!name) { draftMessage('先填项目名。'); return; }
  const toCatalog = scope === 'catalog';
  draftMessage(dryRun ? '校验中…' : (toCatalog ? '写入总题库中…' : '转换中…'));
  try {
    const payload = await api('/api/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: name, file: file, dryRun: dryRun, scope: toCatalog ? 'catalog' : 'project' })
    });
    renderDraftResult(payload);
  } catch (err) {
    draftMessage('处理失败：' + err.message, 'bad');
  }
}

  return {
    renderProjectResult: renderProjectResult,
    renderProjectList: renderProjectList,
    renderSourceDetail: renderSourceDetail,
    renderSourceButtons: renderSourceButtons,
    openProjectSources: openProjectSources,
    projectApi: projectApi,
    projectMessage: projectMessage,
    showSourceText: showSourceText,
    renderProjectDrafts: renderProjectDrafts,
    renderDraftList: renderDraftList,
    runDraft: runDraft
  };
}
