// 网页版 i18n：文案表从 /api/i18n 取（core/i18n.mjs 是唯一事实源），断网时保持默认中文。
// 语言偏好与外观偏好同一份（preferences.json）：localStorage 优先，其次服务端，最后默认中文。
export function initI18n(deps) {
  const api = deps.api;
  const KEY = 'dsh.lang';
  const LANGS = ['zh-CN', 'en'];
  let lang = 'zh-CN';
  let messages = {};

  function label(key, fallback) {
    return messages[key] !== undefined ? messages[key] : (fallback || key);
  }

  // 只动「按 id 明确的固定元素」：早前用 data-i18n 全页替换时匹配到了页面脚本里的模板字符串，
  // 直接把学习页渲染打空（任务列表 0 条）。UI 文案的本地化宁可少而准。
  // once=true 的只在首次本地化（内容会被应用逻辑覆盖）；其余每次切语言都重刷
  const ID_KEYS = { onboardingSummary: { key: 'onboarding.title', once: false }, onboardingBox: { key: 'common.loading', once: true } };

  function applyTo(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      if (messages[key] !== undefined) el.textContent = messages[key];
    });
    Object.keys(ID_KEYS).forEach(function (id) {
      const el = document.getElementById(id);
      const row = ID_KEYS[id];
      if (!el || messages[row.key] === undefined) return;
      if (row.once && el.getAttribute('data-i18n-done') === '1') return;
      el.textContent = messages[row.key];
      el.setAttribute('data-i18n-done', '1');
    });
    const button = document.getElementById('langToggle');
    if (button) {
      button.textContent = lang === 'en' ? '中文' : 'English';
      button.title = lang === 'en' ? '切换到中文' : 'Switch to English';
    }
    document.documentElement.setAttribute('data-lang', lang);
  }

  async function set(next, options) {
    const wanted = LANGS.indexOf(next) > -1 ? next : 'zh-CN';
    try {
      const payload = await api('/api/i18n?lang=' + encodeURIComponent(wanted));
      messages = (payload && payload.messages) || {};
      lang = wanted;
    } catch (err) {
      // 断网：只切语言标记，页面文案保持中文（不显示空白）
      lang = wanted;
    }
    try { localStorage.setItem(KEY, lang); } catch (err) { /* 隐私模式 */ }
    applyTo(document);
    if (!(options && options.persist === false)) {
      api('/api/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: lang }) }).catch(function () { return null; });
    }
    return lang;
  }

  function toggle() { return set(lang === 'en' ? 'zh-CN' : 'en'); }

  function mountButton() {
    if (document.getElementById('langToggle')) return;
    const button = document.createElement('button');
    button.id = 'langToggle';
    button.type = 'button';
    button.className = 'theme-toggle';
    button.addEventListener('click', function () { toggle(); });
    const bar = document.querySelector('#pageBar, .pagebar, header');
    if (bar) bar.appendChild(button); else document.body.appendChild(button);
  }

  let local = null;
  try { local = localStorage.getItem(KEY); } catch (err) { local = null; }
  // 语言表要靠请求拿，所以先建按钮再异步应用；拿不到就保持中文
  (async function boot() {
    if (local && LANGS.indexOf(local) > -1) { await set(local, { persist: false }); }
    else {
      try {
        const prefs = await api('/api/prefs');
        const wanted = prefs && prefs.prefs && prefs.prefs.lang;
        await set(wanted && LANGS.indexOf(wanted) > -1 ? wanted : 'zh-CN', { persist: false });
      } catch (err) { await set('zh-CN', { persist: false }); }
    }
    mountButton();
  })();

  return { set: set, toggle: toggle, lang: function () { return lang; }, label: label, applyTo: applyTo };
}
