// 网页版的「从这里开始」卡片：内容来自 /api/onboarding（与 CLI、原生同一份 core/onboarding.mjs）。
export function initOnboarding(deps) {
  const api = deps.api;
  const $ = deps.$;
  const escapeText = deps.escapeText;

  async function load() {
    const box = $('onboardingBox');
    if (!box) return;
    try {
      const payload = await api('/api/onboarding');
      const state = payload.state || {};
      if (!state.steps) { box.innerHTML = ''; return; }
      let html = '<div class="muted">已走 ' + String(state.done) + ' / ' + String(state.total) + ' 步（' + String(state.percent) + '%）</div>';
      html += '<ul class="pp-plan">';
      state.steps.forEach(function (row) {
        html += '<li>' + (row.done ? '✅' : '⬜') + ' ' + escapeText(row.title)
          + (row.done ? '' : ('　<code>' + escapeText(row.cli || '') + '</code>')) + '</li>';
      });
      html += '</ul>';
      if (state.next) {
        html += '<div class="ok">' + escapeText(state.next.why || '') + '</div>';
      } else {
        html += '<div class="muted">六步都走过了：可以开始每天练几道、定期备份。</div>';
      }
      box.innerHTML = html;
      const card = box.closest('details');
      if (card) card.open = !state.finished;   // 全部走完就自动收起，不再占地方
    } catch (err) {
      box.innerHTML = '<div class="warn-text">读引导失败：' + escapeText(err.message) + '</div>';
    }
  }

  if ($('onboardingBox')) load();
  return { load: load };
}
