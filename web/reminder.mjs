// 网页版目标提醒条：读 /api/reminder，在页面顶部显示「今天 X / Y 题」与下一步。
// DOM 在 JS 里建（不动 index.html：上一轮那次全页替换的教训）。
export function initReminder(deps) {
  const api = deps.api;
  const escapeText = deps.escapeText;

  async function load() {
    const bar = document.getElementById('reminderBar');
    if (!bar) return;
    try {
      const payload = await api('/api/reminder');
      const result = payload.reminder || {};
      const status = result.status || {};
      const level = result.level || 'none';
      bar.className = 'reminder-bar reminder-' + level;
      let html = '<span>' + escapeText(result.message || '') + '</span>';
      if (status.target) {
        html += '<span class="muted">　今天 ' + status.done + ' / ' + status.target + ' 题</span>';
      }
      if (result.action) {
        html += '<code>' + escapeText('node src/cli.mjs ' + result.action) + '</code>';
      }
      bar.innerHTML = html;
      bar.style.display = '';
    } catch (err) {
      bar.style.display = 'none';
    }
  }

  function mount() {
    if (document.getElementById('reminderBar')) return;
    const bar = document.createElement('div');
    bar.id = 'reminderBar';
    bar.className = 'reminder-bar reminder-none';
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 10px;margin:8px 0;border-radius:8px;'
      + 'background:color-mix(in srgb, currentColor 8%, transparent);font-size:var(--fs-xs);';
    const anchor = document.querySelector('.layout') || document.body;
    anchor.parentNode.insertBefore(bar, anchor);
    load();
  }

  mount();
  return { load: load, mount: mount };
}
