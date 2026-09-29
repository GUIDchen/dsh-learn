// 网页版命令面板：⌘K / Ctrl+K 打开，↑↓ 选择、Enter 执行、Esc 关闭；⌘1–⌘4 直达页面。
//
// 命令表来自 core/commands.mjs（与原生端、CLI 同一份）。面板 DOM 在 JS 里建，
// 这样 index.html 只需一个挂载点（甚至不需要），改动面最小。
// 离线兜底：接口没回来（或离线）时也能用。这份与 core/commands.mjs 的 id 一致，
// 拉回服务端清单后会整体替换——所以它只是"先能用"，不是第二份事实源。
const FALLBACK = [
  { id: 'page.learn', title: '去学习页', group: '页面', shortcut: '', action: 'page:learn', cli: 'list' },
  { id: 'page.projects', title: '去项目页', group: '页面', shortcut: '', action: 'page:projects', cli: 'project list' },
  { id: 'page.jobs', title: '去投递页', group: '页面', shortcut: '', action: 'page:jobs', cli: 'jobs' },
  { id: 'page.flow', title: '去流程页', group: '页面', shortcut: '', action: 'page:flow', cli: 'flow' },
  { id: 'api.progress', title: '看学习进度', group: '学习', shortcut: '', action: 'api:/api/progress', cli: 'progress' },
  { id: 'api.review', title: '看复习队列', group: '学习', shortcut: '', action: 'api:/api/review', cli: 'review' },
  { id: 'api.mastery', title: '看最弱知识点', group: '学习', shortcut: '', action: 'api:/api/mastery', cli: 'mastery' },
  { id: 'api.onboarding', title: '从这里开始（引导）', group: '引导', shortcut: '', action: 'api:/api/onboarding', cli: 'start' },
  { id: 'api.doctor', title: '数据体检', group: '维护', shortcut: '', action: 'api:/api/doctor', cli: 'doctor' },
  { id: 'api.metrics', title: '运行指标', group: '维护', shortcut: '', action: 'api:/api/metrics', cli: 'metrics' },
  { id: 'api.backup', title: '整机备份', group: '维护', shortcut: '', action: 'api:/api/backup', cli: 'backup' },
  { id: 'api.storage', title: '迁移存储 schema', group: '维护', shortcut: '', action: 'api:/api/storage', cli: 'storage migrate' }
];

export function initPalette(deps) {
  const api = deps.api;
  const goPage = deps.goPage;          // function (name) 切换页面
  const escapeText = deps.escapeText;
  const loadCommands = deps.loadCommands;      // async () => { commands: [...] }（唯一事实源在服务端）
  let commands = deps.commands || FALLBACK;
  // 按关键词过滤（空格分词，任意命中）：离线兜底与服务端清单共用这一套
  const search = deps.search || function (query) {
    const text = String(query || '').trim().toLowerCase();
    if (!text) return commands;
    const words = text.split(/\s+/);
    return commands.filter(function (row) {
      const hay = (row.title + ' ' + row.id + ' ' + row.group).toLowerCase();
      return words.every(function (word) { return hay.indexOf(word) > -1; });
    });
  };

  let overlay = null;
  let input = null;
  let listEl = null;
  let toastEl = null;
  let rows = [];
  let active = 0;

  function build() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'palette';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:none;z-index:9999;'
      + 'align-items:flex-start;justify-content:center;padding-top:12vh;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg,#fff);color:inherit;border-radius:10px;width:min(560px,92vw);'
      + 'box-shadow:0 18px 50px rgba(0,0,0,0.35);overflow:hidden;';
    input = document.createElement('input');
    input.id = 'paletteInput';
    input.placeholder = '输入命令（例如：备份 / 投递 / 复习）';
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:12px 14px;border:0;outline:0;font-size:15px;background:transparent;color:inherit;';
    listEl = document.createElement('div');
    listEl.id = 'paletteList';
    listEl.style.cssText = 'max-height:46vh;overflow:auto;border-top:1px solid rgba(128,128,128,0.25);';
    box.appendChild(input);
    box.appendChild(listEl);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
    input.addEventListener('input', function () { render(input.value); });
    document.body.appendChild(overlay);
    toastEl = document.createElement('div');
    toastEl.id = 'paletteToast';
    toastEl.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(20,20,20,0.92);'
      + 'color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;display:none;z-index:10000;max-width:80vw;';
    document.body.appendChild(toastEl);
  }

  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.style.display = 'block';
    setTimeout(function () { toastEl.style.display = 'none'; }, 3200);
  }

  function render(query) {
    rows = search(query);
    active = 0;
    listEl.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:12px 14px;color:#888;';
      empty.textContent = '没有匹配的命令';
      listEl.appendChild(empty);
      return;
    }
    rows.forEach(function (row, index) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.style.cssText = 'padding:9px 14px;cursor:pointer;display:flex;gap:10px;align-items:center;'
        + (index === active ? 'background:rgba(64,132,255,0.16);' : '');
      const key = document.createElement('span');
      key.style.cssText = 'min-width:2.4em;color:#888;font-size:12px;';
      key.textContent = row.shortcut || '';
      const title = document.createElement('span');
      title.textContent = row.title;
      const cli = document.createElement('span');
      cli.style.cssText = 'margin-left:auto;color:#888;font-size:12px;';
      cli.textContent = 'node src/cli.mjs ' + row.cli;
      item.appendChild(key);
      item.appendChild(title);
      item.appendChild(cli);
      item.addEventListener('mousemove', function () { active = index; paint(); });
      item.addEventListener('click', function () { run(row); });
      listEl.appendChild(item);
    });
  }

  function paint() {
    const items = listEl.querySelectorAll('.palette-item');
    items.forEach(function (item, index) {
      item.style.background = index === active ? 'rgba(64,132,255,0.16)' : 'transparent';
    });
  }

  async function run(row) {
    if (!row) return;
    close();
    if (row.action.indexOf('page:') === 0) {
      goPage(row.action.slice(5));
      toast('已切到：' + row.title);
      return;
    }
    const path = row.action.slice(4);
    try {
      const payload = await api(path);
      let detail = '完成';
      if (payload) {
        if (payload.summary) detail = '请求 ' + payload.summary.http.requests + ' 次 / 错误 ' + payload.summary.http.errors;
        else if (payload.state) detail = '已走 ' + payload.state.done + ' / ' + payload.state.total + ' 步';
        else if (payload.fileCount !== undefined) detail = '备份 ' + payload.fileCount + ' 个文件';
        else if (payload.stats) detail = '发现 ' + payload.stats.total + ' 项';
        else if (payload.error) detail = String(payload.error);
      }
      toast(row.title + '：' + detail);
      if (deps.onAfter) deps.onAfter(row, payload);
    } catch (err) {
      toast(row.title + ' 失败：' + err.message);
    }
  }

  async function refreshCommands() {
    if (!loadCommands) return;
    try {
      const payload = await loadCommands();
      if (payload && payload.commands && payload.commands.length) commands = payload.commands;
    } catch (err) { /* 拉不到就用兜底那份，面板本身不该因此打不开 */ }
  }

  function open() {
    build();
    refreshCommands().then(function () { if (overlay && overlay.style.display === 'flex') render(input.value); });
    overlay.style.display = 'flex';
    input.value = '';
    render('');
    input.focus();
  }

  function close() {
    if (overlay) overlay.style.display = 'none';
  }

  document.addEventListener('keydown', function (event) {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && String(event.key).toLowerCase() === 'k') {
      event.preventDefault();
      if (overlay && overlay.style.display === 'flex') close(); else open();
      return;
    }
    if (overlay && overlay.style.display === 'flex') {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(rows.length - 1, active + 1); paint(); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, active - 1); paint(); return; }
      if (event.key === 'Enter') { event.preventDefault(); run(rows[active]); return; }
      return;
    }
    if (meta && ['1', '2', '3', '4'].indexOf(String(event.key)) > -1) {
      const page = ['learn', 'projects', 'jobs', 'flow'][Number(event.key) - 1];
      event.preventDefault();
      goPage(page);
      toast('已切到：' + page);
    }
  });

  return { open: open, close: close, toast: toast, run: run, render: render };
}
