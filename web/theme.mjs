// 深色模式：外观偏好存在 home 里（三端共用），这里负责网页侧的应用。
//
// 优先级：localStorage（本机即时选择）→ 服务端偏好（CLI/其它端设的）→ auto（跟随系统）。
// auto 时监听系统切换，所以用户在系统里换外观，页面立刻跟着变。
export function initTheme(deps) {
  const api = deps.api;
  const KEY = 'dsh.theme';
  const root = document.documentElement;
  let current = 'auto';

  function systemDark() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function apply(theme) {
    current = ['auto', 'light', 'dark'].indexOf(theme) > -1 ? theme : 'auto';
    const effective = current === 'auto' ? (systemDark() ? 'dark' : 'light') : current;
    root.setAttribute('data-theme', effective);
    root.setAttribute('data-theme-pref', current);
    root.style.colorScheme = effective;
    const button = document.getElementById('themeToggle');
    if (button) {
      button.textContent = effective === 'dark' ? '深色' : '浅色';
      button.title = '外观：' + (current === 'auto' ? '跟随系统' : current) + '（点击切换）';
    }
    try { localStorage.setItem(KEY, current); } catch (err) { /* 隐私模式 */ }
  }

  function set(theme, options) {
    apply(theme);
    if (options && options.persist === false) return Promise.resolve();
    // api() 是 fetch 的包装（第二参数是 options），所以要显式 POST
    return api('/api/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: theme }) }).catch(function () { return null; });
  }

  // 循环要产生**可见变化**：auto 且系统正好是浅色时，下一次直接给 dark（否则用户点了没反应）
  function cycle() {
    const effective = current === 'auto' ? (systemDark() ? 'dark' : 'light') : current;
    return set(effective === 'dark' ? 'light' : 'dark');
  }

  function mountButton() {
    if (document.getElementById('themeToggle')) return;
    const button = document.createElement('button');
    button.id = 'themeToggle';
    button.type = 'button';
    button.className = 'theme-toggle';
    button.addEventListener('click', function () { cycle(); });
    const bar = document.querySelector('#pageBar, .pagebar, header');
    if (bar) bar.appendChild(button); else document.body.appendChild(button);
    apply(current);
  }

  // 启动顺序：先用本机选择，再问服务端（服务端值只在本机没选过时生效）
  let local = null;
  try { local = localStorage.getItem(KEY); } catch (err) { local = null; }
  apply(local || 'auto');
  if (!local) {
    api('/api/prefs').then(function (payload) {
      const theme = payload && payload.prefs && payload.prefs.theme;
      if (theme) set(theme, { persist: false });
    }).catch(function () { /* 离线就用 auto */ });
  }
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = function () { if (current === 'auto') apply('auto'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
  mountButton();

  return { apply: apply, set: set, cycle: cycle, state: function () { return current; } };
}
