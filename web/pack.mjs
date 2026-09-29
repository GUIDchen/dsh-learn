// 题包面板：建包模板 / 深度校验 / 全库体检。
//
// 这是第一个从 app.mjs 拆出来的"功能性"模块（format.mjs 是纯工具）：
// 依赖用注入方式传进来（api / $ / escapeText），刻意不反向 import app.mjs，避免循环依赖。
export function initPackPanel(deps) {
  const api = deps.api;
  const $ = deps.$;
  const escapeText = deps.escapeText;

  function renderPackCheck(check) {
    const box = $('packBox');
    if (!check) { box.innerHTML = '<div class="warn-text">没有拿到校验结果。</div>'; return; }
    let html = '<div class="' + (check.ok ? 'ok' : 'warn-text') + '">' + (check.ok ? '深度校验通过' : '深度校验失败')
      + '（包 ' + escapeText(check.packId || '?') + '，' + String(check.taskCount) + ' 道题）</div>';
    if ((check.errors || []).length) html += '<ul>' + check.errors.map(function (m) { return '<li>错误：' + escapeText(m) + '</li>'; }).join('') + '</ul>';
    if ((check.warnings || []).length) html += '<ul>' + check.warnings.map(function (m) { return '<li>提醒：' + escapeText(m) + '</li>'; }).join('') + '</ul>';
    box.innerHTML = html;
  }

  async function validateText() {
    const box = $('packBox');
    const raw = ($('packJson') || {}).value || '';
    if (!raw.trim()) { box.innerHTML = '<div class="warn-text">先把题包 JSON 粘到上面的框里，或点「生成模板」。</div>'; return; }
    box.innerHTML = '<div class="muted">校验中…</div>';
    let parsed;
    try { parsed = JSON.parse(raw); } catch (err) { box.innerHTML = '<div class="warn-text">JSON 解析失败：' + escapeText(err.message) + '</div>'; return; }
    try {
      const payload = await api('/api/pack', { method: 'POST', body: JSON.stringify({ action: 'validate', pack: parsed }) });
      renderPackCheck(payload.check);
    } catch (err) {
      box.innerHTML = '<div class="warn-text">校验失败：' + escapeText(err.message) + '</div>';
    }
  }

  async function createTemplate() {
    const box = $('packBox');
    const id = (($('packId') || {}).value || '').trim();
    if (!id) { box.innerHTML = '<div class="warn-text">先填包 id（例如 database-pg）。</div>'; return; }
    box.innerHTML = '<div class="muted">生成中…</div>';
    try {
      const payload = await api('/api/pack', { method: 'POST', body: JSON.stringify({
        action: 'new', id: id, name: ($('packName') || {}).value || '', track: ($('packTrack') || {}).value || '', sample: ($('packSample') || {}).value || ''
      }) });
      if ($('packJson')) $('packJson').value = JSON.stringify(payload.pack, null, 2);
      renderPackCheck(payload.check);
    } catch (err) {
      box.innerHTML = '<div class="warn-text">生成失败：' + escapeText(err.message) + '</div>';
    }
  }

  async function auditAll() {
    const box = $('packBox');
    box.innerHTML = '<div class="muted">全库体检中…（几百道题要算一会儿）</div>';
    try {
      const payload = await api('/api/pack', { method: 'POST', body: JSON.stringify({ action: 'validate-all' }) });
      if (payload.bad) {
        const bad = (payload.rows || []).filter(function (row) { return !row.ok; });
        box.innerHTML = '<div class="warn-text">全库体检：' + String(payload.packs) + ' 个包 / ' + String(payload.tasks) + ' 道题，' + String(payload.bad) + ' 个包有问题</div>'
          + '<ul>' + bad.slice(0, 8).map(function (row) { return '<li>' + escapeText(row.packId || row.file) + '：' + escapeText((row.errors || [])[0] || '') + '</li>'; }).join('') + '</ul>';
      } else {
        box.innerHTML = '<div class="ok">全库体检通过：' + String(payload.packs) + ' 个包 / ' + String(payload.tasks) + ' 道题，0 错误，' + String(payload.warnings) + ' 条提醒</div>';
      }
    } catch (err) {
      box.innerHTML = '<div class="warn-text">全库体检失败：' + escapeText(err.message) + '</div>';
    }
  }

  if ($('packNewBtn')) $('packNewBtn').addEventListener('click', createTemplate);
  if ($('packCheckBtn')) $('packCheckBtn').addEventListener('click', validateText);
  if ($('packAllBtn')) $('packAllBtn').addEventListener('click', auditAll);
}
