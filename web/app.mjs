// 纯格式化工具已搬到 web/format.mjs（浏览器原生 ESM，不需要打包器）
import { initRepo } from './repo.mjs';
import { baseName, escapeText, levelText } from './format.mjs';
import { initPackPanel } from './pack.mjs';
import { initJobsPanel } from './jobs.mjs';
import { initPanels } from './panels.mjs';
import { initOnboarding } from './onboarding.mjs';
import { initPalette } from './palette.mjs';
import { initTheme } from './theme.mjs';
import { initI18n } from './i18n.mjs';
import { initTrend } from './trend.mjs';
import { initReminder } from './reminder.mjs';
// 网页版的可执行部分。markup 与样式留在 index.html，逻辑放这里，便于单独做语法检查与复用。
// 判定内核来自 /core/judge.mjs（服务端同一份代码），断网时本地判分。
// 判定内核直接来自服务端的 core/judge.mjs（同一份代码）：在线时用服务端判，断网时本地判。
let localJudgeModule = null;
try {
  localJudgeModule = await import('/core/judge.mjs');
} catch (err) {
  localJudgeModule = null;
}

// passScore / partialScore 由服务端下发（与 judge.mjs 同一处定义），页面不再写死 100
const state = { tasks: [], platform: 'darwin', track: 'all', level: 'all', levelLabels: {}, listLimit: 60, taskId: '', byTask: {}, online: navigator.onLine, search: '', status: 'all', streak: 0, passScore: 100, partialScore: 60 };
const $ = function (id) { return document.getElementById(id); };
// 学习页面板已拆到 web/panels.mjs。初始化必须早于任何引用它的**顶层语句**
// （如 $("drillMode").addEventListener(..., panels.loadDrill)），但又必须在 $ 与 state 之后；
// 顺序错了会因暂时性死区直接抛错，模块后续代码全不执行（实测整页空白、0 道题）。
// 命令面板（⌘K / Ctrl+K）：命令表从 /api/commands 拉，唯一事实源在 core/commands.mjs，网页版不存第二份
const theme = initTheme({ api: api }); const i18n = initI18n({ api: api }); const trend = initTrend({ api: api, escapeText: escapeText }); const reminderBox = initReminder({ api: api, escapeText: escapeText });
const palette = initPalette({ api: api, escapeText: escapeText, goPage: function (name) { showPage(name); }, loadCommands: function () { return api('/api/commands'); } });
const onboarding = initOnboarding({ api: api, $: $, escapeText: escapeText });
const panels = initPanels({
  api: api, $: $, escapeText: escapeText, state: state,
  post: post, clientId: clientId, bootstrap: bootstrap, refreshAll: refreshAll,
  renderTaskList: renderTaskList, goToTask: goToTask, bar: bar, percentText: percentText
});

// 服务端在发送这个文件时把 __VERSION__ 换成真实版本号（见 src/web/static.mjs）。
// 直接打开文件时占位符还在，那就跳过所有版本比对，不做任何自作聪明的事。
const SCRIPT_VERSION = '__VERSION__';
const QUEUE_KEY = 'dsh-learn-offline-queue';
const VERIFY_CACHE_KEY = 'dsh-learn-verify-cache';

function clientId() {
  let id = localStorage.getItem('dsh-learn-client');
  if (!id) {
    id = 'web-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('dsh-learn-client', id);
  }
  return id;
}


function option(value, label, selected) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  if (selected) opt.selected = true;
  return opt;
}

// 在线状态只有这一处判定：请求成功就算在线，失败（含 Service Worker 离线时回的 503）就算离线。
// 之前只在 offline 事件里翻转，导致服务端挂了但顶部徽标还显示"在线"。
function markOffline() {
  if (state.online) {
    state.online = false;
    renderNetBadge();
  }
}
function markOnline() {
  if (!state.online) {
    state.online = true;
    renderNetBadge();
  }
}

async function api(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (err) {
    markOffline();
    throw err;
  }
  if (!res.ok) {
    // 4xx 是"这次请求本身不被接受"（比如在不适用的平台上提交判定），不是断网——
    // 之前一律 markOffline，一次业务拒绝就把整个界面切成离线态。
    // 服务端把原因写在 error 字段里，原样带给调用方。
    if (res.status >= 500) markOffline();
    let body = null;
    try { body = await res.json(); } catch (err) { body = null; }
    const err = new Error((body && body.error) || ('HTTP ' + res.status));
    if (body && body.platformUnsupported) err.platformUnsupported = true;
    throw err;
  }
  markOnline();
  return res.json();
}

function post(path, body) {
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function bar(percent, width) {
  const size = width || 16;
  const filled = Math.max(0, Math.min(size, Math.round((percent || 0) / 100 * size)));
  return '[' + '#'.repeat(filled) + '.'.repeat(size - filled) + ']';
}

// 完成度文案：与 core/progress.mjs 的 percentText 同一口径（浏览器不能直接 import 它，
// 因为它是 Node 侧模块）。587 道题里通过几道时取整会显示 0%，做过事却像没做。
function percentText(passed, total, rounded) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safePassed = Number(passed) || 0;
  const value = typeof rounded === 'number' ? rounded : Math.round(safePassed / safeTotal * 100);
  if (value === 0 && safePassed > 0) return (Math.round(safePassed / safeTotal * 1000) / 10) + '%';
  return value + '%';
}

// ---------------- 离线队列 ----------------
function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (err) { return []; }
}
function writeQueue(rows) { localStorage.setItem(QUEUE_KEY, JSON.stringify(rows)); }
function enqueue(record) {
  const rows = readQueue();
  rows.push(record);
  writeQueue(rows);
  renderNetBadge();
  // 排队那一刻就挂上重试：用户看到的是「恢复网络后自动并入进度」，那就要真的自动
  syncOfflineQueueSoon();
}
async function flushQueue() {
  const rows = readQueue();
  if (!rows.length) return 0;
  try {
    await post('/api/import', { records: rows });
    // 队列一变就重画：徽标、待同步面板、立即同步按钮都读队列。
    // 之前只在调用方 render，而 online 事件是"先画再清"，于是同步成功后页面上仍挂着「待同步 N 条」。
    writeQueue([]);
    renderNetBadge();
    return rows.length;
  } catch (err) {
    return 0;
  }
}

// ---------------- 只读验证结果缓存 ----------------
// 离线时不能执行命令（白名单执行只在服务端），但可以把上一次的结果和该跑的命令给出来。
function readVerifyCache() {
  try { return JSON.parse(localStorage.getItem(VERIFY_CACHE_KEY) || '{}'); } catch (err) { return {}; }
}
function cacheVerify(key, verify) {
  const all = readVerifyCache();
  all[key] = {
    at: new Date().toISOString(),
    ok: Boolean(verify.ok),
    ran: Boolean(verify.ran),
    cmd: verify.cmd,
    runner: verify.runner,
    output: (verify.output || '').slice(0, 800),
    reason: verify.reason
  };
  localStorage.setItem(VERIFY_CACHE_KEY, JSON.stringify(all));
}
function renderVerifyOffline(task, key) {
  const cached = readVerifyCache()[key];
  let html = '<div class="muted">离线：只读验证需要在服务端执行（白名单执行器不在浏览器里）。下面给出该题要跑的命令，你可以在自己的终端手动执行。</div>';
  if (task && task.verify) {
    html += '<pre>' + escapeText('命令：' + task.verify.cmd + '\n期望输出匹配：' + task.verify.expect
      + (task.verify.note ? '\n说明：' + task.verify.note : '')) + '</pre>';
  } else {
    html += '<div class="muted">这道题没有绑定可执行验证项。</div>';
  }
  if (cached) {
    html += '<pre>' + escapeText('上次验证（' + String(cached.at).replace('T', ' ').slice(0, 19) + '，' + (cached.runner || 'local') + '）：'
      + (cached.ok ? '通过' : '未通过') + '\n' + cached.reason + (cached.output ? '\n输出：\n' + cached.output : '')) + '</pre>';
  } else {
    html += '<div class="muted">本机还没有这道题的验证记录，联网后点一次"只读验证"就会缓存下来。</div>';
  }
  $('result').innerHTML = html;
}

function renderNetBadge() {
  const pending = readQueue().length;
  const offline = !state.online;
  const badge = $('netBadge');
  badge.className = 'badge' + (offline ? ' off' : '');
  badge.textContent = offline ? ('离线 · 本地判定' + (pending ? '（待同步 ' + pending + ' 条）' : ''))
    : (pending ? '在线（待同步 ' + pending + ' 条）' : '在线');
  $('submitHint').textContent = offline ? '断网中：本次判定在本机完成，恢复网络后自动同步' : '';
  $('verifyBtn').title = offline ? '离线时展示上次验证结果与该跑的命令' : '在服务端执行只读验证';
  // 有待同步记录时才亮出"立即同步"：平时不占地方，忙的时候能一键推上去
  const sync = $('syncNow');
  if (sync) {
    sync.hidden = pending === 0;
    sync.textContent = pending ? '立即同步（' + pending + ' 条）' : '立即同步';
  }
  renderPendingBox();
}

// 排队中的判定：时间、题号、分数一目了然，并说明它们还没进进度
function renderPendingBox() {
  const box = $('pendingBox');
  if (!box) return;
  const rows = readQueue();
  if (!rows.length) { box.innerHTML = ''; return; }
  let html = '<div class="muted">待同步 ' + rows.length + ' 条（离线判定已完成，恢复网络后自动并入进度）：</div><div class="scroll-x"><table><thead><tr>'
    + '<th>时间</th><th>题目</th><th>判定</th><th>分数</th></tr></thead><tbody>';
  rows.slice(-8).reverse().forEach(function (row) {
    html += '<tr><td>' + escapeText(String(row.at || '').replace('T', ' ').slice(5, 16)) + '</td><td>'
      + escapeText(row.taskId || '') + '</td><td>' + escapeText(row.verdict || '') + '</td><td>'
      + escapeText(String(row.score == null ? '' : row.score)) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  if (rows.length > 8) html += '<div class="muted">只列出最近 8 条</div>';
  box.innerHTML = html;
}

// 手点同步就真的去试一次：不先看在线标志位。
// 浏览器没触发 online 事件、或只有服务端起来过，"标志位说不通但网络其实通了"很常见，试一下才作数。
// 函数名别和按钮的 id（syncNow）重名：id 会在 window 上生成同名全局，读代码时容易误判
async function flushQueueNow() {
  if (!readQueue().length) return;
  const synced = await flushQueue();
  if (synced) {
    state.online = true;
    $('submitHint').textContent = '已同步 ' + synced + ' 条离线判定。';
    renderNetBadge();
    refreshAll();
    return;
  }
  $('submitHint').textContent = state.online
    ? '同步失败：服务端没接受这批记录，稍后再试。'
    : '当前还是离线：记录先留在本机，网络恢复后自动同步。';
  renderNetBadge();
  if (!state.online) syncOfflineQueueSoon();
}

// 离线时自己重试：浏览器的 online 事件只在**系统网络状态**变化时触发——
// 服务端重启、只有本机到服务端的路断了、换个网络其实早通了，都不会有事件。
// 界面上写着「恢复网络后自动并入进度」，那就得真的去试，而不是等用户点「立即同步」。
// 实测：服务端恢复后 22 秒内页面毫无反应，徽标一直挂着「待同步 1 条」。
// 间隔 12 秒是个权衡：本地服务端一秒就回来，但也没必要每秒打一次。
const OFFLINE_RETRY_MS = 12000;
let offlineRetryTimer = null;

function stopOfflineRetry() {
  if (offlineRetryTimer) {
    clearInterval(offlineRetryTimer);
    offlineRetryTimer = null;
  }
}

function syncOfflineQueueSoon() {
  if (offlineRetryTimer) return;
  if (!readQueue().length) return;
  offlineRetryTimer = setInterval(function () {
    if (state.online && !readQueue().length) { stopOfflineRetry(); return; }
    flushQueueNow();
  }, OFFLINE_RETRY_MS);
}

// ---------------- 启动 ----------------
// 题库也缓存一份到本机：bootstrap 里带着完整判定规则，断网重开页面照样能练，
// 而不是只剩一个空壳（判定内核由 Service Worker 缓存，两边合起来才算真正可离线）。
const BOOTSTRAP_KEY = 'dsh-learn-bootstrap-cache';
let bootstrapCacheAt = null; // 非空表示这次页面用的是缓存题库（离线重开）
let offlinePlatformMismatch = null; // 非空表示「离线时想切平台，但缓存里只有另一个平台的一份」
function readBootstrapCache() {
  try {
    const raw = localStorage.getItem(BOOTSTRAP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) { return null; }
}

async function bootstrap() {
  const platform = $('platform').value || undefined;
  const startedAt = performance.now();
  let fetchedAt = startedAt;
  let data;
  try {
    data = await api('/api/bootstrap' + (platform ? '?platform=' + encodeURIComponent(platform) : ''));
    fetchedAt = performance.now();
    // 联网成功：把上一次离线留下的两个提示都撤掉。
    // （之前只清了一半——恢复网络后 envline 还挂着「题库来自缓存的备份」这种过期说法）
    offlinePlatformMismatch = null;
    bootstrapCacheAt = null;
    try { localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify({ at: new Date().toISOString(), platform: platform || null, data: data })); } catch (err) { /* 隐私模式下写不了就算了 */ }
  } catch (err) {
    const cached = readBootstrapCache();
    if (!cached || !cached.data) throw err;
    data = cached.data;
    bootstrapCacheAt = cached.at;
    // 离线时缓存里只有一份平台的题库。请求的平台和它不一致就必须说清楚并把下拉拨回去——
    // 否则下拉显示 Windows、题目与判定规则却全是 macOS 的，用户会以为「切了平台没生效」，
    // 更糟的是用错平台的规则本地判分。
    if (platform && data.platform && platform !== data.platform) {
      offlinePlatformMismatch = { want: platform, have: data.platform };
      const select = $('platform');
      if (select) select.value = data.platform;
    }
  }
  state.platform = data.platform;
  state.tasks = data.tasks;

  state.levelLabels = data.levelLabels || {};
  const platformSelect = $('platform');
  if (!platformSelect.options.length) {
    data.platforms.forEach(function (item) { platformSelect.appendChild(option(item.id, item.name, item.id === data.platform)); });
    $('clientId').value = clientId();
  }

  const trackList = $('trackList');
  trackList.innerHTML = '';
  const tracks = ['all'].concat(data.tracks);
  tracks.forEach(function (name) {
    const button = document.createElement('button');
    button.setAttribute('data-track', name);
    button.className = state.track === name ? 'active' : '';
    button.setAttribute('aria-pressed', String(state.track === name));
    button.addEventListener('click', function () { state.track = name; state.listLimit = 60; renderTracks(); renderTaskList(); });
    trackList.appendChild(button);
  });

  const profile = data.profile;
  $('envline').textContent = (data.appVersion ? '版本 ' + data.appVersion + '　' : '') + '服务端 ' + data.serverPlatform + '　评测平台 ' + profile.name + '　工具链 ' + profile.tools
    + '　Docker ' + profile.dockerRuntime
    + (bootstrapCacheAt ? '　（离线：题库来自 ' + String(bootstrapCacheAt).slice(0, 19).replace('T', ' ') + ' 的缓存）' : '')
    + (offlinePlatformMismatch ? '　（离线：缓存里只有 ' + offlinePlatformMismatch.have + ' 平台的题库，已切回；要练 ' + offlinePlatformMismatch.want + ' 需先连上服务端）' : '');
  renderTracks();
  renderTaskList();
  // 首屏耗时留个可查的记录：每轮实测都拿它对比，避免"感觉变慢了"却拿不出数字。
  // 只在 window 上挂一个调试对象，不显示给用户，也不上报。
  window.__dshPerf = {
    appVersion: data.appVersion || null,
    tasks: state.tasks.length,
    bootstrapMs: Math.round(fetchedAt - startedAt),
    firstListMs: Math.round(performance.now() - startedAt)
  };
  restoreTaskView();
  syncServiceWorker(data.appVersion);
}

// 版本变了就主动问一次 Service Worker：浏览器对 SW 脚本的更新检查会节流，
// 结果可能是"服务端已经 0.45.0、页面还在跑 0.44.0 的外壳"，而页头版本号会一直显示新版本，看不出问题。
// 每次版本变化只问一次（记在本机），平时不多一次请求。
const SEEN_VERSION_KEY = 'dsh-learn-seen-version';
const RELOADED_KEY = 'dsh-learn-shell-reloaded';

// 外壳版本对不上时：让 Service Worker 立刻更新，并**重载一次**把新外壳用上。
// 只重载一次（拿版本号当闸门），否则 SW 迟迟不换时页面会不停刷新。
async function syncServiceWorker(appVersion) {
  if (!appVersion || !('serviceWorker' in navigator)) return;
  const staleShell = SCRIPT_VERSION !== '__VERSION__' && SCRIPT_VERSION !== appVersion;
  let seen = '';
  let reloaded = '';
  try {
    seen = localStorage.getItem(SEEN_VERSION_KEY) || '';
    reloaded = sessionStorage.getItem(RELOADED_KEY) || '';
  } catch (err) { /* 隐私模式 */ }
  if (!staleShell && seen === appVersion) return;
  try {
    localStorage.setItem(SEEN_VERSION_KEY, appVersion);
    sessionStorage.setItem(RELOADED_KEY, appVersion);
  } catch (err) { /* 同上 */ }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
    window.__dshSw = { updatedAt: new Date().toISOString(), from: seen, to: appVersion, scriptVersion: SCRIPT_VERSION, staleShell: staleShell };
  } catch (err) { /* 更新失败不影响本次使用 */ }
  if (staleShell && reloaded !== appVersion) {
    // 这次跑的是旧外壳（多半是 SW 缓存里的那份）：换上新外壳再继续
    console.log('页面外壳是 ' + SCRIPT_VERSION + '，服务端已是 ' + appVersion + '，重载一次取新外壳');
    location.reload();
    return;
  }
  if (staleShell) {
    // 重载过了还是旧的：说明 SW 没换掉，别再来回刷，直接把话说清楚
    const hint = document.getElementById('submitHint');
    if (hint) hint.textContent = '页面外壳仍是 ' + SCRIPT_VERSION + '（服务端 ' + appVersion + '）：按 ⌘⇧R / Ctrl+Shift+R 强制刷新即可。';
  }
}

// 轨道按钮直接带上「通过/总数」：一眼看出哪块该补，不用来回切筛选
function renderTracks() {
  const counts = {};
  state.tasks.forEach(function (task) {
    const row = counts[task.track] || { total: 0, passed: 0 };
    row.total += 1;
    if ((state.byTask[task.id] || {}).best >= state.passScore) row.passed += 1;
    counts[task.track] = row;
  });
  const all = state.tasks.reduce(function (sum, task) {
    return { total: sum.total + 1, passed: sum.passed + ((state.byTask[task.id] || {}).best >= state.passScore ? 1 : 0) };
  }, { total: 0, passed: 0 });

  Array.prototype.forEach.call($('trackList').children, function (button) {
    const name = button.getAttribute('data-track');
    const row = name === 'all' ? all : (counts[name] || { total: 0, passed: 0 });
    const label = (name === 'all' ? '全部' : name) + ' ' + row.passed + '/' + row.total;
    button.textContent = label;
    button.title = name === 'all'
      ? ('全部轨道：已满分 ' + row.passed + ' / ' + row.total)
      : (name + '：已满分 ' + row.passed + ' / ' + row.total);
    const active = state.track === name;
    button.className = active ? 'active' : '';
    button.setAttribute('aria-pressed', String(active));
  });
  renderTrackDrill();
}

// 选中某个模块后，给一条"整模块开练"的入口：直接按权重排出该模块的练习队列并跳到第一题
function renderTrackDrill() {
  let row = $('trackDrillRow');
  if (!row) {
    row = document.createElement('div');
    row.id = 'trackDrillRow';
    row.className = 'row';
    const trackList = $('trackList');
    trackList.parentNode.insertBefore(row, trackList.nextSibling);
  }
  if (state.track === 'all') {
    row.innerHTML = '<span class="muted">选一个模块（例如 docker / python）就能整模块开练</span>';
    return;
  }
  const total = state.tasks.filter(function (task) { return task.track === state.track; }).length;
  const passed = state.tasks.filter(function (task) {
    return task.track === state.track && (state.byTask[task.id] || {}).best >= state.passScore;
  }).length;
  row.innerHTML = '<button class="ghost" id="trackDrillBtn">练 ' + escapeText(state.track) + ' 这个模块（' + passed + '/' + total + ' 已满分）</button>';
  const button = $('trackDrillBtn');
  if (button) {
    button.addEventListener('click', function () {
      // 复用"今日建议"面板：模式设成全量，条数给足，再跳到第一题
      $('drillMode').value = 'all';
      $('drillLimit').value = '10';
      panels.loadDrill().then(function () {
        const first = $('drill').querySelector('.drillGo');
        if (first) goToTask(first.getAttribute('data-id'));
      });
    });
  }
}

function matchesStatus(taskId) {
  const row = state.byTask[taskId];
  if (state.status === 'all') return true;
  if (state.status === 'new') return !row;
  if (state.status === 'passed') return Boolean(row) && row.best >= state.passScore;
  if (state.status === 'failed') return Boolean(row) && row.best < state.passScore;
  return true;
}

function matchesSearch(task) {
  if (!state.search) return true;
  const needle = state.search.toLowerCase();
  return task.id.toLowerCase().indexOf(needle) > -1
    || task.title.toLowerCase().indexOf(needle) > -1
    || (task.goal || '').toLowerCase().indexOf(needle) > -1;
}

function visibleTasks() {
  return state.tasks.filter(function (task) {
    return (state.track === 'all' || task.track === state.track)
      && (state.level === 'all' || task.level === state.level)
      && matchesStatus(task.id)
      && matchesSearch(task);
  });
}

// 难度标签：列表项与结果区都用它，避免"这题到底难在哪"没有提示
function levelTag(level) {
  if (!level) return '';
  const label = (state.levelLabels && state.levelLabels[level]) || level;
  return '<span class="tag level-' + escapeText(level) + '">' + escapeText(label) + '</span>';
}

// 键盘上下切题：在当前筛选结果里移动，不改变筛选条件
function moveSelection(step) {
  const list = visibleTasks();
  if (!list.length) return;
  const index = list.findIndex(function (task) { return task.id === state.taskId; });
  const next = index < 0 ? 0 : Math.max(0, Math.min(list.length - 1, index + step));
  goToTask(list[next].id);
}


// 提示：只给思路（题库里每道题都带 hint），不显示参考答案。
// 再点一次收起，并且切题时自动收起——免得上一题的提示留在屏幕上看错。
function toggleHint() {
  const box = $('taskHint');
  const button = $('hintBtn');
  if (!box || !button) return;
  const open = box.hidden === false;
  if (open) {
    box.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    return;
  }
  const task = currentTask();
  if (!task) return;
  const hint = String(task.hint || '').trim();
  box.textContent = hint ? ('提示：' + hint) : '这道题没有提示，先看题目目标和「只读验证」那一行。';
  box.hidden = false;
  button.setAttribute('aria-expanded', 'true');
}

if ($('hintBtn')) $('hintBtn').addEventListener('click', toggleHint);

function statusOf(taskId) {
  const row = state.byTask[taskId];
  if (!row) return { cls: 'dot-none', text: '未练习' };
  if (row.best >= state.passScore) return { cls: 'dot-ok', text: '已满分' };
  return { cls: 'dot-mid', text: '最高 ' + row.best + ' 分' };
}

const LIST_PAGE = 60; // 一次渲染多少题：题库已经 200+，全量铺开会让左栏又长又重

function renderTaskList() {
  const list = visibleTasks();
  const total = state.tasks.filter(function (task) { return state.track === 'all' || task.track === state.track; }).length;
  const shown = Math.min(list.length, state.listLimit);
  const countText = list.length === total ? '共 ' + total + ' 题' : '筛出 ' + list.length + ' / ' + total + ' 题';
  $('taskCount').textContent = list.length > shown
    ? countText + '　显示前 ' + shown + ' 题'
    : countText;

  const box = $('taskList');
  box.innerHTML = '';
  // 筛到空是很容易发生的事（比如"轨道 netops + 困难 + 搜索词"三条叠加）。
  // 空列表本身不解释原因，也不给出路——这里直接说明当前条件并给一个重置按钮。
  if (!list.length) {
    const why = [];
    if (state.track !== 'all') why.push('轨道 ' + state.track);
    if (state.level !== 'all') why.push('难度 ' + (state.levelLabels[state.level] || state.level));
    if (state.search) why.push('搜索「' + state.search + '」');
    const box2 = document.createElement('div');
    box2.className = 'muted';
    box2.id = 'taskListEmpty';
    box2.innerHTML = '当前筛选（' + escapeText(why.join(' · ') || '全部') + '）没有匹配的题。';
    const reset = document.createElement('button');
    reset.className = 'ghost';
    reset.id = 'resetFilters';
    reset.textContent = '重置筛选';
    reset.addEventListener('click', resetAllFilters);
    box2.appendChild(document.createElement('br'));
    box2.appendChild(reset);
    box.appendChild(box2);
    return;
  }
  if (!list.some(function (task) { return task.id === state.taskId; })) {
    state.taskId = list[0].id;
  }
  list.slice(0, shown).forEach(function (task) {
    const status = statusOf(task.id);
    const button = document.createElement('button');
    const isActive = task.id === state.taskId;
    button.className = 'task-item' + (isActive ? ' active' : '');
    button.setAttribute('data-task-id', task.id);
    // 选中项用 aria-current 标出来：屏幕阅读器切题时才知道"现在在哪道题上"
    if (isActive) button.setAttribute('aria-current', 'true');
    // 圆点是装饰：状态同一行文字里已经写了（已满分 / 最高 N 分 / 未练习），读屏不必再念一遍
    // 平台不适用的题（windows 轨在 macOS 上、launchctl 在 Windows 上等）：在列表里就标出来，
    // 别等点进去提交了才发现不给判分。文字进 aria-label，读屏也念得到。
    const only = task.supported === false && task.taskPlatforms ? task.taskPlatforms.join('/') : '';
    button.innerHTML = '<span class="' + status.cls + '" aria-hidden="true">●</span> ' + levelTag(task.level) + escapeText(task.title)
      + '<span class="st">' + escapeText(task.track) + ' · ' + status.text + (only ? ' · 仅限 ' + escapeText(only) : '') + '</span>';
    if (only) button.setAttribute('aria-label', task.title + '（仅限 ' + only + '，当前平台不判分）');
    button.addEventListener('click', function () { goToTask(task.id); });
    box.appendChild(button);
  });

  if (list.length > shown) {
    const more = document.createElement('button');
    more.className = 'ghost more-btn';
    more.textContent = '显示更多（还有 ' + (list.length - shown) + ' 题）';
    more.addEventListener('click', function () {
      state.listLimit = state.listLimit + LIST_PAGE;
      renderTaskList();
    });
    box.appendChild(more);
  }
  renderCurrentTask();
}

// 把选中的题滚进视野。这里**只滚左栏自己的滚动容器**：
// scrollIntoView 会连带把整个页面也滚下去——实测（CDP 打点）首屏加载时它让页面滚了 475px，
// 页面标题与环境行（版本/平台/工具链）直接被顶出视口，用户看到的是"页面从控件行开始"。
// 单栏模式（≤700）左栏没有自己的滚动条，那时才回退到 scrollIntoView。
function scrollTaskIntoView(active) {
  const scroller = active.closest('.col-left');
  const scrollable = scroller && scroller.scrollHeight > scroller.clientHeight + 1 && getComputedStyle(scroller).overflowY !== 'visible';
  if (!scrollable) {
    // 单栏/两栏堆叠模式：左栏没有自己的滚动条，只能滚页面——但**只在该行真的看不见时才滚**。
    // 否则首屏渲染选中的那一行（在视口内）也会触发一次滚动，把页面标题顶出去。
    const row = active.getBoundingClientRect();
    const visible = row.top >= 0 && row.bottom <= window.innerHeight;
    if (!visible && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    return;
  }
  const box = scroller.getBoundingClientRect();
  const item = active.getBoundingClientRect();
  if (item.top < box.top) scroller.scrollTop += item.top - box.top;
  else if (item.bottom > box.bottom) scroller.scrollTop += item.bottom - box.bottom;
}

// 键盘切题可能切到还没渲染出来的题：先把窗口撑到能涵盖它，再渲染
function ensureTaskVisible(taskId) {
  const list = visibleTasks();
  const index = list.findIndex(function (task) { return task.id === taskId; });
  if (index > -1 && index >= state.listLimit) {
    state.listLimit = Math.ceil((index + 1) / LIST_PAGE) * LIST_PAGE;
  }
}

function currentTask() {
  return state.tasks.filter(function (item) { return item.id === state.taskId; })[0];
}

// 题目声明了 platforms（launchctl、pkgutil/dpkg、bash 版本差异）时，当前平台拿不到它的判定：
// 兜底规则可能是本平台根本不存在的命令（Windows 上判 launchctl），所以宁可不判、把话说清楚。
function platformUnsupportedText(task) {
  const only = (task && task.taskPlatforms) || [];
  return '这道题只在 ' + only.join(' / ') + ' 上有参考答案，当前平台（' + state.platform + '）不适用：'
    + '换平台再练，或看"其他平台写法"对比着记';
}

function renderCurrentTask() {
  const task = currentTask();
  $('taskTitle').textContent = task ? task.title : '选择左侧的一道题';
  $('taskGoal').textContent = task ? '目标：' + task.goal : '';
  // 变体题：把"同一条命令在别的平台怎么写"直接摆出来（对比着看比记规则有用）
  const box = $('taskVariants');
  if (box) {
    const others = (task && task.others) || null;
    const platforms = others ? Object.keys(others) : [];
    const parts = [];
    // 题目声明了 platforms（launchctl、pkgutil/dpkg、bash 版本差异）：当前平台不覆盖它。
    // 判定照常给分（走兜底规则），但必须说出来——不然学员会以为自己的写法错了。
    if (task && task.supported === false && task.taskPlatforms) {
      parts.push(platformUnsupportedText(task));
    }
    if (platforms.length) {
      parts.push('其他平台写法：' + platforms.map(function (p) { return p + ' → ' + others[p]; }).join('　'));
    }
    box.textContent = parts.join('\n');
  }
}

// 切到某一题。options.scroll === false 用于**首屏恢复**：那时用户还没做任何选择，
// 不该替他滚动页面（实测过：把选中的题滚进视野会连带把页面滚掉几百像素，标题与环境行被顶出视口）。
function goToTask(taskId, options) {
  // 换题就收起提示：避免上一题的提示留着误导
  if ($('taskHint')) { $('taskHint').hidden = true; if ($('hintBtn')) $('hintBtn').setAttribute('aria-expanded', 'false'); }
  const scroll = !options || options.scroll !== false;
  const task = state.tasks.filter(function (item) { return item.id === taskId; })[0];
  if (!task) return;
  if (state.track !== 'all' && state.track !== task.track) {
    state.track = 'all';
    renderTracks();
  }
  state.taskId = taskId;
  setTaskHash(taskId); // 地址里带上题号：这一题可以直接发给别人
  ensureTaskVisible(taskId); // 目标题可能在第 N 页，先撑开窗口再渲染
  renderTaskList();
  if (scroll) {
    const active = document.querySelector('#taskList .task-item.active');
    if (active) scrollTaskIntoView(active);
  }
  $('result').innerHTML = '';
  panels.loadNote();
  // 历史是按当前题过滤的：切题就得跟着换，否则看到的是上一题的记录
  panels.loadHistory();
  // preventScroll：这里是"点完题顺手把光标放进输入框"，不该顺带把页面滚下去——
  // 实测（CDP 量几何）首屏加载时它会滚掉 44px，把页面标题与环境行顶出视口。
  $('answer').focus({ preventScroll: true });
}

// ---------------- 判定 ----------------
function localJudge(answer) {
  const task = currentTask();
  if (!task) return null;
  if (!localJudgeModule || !task.rules) return null;
  const pseudo = { id: task.id, require: task.rules.require, forbid: task.rules.forbid };
  return localJudgeModule.judge(pseudo, answer, state.platform);
}

// 一键回到"全部轨道 / 全部难度 / 全部状态 / 无搜索"：键盘 0 与空列表里的重置按钮共用
function resetAllFilters() {
  ['#trackList [data-track="all"]', '#levelFilter [data-level="all"]', '#statusFilter [data-status="all"]'].forEach(function (selector) {
    const button = document.querySelector(selector);
    if (button) button.click();
  });
  const search = $('taskSearch');
  if (search) { search.value = ''; state.search = ''; }
  state.listLimit = 60;
  renderTaskList();
}

// 一句话播报：屏幕阅读器只需要知道"过了没有、多少分、有没有刷新记录、还缺几项"
function announce(text) {
  const box = $('verdictLive');
  if (box) box.textContent = text;
}

// 判定结果出来后把焦点交给结果区：点完"提交"焦点原本掉回 <body>，
// 键盘用户要重新 Tab 十几次才到"下一题"，读屏也只会念到页面开头。
// 结果区已有 role=region + aria-label，补一个 tabindex=-1 就能被程序聚焦（不进入 Tab 顺序）。
function focusResult() {
  const box = $('result');
  if (box && typeof box.focus === 'function') box.focus();
}

function verdictSummary(result, isRecord) {
  return '判定：' + result.verdict + '，' + result.score + ' 分'
    + (isRecord ? '，本次为历史最好' : '')
    + (result.missing.length ? '，还缺 ' + result.missing.length + ' 项' : '，要素齐全');
}

function renderLocalResult(result, task) {
  const platformLine = state.platform ? '<div class="muted">按 <span class="tag">' + escapeText(state.platform) + '</span> 平台判定</div>' : '';
  let html = '<div class="ok">判定：' + escapeText(result.verdict) + '（' + result.score + ' 分）</div>' + platformLine
    + '<div>' + escapeText(result.tips) + '</div>';
  html += matchedHtml(result);
  html += progressHtml(result.score);
  if (result.missing.length) {
    html += '<ul>';
    result.missing.forEach(function (item) { html += '<li>缺：' + escapeText(item) + '</li>'; });
    result.notes.forEach(function (item) { html += '<li>问题：' + escapeText(item) + '</li>'; });
    html += '</ul>';
  }
  // 满分时前面已经写过"关键要素齐全"和"已命中 N / N"，再来一行"得分 100：命中 N/N"就是复读
  if (result.scoring && result.score < 100) html += '<div class="muted">' + escapeText(result.scoring) + '</div>';
  if (!result.pass && task) html += '<pre>' + escapeText('提示：' + task.hint + '\n参考：' + task.sample) + '</pre>';
  html += nextStepHtml();
  html += '<div class="muted">离线判定：用的是服务端同一份 judge.mjs，恢复网络后会把这次记录同步上去。</div>';
  $('result').innerHTML = html;
  announce(verdictSummary(result, isRecordScore(result.score)));
  focusResult();
}

// 判定之前的成绩快照：用来在结果里给出"这次比上次"的对比
let scoreBefore = null;

async function submitAnswer() {
  const answer = $('answer').value;
  const task = currentTask();
  if (!task) return;
  // 不适用的平台不判分：本地兜底规则与远端判定都会给出"用一条本平台没有的命令"的错答案
  if (task.supported === false) {
    $('result').innerHTML = '<div class="muted">' + escapeText(platformUnsupportedText(task)) + '</div>';
    return;
  }
  // 本地先记一份：离线判定时用它；在线判定以服务端返回的 previousBest/attempts 为准
  const previous = state.byTask[task.id] || null;
  scoreBefore = previous ? { best: previous.best || 0, attempts: previous.attempts || 0, lastVerdict: previous.lastVerdict || '' } : { best: 0, attempts: 0, lastVerdict: '' };
  if (!state.online) {
    const local = localJudge(answer);
    if (!local) {
      $('result').innerHTML = '<div class="muted">离线且判定内核未缓存，请先联网打开一次页面。</div>';
      return;
    }
    renderLocalResult(local, task);
    enqueue({ client: $('clientId').value || clientId(), taskId: task.id, score: local.score, verdict: local.verdict, platform: state.platform, answer: local.answer, at: new Date().toISOString() });
    state.byTask[task.id] = { best: Math.max((state.byTask[task.id] || {}).best || 0, local.score), attempts: ((state.byTask[task.id] || {}).attempts || 0) + 1, lastVerdict: local.verdict };
    renderTaskList();
    return;
  }
  try {
    const payload = await post('/api/check', {
      taskId: state.taskId,
      answer: answer,
      platform: $('platform').value,
      clientId: $('clientId').value || clientId(),
      // 勾选后才让服务端真跑一遍（只读白名单内；不在白名单会如实回报"未运行"）
      run: Boolean($('runAnswer') && $('runAnswer').checked)
    });
    renderServerResult(payload);
  } catch (err) {
    // 平台不适用：服务端明确拒绝，不要退化成"本地兜底判一份"（那正是要避免的错答案）
    if (err.platformUnsupported) {
      $('result').innerHTML = '<div class="muted">' + escapeText(err.message) + '</div>';
      return;
    }
    const local = localJudge(answer);
    if (local) {
      renderLocalResult(local, task);
      enqueue({ client: $('clientId').value || clientId(), taskId: task.id, score: local.score, verdict: local.verdict, platform: state.platform, answer: local.answer, at: new Date().toISOString() });
    } else {
      $('result').innerHTML = '<div class="muted">判定失败：' + escapeText(err.message) + '</div>';
    }
  }
}

// 已命中要素用标签展示：让学员先看到"写对了什么"，再看还差什么
// 这次成绩与历史对比：让学员看到"有没有进步"，而不是只有一个孤零零的分数
// 刷新记录（含第一次）：给一个明确的徽标，而不是让人自己拿两个数字比大小。
// 播报与徽标共用这一个判断，避免"看到的"和"听到的"不一致。
function isRecordScore(score) {
  if (!scoreBefore) return false;
  return scoreBefore.attempts === 0 || score > scoreBefore.best;
}

function progressHtml(score) {
  if (!scoreBefore) return '';
  const parts = [];
  const isRecord = isRecordScore(score);
  const badge = isRecord ? '<span class="tag best">本次为历史最好</span>' : '';
  if (scoreBefore.attempts === 0) {
    parts.push('这是第一次练这道题');
  } else {
    const delta = score - scoreBefore.best;
    parts.push('上次最好 ' + scoreBefore.best + ' 分'
      // 说清这是"相对上次最好"的差，而不是本次得分（命令行口径：比上次最好 ±N）
      + (delta > 0 ? '　比上次最好 +' + delta + ' 分' : (delta < 0 ? '　比上次最好 ' + delta + ' 分' : '　与上次最好持平')));
    if (score >= state.passScore && scoreBefore.best < state.passScore) parts.push('首次满分 🎉');
    parts.push('累计第 ' + (scoreBefore.attempts + 1) + ' 次练习');
  }
  return '<div class="muted">' + badge + escapeText(parts.join('　')) + '</div>';
}

// 判定结果里的下一步动作：直接接着练下一题，不用回到左栏去找
function nextStepHtml() {
  const list = visibleTasks();
  const index = list.findIndex(function (task) { return task.id === state.taskId; });
  const hasNext = index > -1 && index < list.length - 1;
  return '<div class="row"><button class="ghost nextTaskBtn"' + (hasNext ? '' : ' disabled') + '>下一题 →</button>'
    + '<span class="muted">' + (hasNext ? '也可以按 ↓ / j 直接切题' : '已经是这个筛选下的最后一题') + '</span></div>';
}

// 已命中的片段做成可点标签：点一下把它从输入里删掉，再判定就能看到分数怎么变——
// 这比"看一眼自己写对了什么"更进一步：可以直接做减法实验，理解每个要素的权重。
function matchedHtml(result) {
  if (!result.matched || !result.matched.length) return '';
  const total = result.required || result.matched.length;
  // 用列表语义包起来：读屏会把命中的片段逐项念出来（原来并排的按钮会被连成一片无分隔文本），
  // 同时保留"点一下从输入里移除"的交互
  return '<div class="muted">已命中 ' + result.matched.length + ' / ' + total + '：'
    + '<span role="list" aria-label="已命中 ' + result.matched.length + ' 项">'
    + result.matched.map(function (item) {
      return '<button role="listitem" class="tag matched-chip" data-snippet="' + escapeText(item) + '"'
        + ' title="点一下从输入里移除，再判定看看分数怎么变" aria-label="已命中：' + escapeText(item) + '，点击可从输入中移除">'
        + escapeText(item) + '</button>';
    }).join('')
    + '</span></div>';
}

// 把某个片段从答案里移除（只移除第一处），然后聚焦回输入框
function removeSnippetFromAnswer(snippet) {
  const box = $('answer');
  const current = box.value;
  const at = current.indexOf(snippet);
  if (at === -1) return false;
  box.value = (current.slice(0, at) + current.slice(at + snippet.length)).replace(/\s{2,}/g, ' ').trim();
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.focus();
  return true;
}

// 执行型判定的结果：跑了/没跑都要说清，跑了就贴真实输出
function renderExecution(payload) {
  const exec = payload && payload.execution;
  if (!exec) return '';
  if (!exec.allowed) return '<div class="warn-text">未实际执行：' + escapeText(exec.reason || '不在只读白名单内') + '</div>';
  if (!exec.ran) return '<div class="warn-text">未实际执行：' + escapeText(exec.reason || '未运行') + '</div>';
  const lines = String(exec.output || '').split(String.fromCharCode(10)).filter(function (row) { return row.trim(); });
  return '<div class="muted">实际执行：退出码 ' + String(exec.exitCode === undefined ? '?' : exec.exitCode)
    + (exec.ok ? '' : ('　' + escapeText(exec.reason || '')))
    + '</div><pre class="exec-out">' + escapeText(lines.slice(0, 12).join(String.fromCharCode(10))) + '</pre>';
}

function renderServerResult(payload) {
  const r = payload.result;
  // 服务端算好的历史对比优先（它读的是权威进度，不受客户端快照过期影响）
  if (typeof payload.attempts === 'number') {
    scoreBefore = { best: typeof payload.previousBest === 'number' ? payload.previousBest : 0, attempts: payload.attempts - 1, lastVerdict: '' };
  }
  // 变体题在不同平台口径不同：把"按哪个平台判的"写出来，避免"我的写法明明对"的困惑
  const platformLine = state.platform ? '<div class="muted">按 <span class="tag">' + escapeText(state.platform) + '</span> 平台判定</div>' : '';
  let html = '<div class="ok">判定：' + escapeText(r.verdict) + '（' + r.score + ' 分）</div>' + platformLine
    + '<div>' + escapeText(r.tips) + '</div>';
  html += matchedHtml(r);
  html += progressHtml(r.score);
  if (r.missing.length || r.notes.length) {
    html += '<ul>';
    r.missing.forEach(function (item) { html += '<li>缺：' + escapeText(item) + '</li>'; });
    r.notes.forEach(function (item) { html += '<li>问题：' + escapeText(item) + '</li>'; });
    html += '</ul>';
  }
  // 满分时不复读：上面已有"关键要素齐全"与"已命中 N / N"
  if (r.scoring && r.score < 100) html += '<div class="muted">' + escapeText(r.scoring) + '</div>';
  if (!r.pass && payload.task) html += '<pre>' + escapeText('提示：' + payload.task.hint + '\n参考：' + payload.task.sample) + '</pre>';
  html += renderExecution(payload);
  html += nextStepHtml();
  $('result').innerHTML = html;
  announce(verdictSummary(r, isRecordScore(r.score)) + '。下一个动作：' + (r.pass ? '可以继续下一题' : '看提示或点下面的下一题'));
  focusResult();
  panels.renderBoard(payload.board);
  // 提交后把"会随记录变化"的面板一起刷新：进度、建议、复习队列、目标、历史
  panels.loadProgress();
  panels.loadHistory();
  panels.loadDrill();
  panels.loadReview();
  panels.loadGoal();
}

function escapeHtml(text) { return escapeText(text); }

function renderAnalyze(payload) {
  if (!payload || payload.ok === false) {
    $('analyzeResult').innerHTML = '<div class="muted">分析失败：' + escapeHtml((payload && payload.reason) || '未知原因') + '</div>';
    return;
  }
  const report = payload.report;
  let html = '<div class="ok">' + escapeHtml(payload.summaryText) + '</div>';
  if (payload.note) html += '<div class="muted">' + escapeHtml(payload.note) + '</div>';
  if (!report.matched) {
    html += '<div class="muted">没有识别出知识点。把岗位要求的整段文字贴进来（或者换一张更清晰的截图）再试。</div>';
    $('analyzeResult').innerHTML = html;
    return;
  }
  report.modules.forEach(function (mod) {
    html += '<div class="row" style="margin:6px 0 0"><strong>' + escapeHtml(mod.name) + '</strong>'
      + '<span class="muted">' + mod.points.length + ' 个知识点' + (mod.tasks.length ? '　可练 ' + mod.tasks.length + ' 题' : '　（题库暂未覆盖）') + '</span></div>';
    html += '<ul>';
    mod.points.forEach(function (point) {
      html += '<li>' + escapeHtml(point.name) + '　<span class="muted">' + escapeHtml(point.level) + '</span>'
        + (point.tasks.length ? '<br><span class="muted">对应题目：' + escapeHtml(point.tasks.join('、')) + '</span>' : '<br><span class="muted">暂无对应题目</span>')
        + '</li>';
    });
    html += '</ul>';
  });
  if (report.unmatchedLines.length) {
    html += '<div class="muted">字典没覆盖到的要求行（' + report.unmatchedLines.length + ' 条）：' + escapeHtml(report.unmatchedLines.slice(0, 3).map(function (line) { return line.slice(0, 40); }).join(' / ')) + '</div>';
  }
  if (report.tasks.length) {
    const passed = report.tasks.filter(function (row) { return (state.byTask[row.taskId] || {}).best >= (state.passScore || 100); }).length;
    html += '<div class="muted">清单里已有 ' + passed + ' / ' + report.tasks.length + ' 题满分。</div>';
    html += '<div class="row"><button class="primary" id="analyzeTrainBtn">按这份内容开始训练（' + report.tasks.length + ' 题）</button>'
      + '<button class="ghost" id="analyzeCopyBtn">复制训练命令</button>'
      + '<span class="muted">训练清单会出现在上面的"今日建议"里，点"练这题"即可开始</span></div>';
  }
  $('analyzeResult').innerHTML = html;
  const copyBtn = $('analyzeCopyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      const ids = report.tasks.map(function (row) { return row.taskId; }).join(',');
      const command = 'node src/cli.mjs drill --tasks=' + ids;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(command).then(function () { copyBtn.textContent = '已复制'; }, function () { copyBtn.textContent = '复制失败：' + command.slice(0, 20); });
      } else {
        copyBtn.textContent = command;
      }
    });
  }
  const trainBtn = $('analyzeTrainBtn');
  if (trainBtn) {
    trainBtn.addEventListener('click', function () {
      startDrillWith(report.tasks.map(function (row) { return row.taskId; }));
    });
  }
}

// 优先走服务端（能抓链接、能 OCR 截图）；纯文本在离线时用缓存的 knowledge.mjs 本机分析
async function analyzeInput(body) {
  try {
    return await api('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    if (!body.text) throw err;
    const knowledge = await panels.loadKnowledge();
    const report = knowledge.analyzeText(body.text, { limit: 20 });
    return { ok: true, source: 'offline', note: '离线：用的是本机的知识点字典，结果与联网时一致。', summaryText: knowledge.summarizeAnalysis(report), report: report };
  }
}

function analyzeFileAsText(file) {
  const reader = new FileReader();
  reader.onload = async function () {
    $('analyzeText').value = String(reader.result || '').slice(0, 20000);
    renderAnalyze(await analyzeInput({ text: $('analyzeText').value }));
  };
  reader.readAsText(file);
}

function analyzeFileAsImage(file) {
  const reader = new FileReader();
  reader.onload = async function () {
    $('analyzeResult').innerHTML = '<div class="muted">正在本机识别截图文字…</div>';
    renderAnalyze(await analyzeInput({ image: String(reader.result || '') }));
  };
  reader.readAsDataURL(file);
}

$('analyzeBtn').addEventListener('click', async function () {
  const text = $('analyzeText').value.trim();
  if (!text) { $('analyzeResult').innerHTML = '<div class="muted">先把岗位描述或文档正文粘进来。</div>'; return; }
  renderAnalyze(await analyzeInput({ text: text }));
});
$('analyzeUrlBtn').addEventListener('click', async function () {
  const url = $('analyzeUrl').value.trim();
  if (!url) { $('analyzeResult').innerHTML = '<div class="muted">先填一个 http(s) 链接。岗位站点多半要登录，抓不到时请把 JD 文字粘进文本框。</div>'; return; }
  $('analyzeResult').innerHTML = '<div class="muted">正在抓取链接正文…</div>';
  renderAnalyze(await analyzeInput({ url: url }));
});
$('analyzeFile').addEventListener('change', function () { const file = this.files && this.files[0]; if (file) analyzeFileAsText(file); });
$('analyzeImage').addEventListener('change', function () { const file = this.files && this.files[0]; if (file) analyzeFileAsImage(file); });
$('drillMode').addEventListener('change', panels.loadDrill);
$('drillLimit').addEventListener('change', panels.loadDrill);
$('historyBtn').addEventListener('click', panels.loadHistory);
$('historyMine').addEventListener('change', panels.loadHistory);
$('historyResult').addEventListener('change', function () {
  // 记住筛选偏好：刷新页面后不用再选一次
  try { localStorage.setItem('dsh-learn-history-filter', $('historyResult').value); } catch (err) { /* 隐私模式 */ }
  panels.loadHistory();
});
// 事件委托：历史表格随筛选重绘，逐行绑事件会随重绘一起丢
$('history').addEventListener('click', function (event) {
  const button = event.target && event.target.closest ? event.target.closest('.cmd-refill') : null;
  if (button) panels.refillFromHistory(Number(button.getAttribute('data-index')));
});
$('boardBtn').addEventListener('click', panels.loadBoard);
$('checkBtn').addEventListener('click', submitAnswer);
$('hintBtn').addEventListener('click', function () {
  const task = currentTask();
  if (task) $('result').innerHTML = '<pre>' + escapeText('提示：' + task.hint + '\n需要命中的要素：\n- ' + task.require.join('\n- ')) + '</pre>';
});
$('sampleBtn').addEventListener('click', function () {
  const task = currentTask();
  if (task) $('result').innerHTML = '<pre>' + escapeText('参考答案：' + task.sample) + '</pre>';
});
$('runner').addEventListener('change', function () { $('remoteRow').hidden = $('runner').value !== 'remote'; });
$('verifyBtn').addEventListener('click', async function () {
  const runner = $('runner').value;
  const task = currentTask();
  const cacheKey = state.taskId + '|' + state.platform + '|' + runner;
  if (!state.online) {
    renderVerifyOffline(task, cacheKey);
    return;
  }
  if (!confirm('将执行该题的只读验证命令（后端：' + runner + '），确定继续？')) return;
  try {
    const payload = await post('/api/verify', {
      taskId: state.taskId, platform: $('platform').value, runner: runner,
      endpoint: $('endpoint').value || undefined, token: $('token').value || undefined, run: true
    });
    cacheVerify(cacheKey, payload.verify);
    panels.renderVerify(payload);
  } catch (err) {
    renderVerifyOffline(task, cacheKey);
  }
});
$('probeBtn').addEventListener('click', async function () {
  try {
    panels.renderVerify(await post('/api/probe', { run: true }));
  } catch (err) {
    $('result').innerHTML = '<div class="muted">离线：环境探测需要连接服务端</div>';
  }
});
$('planBtn').addEventListener('click', async function () {
  try {
    panels.renderPlan((await post('/api/plan', { platform: $('platform').value, track: state.track, hoursPerDay: Number($('hours').value) || 2 })).plan);
  } catch (err) {
    $('plan').innerHTML = '<div class="muted">离线：计划需要连接服务端</div>';
  }
});
$('exportBtn').addEventListener('click', async function () {
  try {
    const data = await api('/api/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'dsh-learn-progress.json';
    link.click();
  } catch (err) {
    $('result').innerHTML = '<div class="muted">离线：导出需要连接服务端</div>';
  }
});
$('importFile').addEventListener('change', async function (event) {
  const file = event.target.files[0];
  if (!file) return;
  // 结果写在页面上而不是弹窗：弹窗会挡住整个界面，读屏也只能念一句话，还没有留痕
  const say = function (text) {
    const hint = $('submitHint');
    if (hint) hint.textContent = text;
    announce(text);
  };
  try {
    const payload = JSON.parse(await file.text());
    const data = await post('/api/import', payload);
    panels.renderBoard(data.board);
    panels.loadProgress();
    say('导入完成：新增 ' + data.import.added + ' 条，跳过重复 ' + data.import.skipped + ' 条');
  } catch (err) {
    // 413 这类错误要给出可执行的话：说的是"文件太大，拆分导入"而不是干巴巴的状态码
    say('导入失败：' + err.message + (/413|过大/.test(String(err.message)) ? '（备份文件太大，先拆成几份再导入）' : ''));
  }
});

document.addEventListener('keydown', function (event) {
  const typing = ['INPUT', 'TEXTAREA'].indexOf(event.target.tagName) > -1;
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    $('checkBtn').click();
    return;
  }
  if (typing) {
    // Esc 退出输入：搜索框顺手清空，其它输入框只失焦
    if (event.key === 'Escape') {
      const box = event.target;
      if (box.id === 'taskSearch') {
        box.value = '';
        state.search = '';
        state.listLimit = 60;
        renderTaskList();
      }
      box.blur();
      event.preventDefault();
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  // 1-4 切难度、0 清掉所有筛选：不想摸鼠标时，筛题也不该只能点按钮
  if (['1', '2', '3', '4'].indexOf(event.key) > -1) {
    const target = ['all', 'easy', 'medium', 'hard'][Number(event.key) - 1];
    const button = document.querySelector('#levelFilter [data-level="' + target + '"]');
    if (button) { button.click(); button.focus(); }
    event.preventDefault();
    return;
  }
  if (event.key === '0') {
    resetAllFilters();
    event.preventDefault();
    return;
  }
  if (event.key === 'h') $('hintBtn').click();
  else if (event.key === 'a') $('sampleBtn').click();
  else if (event.key === 'r') { panels.loadProgress(); panels.loadDrill(); panels.loadDaily(); panels.loadReview(); panels.loadGoal(); }
  else if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1); }
  else if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1); }
  else if (event.key === '/') { event.preventDefault(); $('taskSearch').focus(); }
});

window.addEventListener('online', async function () {
  state.online = true;
  renderNetBadge();
  const synced = await flushQueue();
  if (synced) console.log('已同步 ' + synced + ' 条离线记录');
  refreshAll();
});
window.addEventListener('offline', function () { state.online = false; renderNetBadge(); });

function refreshAll() {
  panels.loadProgress();
  panels.loadDrill();
  panels.loadDaily();
  panels.loadReview();
  panels.loadGoal();
  panels.loadHistory();
  panels.loadBoard();
}

Array.prototype.forEach.call(($('levelFilter') || { children: [] }).children, function (button) {
  button.addEventListener('click', function () {
    state.level = button.getAttribute('data-level');
    state.listLimit = 60;
    Array.prototype.forEach.call($('levelFilter').children, function (other) {
      other.className = other === button ? 'active' : '';
      other.setAttribute('aria-pressed', String(other === button));
    });
    renderTaskList();
  });
});
if ($('syncNow')) $('syncNow').addEventListener('click', flushQueueNow);
$('taskSearch').addEventListener('input', function () {
  state.search = $('taskSearch').value.trim();
  state.listLimit = 60; // 换筛选条件就回到第一屏，避免"筛完还显示 200 条"
  renderTaskList();
});
Array.prototype.forEach.call($('statusFilter').children, function (button) {
  button.addEventListener('click', function () {
    state.status = button.getAttribute('data-status');
    state.listLimit = 60;
    Array.prototype.forEach.call($('statusFilter').children, function (other) {
      other.className = other === button ? 'active' : '';
      other.setAttribute('aria-pressed', String(other === button));
    });
    renderTaskList();
  });
});
$('reportBtn').addEventListener('click', async function () {
  try {
    const res = await fetch('/api/report');
    const markdown = await res.text();
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'dsh-learn-report.md';
    link.click();
  } catch (err) {
    $('result').innerHTML = '<div class="muted">离线：报告需要连接服务端</div>';
  }
});

// 折叠面板：panes 里有 h2 的都自动变成可折叠（标题行留一个 ▾ 按钮），状态记在本机。
// 这样"题目列表 / 复习队列 / 学习计划"这类长面板可以收起来，把注意力留给当前那题。
const COLLAPSE_KEY = 'dsh-learn-collapsed';
const COLLAPSED_BY_DEFAULT = ['今日复习（间隔重复）', '学习计划', '多客户端排行榜', '进度导入导出', '我的笔记'];

function readCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch (err) { return {}; }
}
function writeCollapsed(map) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(map)); } catch (err) { /* 隐私模式忽略 */ }
}

function initCollapsiblePanes() {
  const saved = readCollapsed();
  Array.prototype.forEach.call(document.querySelectorAll('.pane'), function (pane, index) {
    const head = pane.querySelector('h2');
    if (!head || pane.querySelector('.pane-head')) return;
    const title = head.textContent.trim();
    const key = title || ('pane-' + index);

    // 把 h2 之后的所有节点收进 body，标题留在外面
    const body = document.createElement('div');
    body.className = 'pane-body';
    const nodes = [];
    let node = head.nextSibling;
    while (node) { const next = node.nextSibling; nodes.push(node); node = next; }
    nodes.forEach(function (item) { body.appendChild(item); });

    const wrap = document.createElement('div');
    wrap.className = 'pane-head';
    pane.insertBefore(wrap, head);
    wrap.appendChild(head);

    const button = document.createElement('button');
    button.className = 'collapseBtn';
    button.type = 'button';
    button.setAttribute('aria-controls', '');
    wrap.appendChild(button);
    pane.appendChild(body);
    body.id = 'pane-body-' + index;
    button.setAttribute('aria-controls', body.id);

    const collapsed = saved[key] !== undefined ? saved[key] : (COLLAPSED_BY_DEFAULT.indexOf(title) > -1);
    applyPaneCollapsed(pane, button, key, collapsed);

    button.addEventListener('click', function () {
      const nowCollapsed = !pane.classList.contains('collapsed');
      applyPaneCollapsed(pane, button, key, nowCollapsed);
      const map = readCollapsed();
      map[key] = nowCollapsed;
      writeCollapsed(map);
    });
  });
}

function applyPaneCollapsed(pane, button, key, collapsed) {
  pane.classList.toggle('collapsed', collapsed);
  button.textContent = collapsed ? '展开 ▸' : '收起 ▾';
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', (collapsed ? '展开：' : '收起：') + key);
}

initCollapsiblePanes();

// 结果区的「下一题」按钮：接一个委托，避免每次渲染都重新绑定
document.getElementById('result').addEventListener('click', function (event) {
  if (!event.target || !event.target.closest) return;
  const next = event.target.closest('.nextTaskBtn');
  if (next && !next.disabled) {
    moveSelection(1);
    return;
  }
  const chip = event.target.closest('.matched-chip');
  if (chip) {
    const removed = removeSnippetFromAnswer(chip.getAttribute('data-snippet'));
    chip.textContent = removed ? (chip.getAttribute('data-snippet') + '（已移除）') : chip.getAttribute('data-snippet');
    chip.classList.toggle('removed', removed);
    chip.title = removed ? '已经从这个答案里删掉了：再点一次不会重复删，重新提交判定即可看到分数变化' : '这段写法没在输入里找到（可能被合并短选项改写过）';
  }
});

renderNetBadge();
// 上次分析出来的训练清单：刷新页面后仍然有效（本机存储）
try {
  const saved = JSON.parse(localStorage.getItem('dsh-learn-analysis-tasks') || '[]');
  if (Array.isArray(saved) && saved.length) state.analyzeTasks = saved.filter(function (id) { return typeof id === 'string'; });
} catch (err) { /* 忽略坏数据 */ }
try {
  const filter = localStorage.getItem('dsh-learn-history-filter');
  if (filter && $('historyResult')) $('historyResult').value = filter;
} catch (err) { /* 忽略 */ }
bootstrap().then(refreshAll);
flushQueue().then(function (n) {
  if (n) { panels.loadProgress(); panels.loadBoard(); }
  renderNetBadge();
  // 重开页面时队列里还有东西（离线时攒下的）：继续自己重试，不用等人点按钮
  if (readQueue().length) syncOfflineQueueSoon();
});

if ('serviceWorker' in navigator) {
  // 不能只挂在 load 上：脚本执行晚于 load 时（实测发生过）监听器永远不会触发，
  // 离线外壳与 PWA 安装就会静默失效。已经 complete 就立刻注册。
  const registerShell = function () {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
      // 不再静默吞掉：注册失败意味着离线判定链路不可用，必须留下痕迹
      console.warn('service worker 注册失败，离线外壳不可用：' + err.message);
    });
  };
  if (document.readyState === 'complete') registerShell();
  else window.addEventListener('load', registerShell);
}

// ---------------- 项目 / 仓库 ----------------
function projectName() {
  const value = ($('projectName') || {}).value || '';
  return value.trim();
}


function hiddenProjects() {
  try { return JSON.parse(localStorage.getItem('dsh-hidden-projects') || '[]'); } catch (err) { return []; }
}

function hideProject(name) {
  const list = hiddenProjects();
  if (list.indexOf(name) === -1) list.push(name);
  try { localStorage.setItem('dsh-hidden-projects', JSON.stringify(list)); } catch (err) { /* 隐私模式 */ }
}

function clearHiddenProjects() {
  try { localStorage.removeItem('dsh-hidden-projects'); } catch (err) { /* 隐私模式 */ }
}

async function renameProjectPrompt(name) {
  const to = window.prompt('把「' + name + '」改名为：', name);
  if (!to || to.trim() === name) return;
  try {
    const payload = await projectApi({ action: 'rename', name: name, to: to.trim() });
    $('ppMsg').textContent = '已重命名：' + name + ' → ' + payload.name;
    if (ppSelected === name) ppSelected = payload.name;
    loadProjectPage();
  } catch (err) {
    $('ppMsg').textContent = '重命名失败：' + err.message;
  }
}

async function deleteProjectConfirm(name) {
  if (!window.confirm('删除项目「' + name + '」？会删掉它的目录（来源台账、原文、草案都在里面），不可撤销。')) return;
  try {
    await projectApi({ action: 'delete', name: name, confirm: true });
    $('ppMsg').textContent = '已删除：' + name;
    if (ppSelected === name) {
      ppSelected = '';
      $('ppTitle').textContent = '项目详情';
      $('ppDetail').innerHTML = '<div class="muted">左边点一个项目，这里会显示它的索引与草案。</div>';
      $('ppDraftList').innerHTML = '';
    }
    loadProjectPage();
  } catch (err) {
    $('ppMsg').textContent = '删除失败：' + err.message;
  }
}

// 来源列表：点一条看它的**完整原文**（岗位描述原封不动），老数据没有原文时如实说明
// 来源列表：默认折叠在项目下方，点「来源与原文」才加载（避免一进页面就为 11 个项目拉 115 条来源）。
async function loadProjectSources(name, box) {
  const target = box || document.querySelector('.pp-sources[data-name="' + CSS.escape(name) + '"]');
  if (!target) return;
  target.hidden = false;
  target.innerHTML = '<div class="muted">正在读取来源…</div>';
  target.setAttribute('data-loaded', '1');
  try {
    const payload = await api('/api/project?name=' + encodeURIComponent(name));
    target._sources = payload.sources || [];
    renderSourceButtons(target, name, target._sources);
  } catch (err) {
    target.innerHTML = '<div class="warn-text">读取来源失败：' + escapeText(err.message)
      + '　下一步：点「刷新项目列表」重试；显示「旧数据，无原文」的可跑 project backfill 补回。</div>';
  }
}

// 单条来源按钮：文件名 + 原文长度 + 公司/城市/学历/经验摘要 + 是否只有列表卡片


function startDrillWith(ids) {
  const list = (ids || []).filter(function (id) { return typeof id === 'string'; });
  if (!list.length) {
    if ($('drill')) $('drill').innerHTML = '<div class="muted">这份清单里没有可练的题：换一个来源，或先在 knowledge.mjs 里把知识点挂上题。</div>';
    return;
  }
  state.analyzeTasks = list;
  try { localStorage.setItem('dsh-learn-analysis-tasks', JSON.stringify(list)); } catch (err) { /* 隐私模式 */ }
  panels.loadDrill().then(function () {
    const first = state.tasks.filter(function (task) { return task.id === list[0]; })[0];
    if (first) goToTask(first.id);
    if ($('drill')) $('drill').scrollIntoView({ block: 'nearest' });
  });
}

// 项目里的知识点 → 开练清单（与 JD 分析同一套映射：知识点挂了哪些题就练哪些）
async function startDrillFromProject(name) {
  try {
    const listed = await projectApi({ action: 'tasks', name: name });
    if (!listed.tasks.length) {
      projectMessage(listed.points.length
        ? ('这个项目命中了 ' + listed.points.length + ' 个知识点，但它们还没挂题（可在 src/core/knowledge.mjs 里补挂）。')
        : '这个项目还没记下知识点：重新收一次来源即可（更早的记录里没有知识点 id）。');
      return;
    }
    startDrillWith(listed.tasks);
    projectMessage('已按 ' + listed.points.length + ' 个知识点整理出 ' + listed.tasks.length + ' 道题，建议面板已刷新。', 'ok');
  } catch (err) {
    projectMessage('整理开练清单失败：' + err.message, 'bad');
  }
}

// 地址里带上项目名/题号：可以收藏、可以直接发给同事（#project=名字、#task=题号）
// 只在有变化的那一项上动手：开项目不该把题号抹掉，选题也不该把项目抹掉。
function writeHash(pairs) {
  const params = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  // 短链写法（#flow）会被解析成形如 flow= 的空键；切页面时顺手清掉，
  // 否则 URL 会越切越长（实测出现过 #flow=&page=projects → #flow=&page=jobs）。
  PAGES.forEach(function (name) { if (params.get(name) === '') params.delete(name); });
  Object.keys(pairs).forEach(function (key) {
    if (pairs[key]) params.set(key, pairs[key]);
    else params.delete(key);
  });
  const next = params.toString();
  try { history.replaceState(null, '', next ? ('#' + next) : location.pathname + location.search); } catch (err) { /* file:// 下不允许就算了 */ }
}

function setProjectHash(name) {
  writeHash({ project: name || '' });
}

function setTaskHash(taskId) {
  writeHash({ task: taskId || '' });
}

function readTaskHash() {
  const raw = String(location.hash || '').replace(/^#/, '');
  if (!raw) return '';
  return new URLSearchParams(raw).get('task') || '';
}

function rememberProject(name) {
  try { localStorage.setItem('dsh-learn-last-project', name || ''); } catch (err) { /* 隐私模式 */ }
}

function readProjectHash() {
  const raw = String(location.hash || '').replace(/^#/, '');
  if (!raw) return '';
  const params = new URLSearchParams(raw);
  return params.get('project') || '';
}

async function openProject(name) {
  setProjectHash(name);
  rememberProject(name);
  const box = $('projectResult');
  if (!box) return;
  projectMessage('读取项目中…');
  try {
    const payload = await api('/api/project?name=' + encodeURIComponent(name));
    const meta = payload.meta || {};
    let html = '<div class="ok">' + escapeText(meta.displayName || name) + '</div>';
    html += '<div class="muted">目录：<code>' + escapeText(payload.dir || '') + '</code></div>';
    html += '<div class="muted">建立于 ' + escapeText(String(meta.createdAt || '').replace('T', ' ').slice(0, 19))
      + '　更新于 ' + escapeText(String(meta.updatedAt || '').replace('T', ' ').slice(0, 19)) + '</div>';
    if (!payload.sources.length) {
      html += '<div class="muted">还没有来源：用上面的截图 / 文字 / 链接 / 仓库收进来。</div>';
    } else {
      html += '<table><tr><th scope="col">时间</th><th scope="col">类型</th><th scope="col">来源</th><th scope="col">知识点</th><th scope="col">草案题</th></tr>';
      payload.sources.slice().reverse().forEach(function (row) {
        html += '<tr><td>' + escapeText(String(row.at || '').replace('T', ' ').slice(5, 19)) + '</td><td>'
          + escapeText(row.kind) + '</td><td>' + escapeText(String(row.source).slice(0, 60)) + '</td><td>'
          + row.knowledge + '</td><td>' + row.tasks + '</td></tr>';
      });
      html += '</table>';
      html += '<div class="muted">产物文件：</div><ul>';
      payload.sources.forEach(function (row) {
        (row.artifacts || []).forEach(function (rel) { html += '<li><code>' + escapeText(rel) + '</code></li>'; });
      });
      html += '</ul>';
    }
    html += '<div class="row"><button class="ghost" id="projectDrillBtn">用这些知识点开练</button>'
      + '<button class="ghost" id="projectDeleteBtn">删除这个项目</button>'
      + '<span class="muted">会删掉项目目录（notes/drafts/promoted 一起），不可恢复</span></div>';
    box.innerHTML = html;
    const drillBtn = $('projectDrillBtn');
    if (drillBtn) drillBtn.addEventListener('click', function () { startDrillFromProject(name); });
    const del = $('projectDeleteBtn');
    if (del) {
      del.addEventListener('click', async function () {
        const typed = window.prompt('删除项目 ' + name + '：输入项目名确认（会删掉整个项目目录）', '');
        if (typed !== name) { projectMessage('项目名不一致，已取消删除。'); return; }
        try {
          const res = await projectApi({ action: 'delete', name: name, confirm: true });
          projectMessage('已删除：' + (res.dir || name), 'ok');
          loadDrafts && ($('draftList') ? ($('draftList').innerHTML = '') : null);
        } catch (err) { projectMessage('删除失败：' + err.message, 'bad'); }
      });
    }
  } catch (err) {
    projectMessage('读取失败：' + err.message, 'bad');
  }
}

function bindProjectPane() {
  if (!$('projectPane')) return;
  $('projectInitBtn').addEventListener('click', async function () {
    const name = projectName();
    if (!name) { projectMessage('先填项目名。'); return; }
    try {
      const res = await projectApi({ action: 'init', name: name });
      projectMessage('项目已就绪：' + res.dir + (res.created ? '' : '（已存在，没有覆盖）'), 'ok');
    } catch (err) { projectMessage('建立失败：' + err.message, 'bad'); }
  });
  // 项目检索与筛选：口径在 core/project.mjs#filterProjects，网页只负责把条件传过去并渲染
  async function loadProjectList() {
    const q = ($('projectQuery') || {}).value || '';
    const missingText = Boolean($('projectMissingText') && $('projectMissingText').checked);
    const sort = ($('projectSort') || {}).value || 'updated';
    const params = [];
    if (q.trim()) params.push('q=' + encodeURIComponent(q.trim()));
    if (missingText) params.push('missingText=1');
    if (sort !== 'updated') params.push('sort=' + encodeURIComponent(sort));
    try {
      renderProjectList(await api('/api/project' + (params.length ? ('?' + params.join('&')) : '')));
    } catch (err) { projectMessage('读取失败：' + err.message, 'bad'); }
  }
  $('projectListBtn').addEventListener('click', loadProjectList);
  if ($('projectQuery')) {
    let timer = null;
    $('projectQuery').addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { loadProjectList(); }, 220);
    });
  }
  if ($('projectMissingText')) $('projectMissingText').addEventListener('change', loadProjectList);
  if ($('projectSort')) $('projectSort').addEventListener('change', loadProjectList);
  $('projectTextBtn').addEventListener('click', async function () {
    const name = projectName();
    const text = ($('projectText') || {}).value || '';
    if (!name) { projectMessage('先填项目名。'); return; }
    if (!text.trim()) { projectMessage('先在文本框里贴上内容。'); return; }
    projectMessage('解析中…');
    try { renderProjectResult(await projectApi({ name: name, text: text })); } catch (err) { projectMessage('解析失败：' + err.message, 'bad'); }
  });
  $('projectUrlBtn').addEventListener('click', async function () {
    const name = projectName();
    const url = ($('projectUrl') || {}).value || '';
    if (!name || !url.trim()) { projectMessage('项目名和链接都要填。'); return; }
    projectMessage('抓取并解析中…');
    try { renderProjectResult(await projectApi({ name: name, url: url.trim() })); } catch (err) { projectMessage('抓取失败：' + err.message, 'bad'); }
  });
  $('projectRepoPathBtn').addEventListener('click', async function () {
    const name = projectName();
    const path = ($('projectRepoPath') || {}).value || '';
    if (!name || !path.trim()) { projectMessage('项目名和本地路径都要填。'); return; }
    projectMessage('扫描仓库中…');
    try { renderProjectResult(await projectApi({ name: name, kind: 'repo', repoPath: path.trim() })); } catch (err) { projectMessage('扫描失败：' + err.message, 'bad'); }
  });
  $('projectRepoUrlBtn').addEventListener('click', async function () {
    const name = projectName();
    const url = ($('projectRepoUrl') || {}).value || '';
    if (!name || !url.trim()) { projectMessage('项目名和仓库地址都要填。'); return; }
    projectMessage('克隆并扫描中（大仓库会比较久，也可以先在终端克隆再用本地路径）…');
    try { renderProjectResult(await projectApi({ name: name, kind: 'repo', repoUrl: url.trim() })); } catch (err) { projectMessage('克隆或扫描失败：' + err.message, 'bad'); }
  });
  $('projectImage').addEventListener('change', function () {
    const file = $('projectImage').files && $('projectImage').files[0];
    if (!file) return;
    const name = projectName();
    if (!name) { projectMessage('先填项目名，再选截图。'); return; }
    const reader = new FileReader();
    reader.onload = async function () {
      projectMessage('识别截图中…');
      // 带上原文件名：服务端会用它给 notes/ 与 drafts/ 里的产物起名（否则只能用 OCR 临时文件名）
      try { renderProjectResult(await projectApi({ name: name, dataUrl: String(reader.result || ''), fileName: file.name })); } catch (err) { projectMessage('识别失败：' + err.message, 'bad'); }
    };
    reader.readAsDataURL(file);
  });
}

function restoreProjectView() {
  const fromHash = readProjectHash();
  let last = '';
  try { last = localStorage.getItem('dsh-learn-last-project') || ''; } catch (err) { /* 隐私模式 */ }
  const name = fromHash || last;
  if (!name || !$('projectName')) return;
  $('projectName').value = name;
  // 地址里点名要看这个项目：直接打开；只是上次看过：填上名字即可，不自动拉数据
  if (fromHash) openProject(fromHash);
}

// 从地址里恢复题号：别人发来的"就是这一题"链接点开就能直接开练。
// 目标题可能被当前筛选挡住（难度/状态/搜索词），那就先回到全部筛选再打开。
function restoreTaskView() {
  const fromHash = readTaskHash();
  if (!fromHash) return;
  const exists = state.tasks.some(function (task) { return task.id === fromHash; });
  if (!exists) return;
  const visible = visibleTasks().some(function (task) { return task.id === fromHash; });
  if (!visible) resetAllFilters();
  goToTask(fromHash, { scroll: false }); // 首屏恢复：不替用户滚页面
}

bindProjectPane();
restoreProjectView();

// 草案 → 正式包：先预览（默认 dry-run），确认后再落到项目 promoted/ 并给出下载
function draftMessage(text, cls) {
  const box = $('draftDetail');
  if (box) box.innerHTML = '<div class="' + (cls || 'muted') + '">' + escapeText(text) + '</div>';
}


function renderDraftResult(payload) {
  const box = $('draftDetail');
  if (!box) return;
  let html = '<div class="' + (payload.errors && payload.errors.length ? 'bad' : 'ok') + '">'
    + escapeText(payload.packId) + '　' + payload.taskCount + ' 题　'
    + (payload.dryRun ? '（预览，没有写文件）'
      : (payload.scope === 'catalog' ? '已写入总题库（用户题库目录）——这些题下次启动客户端就能练到' : '已写入项目 promoted/ 暂存区（还没进总题库）')) + '</div>';
  if (payload.levelsAdded && payload.levelsAdded.length) {
    html += '<div class="muted">按难度口径补上 level：'
      + escapeText(payload.levelsAdded.map(function (row) { return row.id + '=' + row.level; }).join('、')) + '</div>';
  }
  if (payload.errors && payload.errors.length) {
    html += '<div class="bad">校验未通过：</div><ul>';
    payload.errors.forEach(function (msg) { html += '<li>' + escapeText(msg) + '</li>'; });
    html += '</ul>';
  }
  if (payload.warnings && payload.warnings.length) {
    html += '<div class="muted">复核提醒（' + payload.warnings.length + ' 条）：</div><ul>';
    payload.warnings.slice(0, 8).forEach(function (msg) { html += '<li>' + escapeText(msg) + '</li>'; });
    html += '</ul>';
  }
  if (payload.dryRun && !(payload.errors && payload.errors.length)) {
    if (payload.scope === 'catalog') {
      html += '<div class="row"><button class="ghost" id="draftCatalogNow">确认无误，加入总题库</button>'
        + '<span class="muted">写进用户题库目录（~/.dsh-learn/packs/）：所有客户端下次启动就能练到这些题，不会动仓库里的 packs/</span></div>';
    } else {
      html += '<div class="row"><button class="ghost" id="draftPromoteNow">确认无误，转成正式包</button>'
        + '<span class="muted">先把补齐 level 后的包写到项目的 promoted/ 暂存区（还没进总题库）</span>'
        + '<button class="ghost" id="draftCatalogPreview">加入总题库…</button></div>';
    }
  }
  if (payload.pack) {
    const name = (payload.pack.id || 'pack') + '.json';
    const blob = new Blob([JSON.stringify(payload.pack, null, 2) + '\n'], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    html += '<div class="row"><a href="' + href + '" download="' + escapeText(name) + '">下载正式包 ' + escapeText(name) + '</a>'
      + '<span class="muted">' + (payload.scope === 'catalog'
        ? '已进总题库：这些题下次启动就能练；不合适就删掉用户题库目录里的这个文件'
        : '也可以先攒在项目的 promoted/，确认后再「加入总题库」') + '</span></div>';
  }
  box.innerHTML = html;
  if ($('draftPromoteNow')) {
    $('draftPromoteNow').addEventListener('click', function () { runDraft(payload.file, false); });
  }
  // 先预览总题库那一路（默认 dry-run），确认按钮由renderDraftResult按 scope 给出
  if ($('draftCatalogPreview')) {
    $('draftCatalogPreview').addEventListener('click', function () { runDraft(payload.file, true, 'catalog'); });
  }
  if ($('draftCatalogNow')) {
    $('draftCatalogNow').addEventListener('click', function () { runDraft(payload.file, false, 'catalog'); });
  }
}


async function loadDrafts() {
  const name = projectName();
  if (!name) { draftMessage('先填项目名。'); return; }
  try { renderDraftList(await api('/api/draft?project=' + encodeURIComponent(name))); } catch (err) { draftMessage('读取失败：' + err.message, 'bad'); }
}

function bindDraftSection() {
  if (!$('projectDraftsBtn')) return;
  $('projectDraftsBtn').addEventListener('click', loadDrafts);
}

bindDraftSection();

// ==================== 三个页面：学习 / 项目管理 / 简历投递 ====================
// 页面只是"看哪一块"，不改变数据：学习页装当前所有功能，项目管理页管项目与草案入库，
// 简历投递页管投递记录与 JD 分析。页面写进地址 hash（#page=jobs），可收藏可分享；
// #task= / #project= 是各自独立的键，切页不会把它们抹掉。
const PAGES = ['repo', 'learn', 'jobs', 'flow'];

function readPageHash() {
  const raw = String(location.hash || '').replace(/^#/, '');
  if (!raw) return 'learn';
  // 两种写法都认：#page=flow（标签点出来的）与 #flow（手写/分享的短链）
  const fromQuery = new URLSearchParams(raw).get('page');
  // 老书签 #page=projects 现在指向合并后的项目/仓库页
  const page = (fromQuery === 'projects' ? 'repo' : (fromQuery || raw));
  return PAGES.indexOf(page) > -1 ? page : 'learn';
}

function showPage(page, options) {
  const opts = options || {};
  const target = PAGES.indexOf(page) > -1 ? page : 'learn';
  PAGES.forEach(function (key) {
    const main = document.querySelector('main[data-page="' + key + '"]');
    if (main) main.hidden = key !== target;
    const tab = document.querySelector('#pageNav button[data-page="' + key + '"]');
    if (tab) tab.setAttribute('aria-selected', key === target ? 'true' : 'false');
  });
  if (opts.hash !== false) writeHash({ page: target === 'learn' ? '' : target });
  if (target === 'repo') loadProjectPage();
  if (target === 'repo') loadDrafts();
  if (target === 'jobs') jobsPanel.loadJobs();
  if (target === 'flow') loadFlow();
  if (target === 'learn' && opts.scroll !== false) window.scrollTo({ top: 0 });
}

function bindPageNav() {
  const nav = $('pageNav');
  if (!nav) return;
  nav.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-page]');
    if (button) showPage(button.getAttribute('data-page'));
  });
  // 键盘左右键在三个标签之间移动（tablist 的常规操作）
  nav.addEventListener('keydown', function (event) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const at = PAGES.indexOf(readPageHash());
    const next = event.key === 'ArrowRight' ? (at + 1) % PAGES.length : (at + PAGES.length - 1) % PAGES.length;
    event.preventDefault();
    showPage(PAGES[next]);
    const tab = document.querySelector('#pageNav button[data-page="' + PAGES[next] + '"]');
    if (tab) tab.focus();
  });
  window.addEventListener('hashchange', function () {
    const page = readPageHash();
    const visible = PAGES.filter(function (key) {
      const main = document.querySelector('main[data-page="' + key + '"]');
      return main && !main.hidden;
    })[0];
    if (page !== visible) showPage(page, { hash: false });
  });
}

// ---------------- 项目管理页 ----------------
let ppSelected = '';

async function loadProjectPage() {
  const box = $('ppList');
  if (!box) return;
  try {
    const payload = await api('/api/project');
    const rows = payload.projects || [];
    if (!rows.length) {
      box.innerHTML = '<div class="muted">还没有项目。到「学习」页的项目 / 仓库面板里建一个，收一次截图 / 文字 / 链接或仓库。</div>';
      $('ppMsg').textContent = '';
      return;
    }
    const hidden = hiddenProjects();
    const keyword = ($('ppFilter') ? $('ppFilter').value.trim().toLowerCase() : '');
    const sortBy = ($('ppSort') ? $('ppSort').value : 'updated');
    let visible = rows.filter(function (row) { return hidden.indexOf(row.name) === -1; });
    if (keyword) {
      visible = visible.filter(function (row) {
        return String(row.name + ' ' + (row.displayName || '')).toLowerCase().indexOf(keyword) > -1;
      });
    }
    visible.sort(function (a, b) {
      if (sortBy === 'sources') return (b.sources || 0) - (a.sources || 0);
      if (sortBy === 'knowledge') return (b.knowledge || 0) - (a.knowledge || 0);
      if (sortBy === 'tasks') return (b.tasks || 0) - (a.tasks || 0);
      if (sortBy === 'name') return String(a.name).localeCompare(String(b.name));
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
    box.innerHTML = visible.map(function (row) {
      return '<div class="pp-row">'
        + '<button class="pp-card" data-project="' + escapeText(row.name) + '" aria-current="' + (row.name === ppSelected ? 'true' : 'false') + '">'
        + escapeText(row.displayName || row.name)
        + '<span class="st">来源 ' + String(row.sources || 0) + '　知识点 ' + String(row.knowledge || 0) + '　草案题 ' + String(row.tasks || 0)
        + '　' + escapeText(String(row.updatedAt || '').replace('T', ' ').slice(0, 16)) + '</span></button>'
        + '<span class="pp-actions">'
        + '<button class="ghost ppRename" data-project="' + escapeText(row.name) + '" title="重命名">重命名</button>'
        + '<button class="ghost ppHide" data-project="' + escapeText(row.name) + '" title="只从列表里移除，不删磁盘文件">移除</button>'
        + '<button class="ghost danger ppDelete" data-project="' + escapeText(row.name) + '" title="删除项目目录（不可撤销）">删除</button>'
        + '</span></div>';
    }).join('');
    if (visible.length !== rows.length) {
      box.innerHTML += '<div class="muted">已移除 ' + String(rows.length - visible.length) + ' 个（只隐藏，磁盘没动）'
        + '　<button class="ghost" id="ppShowHidden">显示并恢复</button></div>';
      if ($('ppShowHidden')) $('ppShowHidden').addEventListener('click', function () { clearHiddenProjects(); loadProjectPage(); });
    }
    Array.prototype.forEach.call(box.querySelectorAll('.pp-card'), function (card) {
      card.addEventListener('click', function () { openProjectPage(card.getAttribute('data-project')); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.ppRename'), function (button) {
      button.addEventListener('click', function () { renameProjectPrompt(button.getAttribute('data-project')); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.ppHide'), function (button) {
      button.addEventListener('click', function () { hideProject(button.getAttribute('data-project')); loadProjectPage(); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.ppDelete'), function (button) {
      button.addEventListener('click', function () { deleteProjectConfirm(button.getAttribute('data-project')); });
    });
    $('ppMsg').textContent = '共 ' + String(rows.length) + ' 个项目';
    if (ppSelected && rows.some(function (row) { return row.name === ppSelected; })) openProjectPage(ppSelected);
  } catch (err) {
    box.innerHTML = '<div class="muted">读取失败：' + escapeText(err.message) + '</div>';
  }
}


// 开练清单：这个项目涉及哪些题、我已通过多少、先练哪几道（每条带排序理由）
async function loadDrillPlan(name) {
  const box = $('ppDrillPlan');
  if (!box) return;
  box.innerHTML = '<div class="muted">正在算开练清单…</div>';
  try {
    const payload = await projectApi({ action: 'drill', project: name, limit: 8 });
    const plan = payload.plan || {};
    if (!plan.total) {
      box.innerHTML = '<div class="muted">这个项目还没挂上题：来源里没有命中知识点的内容（截图 / 纯文字通常只出知识点，链接与仓库才可能出题）。</div>';
      return;
    }
    let html = '<div class="row"><strong>开练清单</strong>'
      + '<span class="muted">共 ' + String(plan.total) + ' 道　已通过 ' + String(plan.passed) + '　待练 <strong>' + String(plan.missing) + '</strong></span></div>';
    html += '<div class="row">' + (plan.byTrack || []).map(function (row) {
      return '<span class="tag">' + escapeText(row.track) + ' ' + String(row.passed) + '/' + String(row.total) + '</span>';
    }).join('') + '</div>';
    if (plan.nextUp && plan.nextUp.length) {
      html += '<div class="muted">先练这 ' + String(plan.nextUp.length) + ' 道（差一点的先补 → 没练过的从易到难）：</div>';
      html += '<ol class="pp-plan">' + plan.nextUp.map(function (row) {
        return '<li><code>' + escapeText(row.id) + '</code>　' + escapeText(row.title || '')
          + '<span class="muted">　[' + escapeText(row.track) + '/' + escapeText(levelText(row.level)) + ']　' + escapeText(row.reason || '') + '</span></li>';
      }).join('') + '</ol>';
      html += '<div class="row">'
        + '<button class="ghost" id="ppDrillNext">先练这些（' + String(plan.nextUp.length) + ' 道）</button>'
        + '<button class="ghost" id="ppDrillAll">按清单全练（' + String(plan.total) + ' 道）</button>'
        + '<button class="ghost" id="ppDrillCopy">复制开练命令</button></div>';
    }
    box.innerHTML = html;
    if ($('ppDrillNext')) {
      $('ppDrillNext').addEventListener('click', function () {
        startDrillWith(plan.nextUp.map(function (row) { return row.id; }));
        showPage('learn');
      });
    }
    if ($('ppDrillAll')) {
      $('ppDrillAll').addEventListener('click', function () {
        startDrillWith(plan.rows.map(function (row) { return row.id; }));
        showPage('learn');
      });
    }
    if ($('ppDrillCopy')) {
      $('ppDrillCopy').addEventListener('click', function () {
        const area = document.createElement('textarea');
        area.value = plan.command || '';
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); } catch (err) { /* 老浏览器 */ }
        document.body.removeChild(area);
        $('ppDrillCopy').textContent = '已复制命令';
      });
    }
  } catch (err) {
    box.innerHTML = '<div class="warn-text">算开练清单失败：' + escapeText(err.message)
      + '　下一步：点「刷新项目列表」重试；若一直失败，确认服务端在跑（node src/web/server.mjs --port 8787）。</div>';
  }
}


async function openProjectPage(name) {
  ppSelected = name;
  const list = $('ppList');
  if (list) {
    Array.prototype.forEach.call(list.querySelectorAll('.pp-card'), function (card) {
      card.setAttribute('aria-current', card.getAttribute('data-project') === name ? 'true' : 'false');
    });
  }
  const detail = $('ppDetail');
  detail.innerHTML = '<div class="muted">正在读取项目索引…</div>';
  try {
    const index = await api('/api/project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'index', name: name })
    });
    $('ppTitle').textContent = '项目详情：' + (index.displayName || name);
    const points = index.points || [];
    const tasks = index.tasks || [];
    let html = '<div class="muted">知识点 ' + String(points.length) + ' 个 → 可练题 ' + String(tasks.length) + ' 道（索引文件 tasks.json，收完来源自动刷新）</div>';
    if (points.length) {
      html += '<div class="row">' + points.slice(0, 12).map(function (point) {
        return '<span class="tag">' + escapeText(point.name) + '</span>';
      }).join('') + (points.length > 12 ? '<span class="muted">…共 ' + String(points.length) + ' 个</span>' : '') + '</div>';
    }
    detail.innerHTML = html;
    // 开练清单：与练习记录对照后的"先练哪几道"（服务端 core/project.mjs 的 projectDrillPlan）
    loadDrillPlan(name);
    renderProjectDrafts(index.drafts || [], name);
    openProjectSources(name);
  } catch (err) {
    detail.innerHTML = '<div class="muted">读取失败：' + escapeText(err.message) + '</div>';
    $('ppDraftList').innerHTML = '';
  }
}

async function runProjectDraft(name, file, dryRun, catalog) {
  const box = $('ppDraftDetail');
  box.innerHTML = '<div class="muted">处理中…</div>';
  try {
    const payload = await api('/api/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: name, file: file.replace(/^drafts\//, ''), dryRun: dryRun, scope: catalog ? 'catalog' : 'project' })
    });
    const errors = payload.errors || [];
    if (errors.length) {
      box.innerHTML = '<div class="warn-text">有 ' + String(errors.length) + ' 个错误，先修草案：</div><ul>'
        + errors.slice(0, 5).map(function (msg) { return '<li>' + escapeText(msg) + '</li>'; }).join('') + '</ul>';
      return;
    }
    let html = '<div class="muted">' + escapeText(payload.packId || file) + '　' + String(payload.taskCount || 0) + ' 题　'
      + (payload.dryRun ? '（预览，没有写文件）' : (catalog ? '已写入总题库（用户题库目录）' : '已写入项目暂存区')) + '</div>';
    if ((payload.warnings || []).length) {
      html += '<div class="muted">复核提醒（' + String(payload.warnings.length) + ' 条）：</div><ul>'
        + payload.warnings.slice(0, 6).map(function (msg) { return '<li>' + escapeText(msg) + '</li>'; }).join('') + '</ul>';
    }
    if (payload.dryRun) {
      html += '<div class="row">'
        + '<button class="ghost" id="ppConfirmCatalog">确认加入总题库</button>'
        + '<button class="ghost" id="ppConfirmStage">暂存到项目</button>'
        + '<span class="muted">总题库 = 用户题库目录，所有客户端下次启动就能练到；暂存只是放进项目的 promoted/</span></div>';
    } else if (catalog) {
      html += '<div class="muted">这些题下次启动客户端就能练到；撤销就删掉用户题库目录里的那个文件。</div>';
    }
    box.innerHTML = html;
    if ($('ppConfirmCatalog')) {
      $('ppConfirmCatalog').addEventListener('click', function () { runProjectDraft(name, file, false, true); });
    }
    if ($('ppConfirmStage')) {
      $('ppConfirmStage').addEventListener('click', function () { runProjectDraft(name, file, false, false); });
    }
    if (!payload.dryRun) openProjectPage(name);
  } catch (err) {
    box.innerHTML = '<div class="muted">处理失败：' + escapeText(err.message) + '</div>';
  }
}

// ---------------- 简历投递页 ----------------
// 投递页逻辑已搬到 web/jobs.mjs（依赖注入，避免循环 import）
const jobsPanel = initJobsPanel({
  api: api, $: $, escapeText: escapeText, startDrillWith: startDrillWith, showPage: showPage
});

// 项目/仓库渲染组（repo.mjs）：依赖以 lambda 注入，函数声明提升，初始化可以放在定义之前。
const repo = initRepo({
  $: $, api: api, escapeText: escapeText,
  projectName: function (a) { return projectName(a); },
  loadProjectSources: function (a, b) { return loadProjectSources(a, b); },
  startDrillWith: function (a, b) { return startDrillWith(a, b); },
  openProject: function (a) { return openProject(a); },
  draftMessage: function (a, b) { return draftMessage(a, b); },
  renderDraftResult: function (a) { return renderDraftResult(a); },
  loadDrafts: function (a) { return loadDrafts(a); },
  showPage: function (a) { return showPage(a); },
  loadProjectPage: function (a) { return loadProjectPage(a); },
  runProjectDraft: function (a, b) { return runProjectDraft(a, b); },
  getPpSelected: function () { return ppSelected; },
  setPpSelected: function (v) { ppSelected = v; }
});
const { renderProjectResult, renderProjectList, renderSourceButtons, openProjectSources, projectApi, projectMessage, showSourceText, renderProjectDrafts, renderDraftList, runDraft } = repo;

function bindProjectPage() {
  if ($('ppRefresh')) $('ppRefresh').addEventListener('click', loadProjectPage);
}

bindPageNav();
bindProjectPage();
showPage(readPageHash(), { hash: false, scroll: false });

// ---------------- 搜索并解析（软件自己会搜） ----------------
// 三个按钮对应三种"搜到之后做什么"：只看结果 / 解析成知识点与题 / 解析并收进当前项目。
// 口径都在服务端 core/search.mjs（CLI search/research 用同一份），前端只负责显示与转发。
function searchMessage(html) {
  const box = $('searchResult');
  if (box) box.innerHTML = html;
}

function searchKeywords() {
  const input = $('searchQuery');
  const query = input ? input.value.trim() : '';
  if (!query) searchMessage('<div class="muted">先写搜索词，例如「kubectl rollout restart 官方文档」。</div>');
  return query;
}

async function runSearch(kind) {
  const query = searchKeywords();
  if (!query) return;
  const ingest = kind === 'ingest';
  const analyze = kind === 'research' || ingest;
  const project = ingest ? projectName() : '';
  if (ingest && !project) { searchMessage('<div class="muted">「解析并收进项目」要先填项目名（下面的项目 / 仓库面板）。</div>'); return; }
  searchMessage('<div class="muted">' + (analyze ? '搜索并逐个抓取解析中…（每页要抓一次，慢一点）' : '搜索中…') + '</div>');
  try {
    const payload = await api(analyze ? '/api/research' : '/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: query, limit: analyze ? 5 : 8, project: project })
    });
    if (!payload.ok) { searchMessage('<div class="warn-text">搜索失败：' + escapeText(payload.reason || '未知原因') + '</div>'); return; }
    let html = '<div class="muted">引擎 ' + escapeText(payload.engine || '-') + '　'
      + (analyze ? ('搜到 ' + String(payload.searched) + ' 条，抓到 ' + String(payload.fetched) + ' 页') : ('结果 ' + String(payload.total) + ' 条')) + '</div>';
    if (analyze) {
      (payload.results || []).forEach(function (row) {
        html += row.ok
          ? '<div>✓ 知识点 ' + String(row.matched) + ' 个 / 草案题 ' + String(row.tasks) + ' 道　<a href="' + escapeText(row.url) + '" target="_blank" rel="noreferrer">' + escapeText(row.title || row.url) + '</a></div>'
          : '<div class="muted">✗ ' + escapeText(row.url) + '：' + escapeText(row.reason || '抓取失败') + '</div>';
      });
      html += '<div class="muted">合并：知识点 ' + String((payload.points || []).length) + ' 个，可练题 ' + String((payload.tasks || []).length) + ' 道</div>';
      if (payload.project) {
        html += '<div class="muted">已收进项目 ' + escapeText(payload.project) + '：' + String(payload.ingested || 0) + ' 个来源，产物 ' + String((payload.artifacts || []).length) + ' 个文件——到「项目管理」页看它</div>';
      } else if ((payload.tasks || []).length) {
        html += '<div class="row"><button class="ghost" id="searchDrill">练这些题</button><span class="muted">用的是合并后的可练题清单</span></div>';
      }
    } else {
      (payload.results || []).forEach(function (row) {
        html += '<div><a href="' + escapeText(row.url) + '" target="_blank" rel="noreferrer">' + escapeText(row.title || row.url) + '</a>'
          + (row.snippet ? '<div class="muted">' + escapeText(row.snippet) + '</div>' : '') + '</div>';
      });
    }
    searchMessage(html);
    if ($('searchDrill')) {
      $('searchDrill').addEventListener('click', function () { startDrillWith((payload.tasks || []).slice()); });
    }
  } catch (err) {
    searchMessage('<div class="warn-text">搜索失败：' + escapeText(err.message) + '</div>');
  }
}

function bindSearchSection() {
  if (!$('searchBtn')) return;
  $('searchBtn').addEventListener('click', function () { runSearch('search'); });
  $('researchBtn').addEventListener('click', function () { runSearch('research'); });
  $('researchIngestBtn').addEventListener('click', function () { runSearch('ingest'); });
  // 回车即搜：这个框是"想到什么就搜一下"
  if ($('searchQuery')) {
    $('searchQuery').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); runSearch('research'); }
    });
  }
}

bindSearchSection();

// 识图能力：界面上如实显示"这台机器能不能识图、用哪个引擎"
async function loadOcrCapabilities() {
  const box = $('ocrCap');
  if (!box) return;
  try {
    const caps = await api('/api/ocr');
    const chosen = (caps.engines || []).filter(function (row) { return row.id === caps.chosen; })[0];
    if (chosen) {
      box.textContent = '识图引擎：' + chosen.name;
    } else {
      const first = (caps.engines || [])[0] || {};
      box.textContent = '识图不可用：' + (caps.advice || []).join('；');
    }
  } catch (err) {
    box.textContent = '';
  }
}

// 文字理解：把这段文本读成结构化信息（分类 / 公司 / 岗位 / 级别 / 硬要求 / 加分项 / 技术栈 / 知识点 / 可练题）
function renderUnderstanding(payload) {
  const box = $('analyzeResult');
  if (!box) return;
  const must = (payload.mustHave || []).map(function (row, index) {
    return '<li>' + escapeText(row.text) + '　<span class="muted">[' + escapeText(row.evidence || '') + ']</span></li>';
  }).join('');
  const nice = (payload.niceToHave || []).map(function (row) {
    return '<li>' + escapeText(row.text) + '　<span class="muted">[' + escapeText(row.evidence || '') + ']</span></li>';
  }).join('');
  let html = '<div class="muted">' + escapeText(payload.summary || '') + '</div>';
  html += '<table><tbody>'
    + '<tr><th scope="row">分类</th><td>' + escapeText(payload.kind || '-') + '</td></tr>'
    + '<tr><th scope="row">对象</th><td>' + escapeText((payload.company || '?') + ' · ' + (payload.position || '?')) + (payload.seniority ? '　' + escapeText(payload.seniority) : '') + '</td></tr>'
    + '<tr><th scope="row">技术栈</th><td>' + escapeText((payload.stack || []).join('、') || '-') + '</td></tr>'
    + '<tr><th scope="row">知识点</th><td>' + escapeText((payload.points || []).map(function (p) { return p.name; }).join('、') || '-') + '</td></tr>'
    + '</tbody></table>';
  if (must) html += '<div class="muted">硬要求（' + (payload.mustHave || []).length + ' 条，方括号里是判定依据）：</div><ul>' + must + '</ul>';
  if (nice) html += '<div class="muted">加分项（' + (payload.niceToHave || []).length + ' 条）：</div><ul>' + nice + '</ul>';
  if ((payload.tasks || []).length) {
    html += '<div class="row"><button class="ghost" id="understandDrill">练这些题（' + payload.tasks.length + ' 道）</button>'
      + '<button class="ghost" id="understandProject">建项目收下这段</button></div>';
  }
  box.innerHTML = html;
  if ($('understandDrill')) {
    $('understandDrill').addEventListener('click', function () { startDrillWith((payload.tasks || []).slice()); });
  }
  if ($('understandProject')) {
    $('understandProject').addEventListener('click', function () { ingestUnderstanding(); });
  }
}

async function ingestUnderstanding() {
  const name = $('projectName') ? $('projectName').value.trim() : '';
  if (!name) { $('analyzeResult').innerHTML += '<div class="muted">要建项目请先在下面的项目 / 仓库面板里填项目名。</div>'; return; }
  const text = $('analyzeText') ? $('analyzeText').value.trim() : '';
  if (!text) { $('analyzeResult').innerHTML += '<div class="muted">文本框是空的：理解与收进项目都以这段文本为准。</div>'; return; }
  const payload = await api('/api/project', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name, kind: 'text', text: text })
  });
  $('analyzeResult').innerHTML += '<div class="muted">已收进项目 ' + escapeText(payload.project) + '：知识点 ' + String((payload.knowledge || {}).matched || 0) + ' 个，草案题 ' + String(payload.tasks || 0) + ' 道——到「项目管理」页看它</div>';
}

async function runUnderstand() {
  const text = $('analyzeText') ? $('analyzeText').value.trim() : '';
  if (!text) { $('analyzeResult').innerHTML = '<div class="muted">先把岗位描述或文档正文粘进来，再点「理解这段文本」。</div>'; return; }
  $('analyzeResult').innerHTML = '<div class="muted">理解中…</div>';
  try {
    renderUnderstanding(await api('/api/understand', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text })
    }));
  } catch (err) {
    $('analyzeResult').innerHTML = '<div class="warn-text">理解失败：' + escapeText(err.message) + '</div>';
  }
}

if ($('understandBtn')) $('understandBtn').addEventListener('click', runUnderstand);
loadOcrCapabilities();

// ---------------- 流程页：七步闭环 ----------------
// 状态全部来自服务端 /api/flow（core/flow.mjs），这里只负责显示与转发动作。
function flowStatusMark(status) {
  if (status === 'done') return '✓';
  if (status === 'doing') return '…';
  return '·';
}

function renderFlow(status) {
  const box = $('flowStages');
  const summary = $('flowSummary');
  if (!box) return;
  if (summary) summary.textContent = status.summary || '';
  box.innerHTML = (status.stages || []).map(function (row) {
    return '<div class="job-row">'
      + '<div class="row" style="margin:0">'
      + '<strong>' + flowStatusMark(row.status) + ' ' + escapeText(row.name) + '</strong>'
      + '<span class="muted">' + escapeText(row.progress) + '</span>'
      + (row.status !== 'done' && row.action ? '<button class="ghost flowRun" data-cli="' + escapeText(row.action.cli) + '" data-label="' + escapeText(row.action.label) + '">' + escapeText(row.action.label) + '</button>' : '')
      + '</div>'
      + '<div class="muted">' + escapeText(row.evidence) + (row.blocked ? '　⚠ ' + escapeText(row.blocked) : '') + '</div>'
      + '</div>';
  }).join('');
  // 每步的按钮按"能做什么"分派：练题 → 切到学习页；生成简历 / 搜集 / 推荐 → 就地执行；收项目 → 切到学习页项目面板
  Array.prototype.forEach.call(box.querySelectorAll('.flowRun'), function (button) {
    const label = button.getAttribute('data-label');
    button.addEventListener('click', function () {
      if (label.indexOf('练') > -1) { showPage('learn'); if ($('daily')) $('daily').scrollIntoView({ block: 'nearest' }); return; }
      if (label.indexOf('收一个项目') > -1) { showPage('learn'); if ($('projectName')) $('projectName').focus(); return; }
      if (label.indexOf('简历') > -1) { runFlowResume(); return; }
      if (label.indexOf('搜集') > -1) { if ($('flowJd')) $('flowJd').focus(); return; }
      if (label.indexOf('推荐') > -1 || label.indexOf('补知识点') > -1) { runFlowRecommend(); return; }
      if (label.indexOf('投递') > -1) { showPage('jobs'); return; }
      showPage('learn');
    });
  });
}

async function loadFlow() {
  const box = $('flowStages');
  if (!box) return;
  try { renderFlow(await api('/api/flow')); } catch (err) { box.innerHTML = '<div class="muted">读取失败：' + escapeText(err.message) + '</div>'; }
}

async function runFlowResume() {
  const box = $('flowResume');
  if (!box) return;
  box.innerHTML = '<div class="muted">生成中…</div>';
  try {
    const resume = await api('/api/flow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) });
    let html = '<div>' + escapeText(resume.headline) + '</div>';
    if ((resume.skills || []).length) {
      html += '<table><thead><tr><th scope="col">方向</th><th scope="col">水平</th><th scope="col">通过/总数</th><th scope="col">通过率</th></tr></thead><tbody>'
        + resume.skills.map(function (row) {
          return '<tr><td>' + escapeText(row.track) + '</td><td>' + escapeText(row.level) + '</td><td>' + row.passed + '/' + row.total + '</td><td>' + row.percent + '%</td></tr>';
        }).join('') + '</tbody></table>';
    }
    if ((resume.highlights || []).length) {
      html += '<div class="muted">亮点（每条带依据）：</div><ul>'
        + resume.highlights.map(function (row) { return '<li>' + escapeText(row.text) + '——' + escapeText(row.evidence) + '</li>'; }).join('') + '</ul>';
    }
    if ((resume.projects || []).length) {
      html += '<div class="muted">项目经历：</div><ul>'
        + resume.projects.map(function (row) { return '<li>' + escapeText(row.name) + '：' + row.sources + ' 个来源 / ' + row.knowledge + ' 个知识点 / ' + row.tasks + ' 道草案题</li>'; }).join('') + '</ul>';
    }
    if ((resume.gaps || []).length) {
      html += '<div class="muted">待补方向：' + resume.gaps.map(function (row) { return escapeText(row.track) + ' ' + row.percent + '%'; }).join('、') + '</div>';
    }
    box.innerHTML = html;
  } catch (err) {
    box.innerHTML = '<div class="warn-text">生成失败：' + escapeText(err.message) + '</div>';
  }
}

async function runFlowCollect() {
  const text = $('flowJd') ? $('flowJd').value.trim() : '';
  const msg = $('flowCollectMsg');
  if (!text) { if (msg) msg.textContent = '先把 JD 正文粘进文本框。'; return; }
  if (msg) msg.textContent = '识别并入库中…';
  try {
    const payload = await api('/api/flow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'collect', text: text, url: $('flowJdUrl') ? $('flowJdUrl').value.trim() : '' })
    });
    if (msg) msg.textContent = '已入库：' + payload.job.company + ' · ' + payload.job.position + '　' + payload.summary;
    $('flowJd').value = '';
    loadFlow();
  } catch (err) {
    if (msg) msg.textContent = '入库失败：' + err.message;
  }
}

async function runFlowRecommend() {
  const box = $('flowRecommend');
  if (!box) return;
  box.innerHTML = '<div class="muted">计算中…</div>';
  try {
    const payload = await api('/api/flow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ action: 'recommend', limit: 5 }, flowFilterArgs())) });
    if (!(payload.jobs || []).length) { box.innerHTML = '<div class="muted">还没有可比对的岗位：先搜集几条并分析 JD。</div>'; return; }
    box.innerHTML = payload.jobs.map(function (row) {
      return '<div class="job-row">'
        + '<div class="row" style="margin:0"><strong>' + row.match + '%</strong>　' + escapeText(row.company) + ' · ' + escapeText(row.position)
        + '<span class="muted">（' + row.covered + '/' + row.total + ' 题）</span>'
        + (row.url ? '<a href="' + escapeText(row.url) + '" target="_blank" rel="noreferrer">岗位链接</a>' : '')
        + '<button class="ghost flowBuild" data-job="' + escapeText(row.jobId) + '">生成学习项目</button>'
        + '<button class="ghost flowPack" data-job="' + escapeText(row.jobId) + '">投递材料</button>'
        + '<button class="ghost flowApply" data-job="' + escapeText(row.jobId) + '">记投递</button>'
        + (row.missing.length ? '<button class="ghost flowDrill" data-tasks="' + escapeText(row.missing.join(',')) + '">练差的题</button>' : '')
        + '</div>'
        + flowAttrLine(row)
        + (row.why || []).map(function (line) { return '<div class="muted">· ' + escapeText(line) + '</div>'; }).join('')
        + (row.gapTracks.length ? '<div class="muted">要补的方向：' + escapeText(row.gapTracks.join('、')) + '</div>' : '')
        + '</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.flowDrill'), function (button) {
      button.addEventListener('click', function () {
        startDrillWith(button.getAttribute('data-tasks').split(','));
        showPage('learn');
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.flowPack'), function (button) {
      button.addEventListener('click', function () { runFlowPack(button.getAttribute('data-job')); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.flowBuild'), function (button) {
      button.addEventListener('click', function () { runFlowBuild(button.getAttribute('data-job')); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.flowApply'), function (button) {
      button.addEventListener('click', async function () {
        try {
          const done = await api('/api/flow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', id: button.getAttribute('data-job') }) });
          button.textContent = '已记投递（' + done.job.status + '）';
          button.disabled = true;
        } catch (err) { button.textContent = '记投递失败'; }
      });
    });
  } catch (err) {
    box.innerHTML = '<div class="warn-text">计算失败：' + escapeText(err.message) + '</div>';
  }
}

if ($('flowResumeBtn')) $('flowResumeBtn').addEventListener('click', runFlowResume);
if ($('flowCollectBtn')) $('flowCollectBtn').addEventListener('click', runFlowCollect);
if ($('flowRecommendBtn')) $('flowRecommendBtn').addEventListener('click', runFlowRecommend);

// 流程页补充：JD 截图入库（识图 → 理解 → 入库）与「按岗位生成学习项目」
async function runFlowCollectImage(file) {
  const msg = $('flowCollectMsg');
  if (msg) msg.textContent = '识图并入库中…（本机 OCR，离线）';
  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const payload = await api('/api/flow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'collect', image: String(reader.result || ''), url: $('flowJdUrl') ? $('flowJdUrl').value.trim() : '' })
      });
      if (msg) msg.textContent = '已入库：' + payload.job.company + ' · ' + payload.job.position + '　' + payload.summary;
      loadFlow();
    } catch (err) {
      if (msg) msg.textContent = '截图入库失败：' + err.message + '（先看页面上那行识图能力）';
    }
  };
  reader.readAsDataURL(file);
}

async function runFlowBuild(jobId) {
  const box = $('flowRecommend');
  if (box) box.innerHTML = '<div class="muted">正在按岗位建项目并写学习计划…</div>';
  try {
    const payload = await api('/api/flow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'build', id: jobId }) });
    const plan = payload.plan || {};
    let html = renderScaffold(payload);
    html += '<div class="muted">匹配度 ' + String(plan.match || 0) + '%　待练 ' + String((plan.missingTasks || []).length) + ' 道　方向：' + escapeText((plan.tracks || []).join('、') || '-') + '</div>';
    if ((plan.points || []).length) {
      html += '<table><thead><tr><th scope="col">知识点</th><th scope="col">待练</th><th scope="col">全部</th></tr></thead><tbody>'
        + plan.points.map(function (row) { return '<tr><td>' + escapeText(row.name) + '</td><td>' + row.missing.length + '</td><td>' + row.tasks.length + '</td></tr>'; }).join('')
        + '</tbody></table>';
    }
    if ((plan.missingTasks || []).length) {
      html += '<div class="row"><button class="ghost" id="flowBuildDrill">练这批题（' + plan.missingTasks.length + ' 道）</button>'
        + '<span class="muted">也可以到「项目管理」页看这个项目</span></div>';
    }
    box.innerHTML = html;
    if ($('flowBookText')) { $('flowBookText').value = (payload.scaffold || {}).book || ''; }
    if ($('flowBookCopy')) {
      $('flowBookCopy').addEventListener('click', function () { const area = $('flowBookText'); area.select(); try { document.execCommand('copy'); } catch (err) {} $('flowBookCopy').textContent = '已复制'; });
    }
    if ($('flowBuildDrill')) {
      $('flowBuildDrill').addEventListener('click', function () { startDrillWith((plan.missingTasks || []).slice()); showPage('learn'); });
    }
  } catch (err) {
    box.innerHTML = '<div class="warn-text">建项目失败：' + escapeText(err.message) + '</div>';
  }
}

if ($('flowJdImage')) {
  $('flowJdImage').addEventListener('change', function () {
    const file = this.files && this.files[0];
    if (file) runFlowCollectImage(file);
  });
}

// 按链接抓 JD：招聘站点要登录，Cookie 用环境变量配一次（DSH_LEARN_COOKIE / DSH_LEARN_COOKIE_FILE）
async function runFlowCollectUrl() {
  const msg = $('flowCollectMsg');
  const url = $('flowJdUrl') ? $('flowJdUrl').value.trim() : '';
  if (!url) { if (msg) msg.textContent = '先填岗位链接。'; return; }
  if (msg) msg.textContent = '抓取中…（登录站点需要先设 DSH_LEARN_COOKIE）';
  try {
    const payload = await api('/api/flow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'collect', url: url })
    });
    if (msg) msg.textContent = '已入库：' + payload.job.company + ' · ' + payload.job.position + '　' + payload.summary;
    loadFlow();
  } catch (err) {
    if (msg) msg.textContent = '抓取失败：' + err.message;
  }
}

if ($('flowCollectUrlBtn')) $('flowCollectUrlBtn').addEventListener('click', runFlowCollectUrl);

// 投递材料：逐条对硬要求 + 可粘贴要点 + 差异自陈（服务端 applicationPack，与 CLI flow pack 同一份）
async function runFlowPack(jobId) {
  const box = $('flowPack');
  if (!box) return;
  box.innerHTML = '<div class="muted">生成投递材料中…</div>';
  try {
    const pack = await api('/api/flow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'pack', id: jobId }) });
    let html = '<div class="muted">' + escapeText(pack.company + ' · ' + pack.position)
      + (pack.location ? '　' + escapeText(pack.location) : '')
      + (pack.salary && pack.salary.text ? '　' + escapeText(pack.salary.text) : '')
      + (pack.postedAt ? '　' + escapeText(pack.postedAt) : '')
      + '　匹配度 ' + String(pack.match) + '%</div>';
    html += '<textarea id="flowPackText" aria-label="投递材料" rows="16" spellcheck="false"></textarea>';
    html += '<div class="row"><button class="ghost" id="flowPackCopy">复制材料</button>'
      + '<span class="muted">逐条对硬要求 + 可粘贴要点 + 差异自陈；不含虚构经历，发出去前自己过一遍表达</span></div>';
    box.innerHTML = html;
    $('flowPackText').value = pack.markdown || '';
    if ($('flowPackCopy')) {
      $('flowPackCopy').addEventListener('click', function () {
        const area = $('flowPackText');
        area.select();
        try { document.execCommand('copy'); } catch (err) { /* 老浏览器 */ }
        $('flowPackCopy').textContent = '已复制';
      });
    }
  } catch (err) {
    box.innerHTML = '<div class="warn-text">生成失败：' + escapeText(err.message) + '</div>';
  }
}

// 推荐筛选：地点 / 期望薪资区间 / 只看远程（与 CLI flow recommend 同一份 core/flow.mjs）
function flowFilterArgs() {
  return {
    location: $('flowLoc') ? $('flowLoc').value.trim() : '',
    salaryMin: $('flowSalaryMin') ? Number($('flowSalaryMin').value) || 0 : 0,
    salaryMax: $('flowSalaryMax') ? Number($('flowSalaryMax').value) || 0 : 0,
    remoteOnly: Boolean($('flowRemote') && $('flowRemote').checked)
  };
}

// 岗位属性行：地点 / 薪资 / 发布时间（解析不出来就不显示，不编）
function flowAttrLine(row) {
  const parts = [];
  if (row.location) parts.push(row.location + (row.remote ? '（可远程）' : ''));
  else if (row.remote) parts.push('远程');
  if (row.salary && row.salary.text) parts.push(row.salary.text);
  if (row.postedAt) parts.push('发布 ' + row.postedAt);
  return parts.length ? '<div class="muted">' + escapeText(parts.join('　')) + '</div>' : '';
}

// 项目书：生成学习项目时一并产出（项目书.md / checklist.md / notes/命令清单.md）
function renderScaffold(built) {
  const scaffold = built.scaffold || {};
  const deliverables = scaffold.deliverables || [];
  let html = '<div>已建项目 <strong>' + escapeText(built.project || '') + '</strong>：学习计划 + 项目书 + 验收清单 + 命令清单</div>';
  html += '<div class="muted">产出文件：' + escapeText((built.files || []).join('、')) + '</div>';
  html += '<div class="muted">交付标准 ' + String(deliverables.length) + ' 条　命令 ' + String((scaffold.commands || []).length) + ' 条　待练 ' + String((scaffold.missingTasks || []).length) + ' 道</div>';
  if (scaffold.book) {
    html += '<div class="row"><button class="ghost" id="flowBookCopy">复制项目书</button><span class="muted">把「要交付什么 / 里程碑 / 怎么自检」发给任何人都能照着做；工具不替你写代码</span></div>';
    html += '<textarea id="flowBookText" aria-label="项目书" rows="12" spellcheck="false"></textarea>';
  }
  return html;
}

// 描述与提取：文本描述清楚 + 技术栈按类别抽全 + 知识点/可练题 + 未覆盖清单
// 与 CLI describe、/api/describe 同一份 core/describe.mjs
async function runFlowDescribe() {
  const text = $('flowJd') ? $('flowJd').value.trim() : '';
  const msg = $('flowCollectMsg');
  if (!text) { if (msg) msg.textContent = '先把岗位要求/文档正文粘进文本框。'; return; }
  if (msg) msg.textContent = '描述并提取中…';
  try {
    const payload = await api('/api/describe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text }) });
    const stats = payload.stats || {};
    if (msg) msg.textContent = '已提取：技术栈 ' + stats.terms + ' 项 / ' + stats.categories + ' 类；知识点 ' + stats.points + ' 个；可练题 ' + stats.tasks + ' 道；未覆盖 ' + stats.uncovered + ' 项';
    const box = $('flowPack');
    if (box) {
      box.innerHTML = '<div class="row"><button class="ghost" id="describeCopy">复制报告</button>'
        + '<span class="muted">描述 + 技术栈（按类别）+ 知识点与可练题 + 未覆盖清单；每条技术栈都带原文依据</span></div>'
        + '<textarea id="describeText" aria-label="描述与提取报告" rows="14" spellcheck="false"></textarea>';
      $('describeText').value = payload.markdown || '';
      $('describeCopy').addEventListener('click', function () {
        const area = $('describeText');
        area.select();
        try { document.execCommand('copy'); } catch (err) { /* 老浏览器 */ }
        $('describeCopy').textContent = '已复制';
      });
    }
  } catch (err) {
    if (msg) msg.textContent = '描述失败：' + err.message;
  }
}

if ($('flowDescribeBtn')) $('flowDescribeBtn').addEventListener('click', runFlowDescribe);

// 多岗位调研：把文本框里用一行 --- 分隔的多份 JD 聚合成市场画像（热度/通用技能/缺口/建议）
async function runFlowSurvey() {
  const raw = $('flowJd') ? $('flowJd').value.trim() : '';
  const msg = $('flowCollectMsg');
  const texts = raw.split(/^\s*-{3,}\s*$/m).map(function (item) { return item.trim(); }).filter(Boolean);
  if (texts.length < 2) { if (msg) msg.textContent = '至少两份岗位要求，用一行 --- 分隔。'; return; }
  if (msg) msg.textContent = '聚合 ' + texts.length + ' 份岗位中…';
  try {
    const payload = await api('/api/survey', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texts: texts }) });
    const stats = payload.stats || {};
    if (msg) msg.textContent = '调研完成：' + stats.jobs + ' 份岗位；技术栈 ' + stats.terms + ' 项 / ' + stats.categories + ' 类；通用 ' + stats.common + ' 项；缺口 ' + stats.gaps + ' 项';
    const box = $('flowPack');
    if (box) {
      box.innerHTML = '<div class="row"><button class="ghost" id="surveyCopy">复制调研</button>'
        + '<span class="muted">热度=出现在多少个岗位；通用技能=≥50% 岗位要求；缺口=我们还没覆盖的</span></div>'
        + '<textarea id="surveyText" aria-label="调研报告" rows="14" spellcheck="false"></textarea>';
      $('surveyText').value = payload.markdown || '';
      $('surveyCopy').addEventListener('click', function () {
        const area = $('surveyText');
        area.select();
        try { document.execCommand('copy'); } catch (err) { /* 老浏览器 */ }
        $('surveyCopy').textContent = '已复制';
      });
    }
  } catch (err) {
    if (msg) msg.textContent = '调研失败：' + err.message;
  }
}

if ($('flowSurveyBtn')) $('flowSurveyBtn').addEventListener('click', runFlowSurvey);

// 按目录批量导入：目录下每个子目录变成一个项目（前缀可加），用于把抓来的语料加载到项目页。
// 与 CLI project import、/api/project action=import 共用 core/project.mjs 的 importTree。
async function runProjectImport() {
  const dir = $('projectImportDir') ? $('projectImportDir').value.trim() : '';
  const prefix = $('projectImportPrefix') ? $('projectImportPrefix').value.trim() : '';
  if (!dir) { projectMessage('先填要导入的目录，例如 docs/samples/boss', 'bad'); return; }
  projectMessage('导入中…（每个文件都要抽知识点，可能要一会儿）', '');
  try {
    const payload = await projectApi({ action: 'import', dir: dir, prefix: prefix });
    const rows = payload.projects || [];
    projectMessage('导入完成：' + payload.files + ' 份 → ' + rows.length + ' 个项目'
      + (payload.failures && payload.failures.length ? '，失败 ' + payload.failures.length + ' 份' : ''), '');
    const box = $('projectResult');
    if (box) {
      box.innerHTML = '<div class="muted">按子目录建的项目：</div><ul>'
        + rows.map(function (row) {
          return '<li><strong>' + escapeText(row.name) + '</strong>：来源 ' + row.files + ' 份，命中 ' + row.knowledge + ' 次知识点（去重 ' + row.points.length + ' 个），草案题 ' + row.tasks + ' 道</li>';
        }).join('') + '</ul>';
    }
    renderProjectList(await api('/api/project'));
  } catch (err) {
    projectMessage('导入失败：' + err.message, 'bad');
  }
}

if ($('projectImportBtn')) $('projectImportBtn').addEventListener('click', runProjectImport);

// 按分类调研：文本框里用 `## 方向名` 分段，每段是一份或多份 JD（多份再用 --- 分隔）。
// 与 CLI survey --by-category、/api/survey groups 同一份 core/survey.mjs。
async function runFlowGroupSurvey() {
  const raw = $('flowJd') ? $('flowJd').value.trim() : '';
  const msg = $('flowCollectMsg');
  const blocks = raw.split(/^\s*##\s*/m).map(function (row) { return row.trim(); }).filter(Boolean);
  const first = raw.split(/^\s*##\s*/m)[0].trim();
  const groups = [];
  if (first) groups.push({ name: '未分组', texts: first.split(/^\s*-{3,}\s*$/m).map(function (row) { return row.trim(); }).filter(Boolean) });
  blocks.forEach(function (block) {
    const lines = block.split('\n');
    const name = (lines.shift() || '').trim();
    const texts = lines.join('\n').split(/^\s*-{3,}\s*$/m).map(function (row) { return row.trim(); }).filter(Boolean);
    if (name && texts.length) groups.push({ name: name, texts: texts });
  });
  if (groups.length < 2) { if (msg) msg.textContent = '至少两个方向：用一行 ## 方向名 分段。'; return; }
  if (msg) msg.textContent = '按 ' + groups.length + ' 个方向聚合中…';
  try {
    const payload = await api('/api/survey', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups: groups }) });
    const stats = payload.stats || {};
    if (msg) msg.textContent = '分方向调研完成：' + stats.groups + ' 个方向 / ' + stats.jobs + ' 份岗位；技术栈 ' + stats.terms + ' 项；共性 ' + stats.shared + '；专有 ' + stats.unique;
    const box = $('flowPack');
    if (box) {
      box.innerHTML = '<div class="row"><button class="ghost" id="groupSurveyCopy">复制分方向报告</button>'
        + '<span class="muted">矩阵数字=该方向有多少份岗位提到它；共性≈入场券，专有≈方向标识</span></div>'
        + '<textarea id="groupSurveyText" aria-label="分方向调研报告" rows="16" spellcheck="false"></textarea>';
      $('groupSurveyText').value = payload.markdown || '';
      $('groupSurveyCopy').addEventListener('click', function () {
        const area = $('groupSurveyText');
        area.select();
        try { document.execCommand('copy'); } catch (err) { /* 老浏览器 */ }
        $('groupSurveyCopy').textContent = '已复制';
      });
    }
  } catch (err) {
    if (msg) msg.textContent = '分方向调研失败：' + err.message;
  }
}

if ($('flowGroupSurveyBtn')) $('flowGroupSurveyBtn').addEventListener('click', runFlowGroupSurvey);

// 从 JD 生成练习清单：把岗位描述的技术点映射到题库已有的题（附原文依据），写成计划草案。
// 与 CLI `project jdplan`、接口 action=jdplan 同一份 core/jdplan.mjs。
if ($('ppJdPlanBtn')) $('ppJdPlanBtn').addEventListener('click', function () { if (ppSelected) runJdPlan(ppSelected); });

async function runJdPlan(name) {
  const box = $('ppJdPlanBox');
  if (!box) return;
  box.innerHTML = '<div class="muted">正在从岗位描述抽技术点并匹配题目…</div>';
  try {
    const payload = await projectApi({ action: 'jdplan', project: name, max: 10 });
    const plan = payload.plan || {};
    if (!plan.total) {
      box.innerHTML = '<div class="muted">这份岗位描述没有命中知识点（可能是纯销售/运营类岗位，或文本太短）。</div>';
      return;
    }
    box.innerHTML = '<div class="row"><strong>岗位描述 → 练习清单</strong>'
      + '<span class="muted">' + String(plan.sources) + ' 份来源　命中知识点 ' + String(plan.points.length) + ' 个　可练 ' + String(plan.total) + ' 道</span>'
      + '<button class="ghost" id="ppJdPlanDrill">按清单开练（' + String(plan.nextUp.length) + ' 道）</button></div>'
      + '<textarea id="ppJdPlanText" aria-label="岗位描述练习清单" rows="12" spellcheck="false"></textarea>';
    $('ppJdPlanText').value = plan.markdown || '';
    $('ppJdPlanDrill').addEventListener('click', function () {
      const ids = (plan.nextUp || []).map(function (row) { return row.taskId; });
      if (!ids.length) return;
      startDrillWith(ids);
      showPage('learn');
    });
    loadProjectPage();
  } catch (err) {
    box.innerHTML = '<div class="warn-text">生成失败：' + escapeText(err.message)
      + '　下一步：先确认这个项目收过带原文的来源（没有原文可跑 project backfill 补），再重试。</div>';
  }
}

// 语料检索：跨项目在来源原文里搜关键词（与 CLI corpus、GET /api/corpus 同一份 core/corpus.mjs）
async function runCorpusSearch() {
  const box = $('corpusHits');
  if (!box) return;
  const q = $('corpusQ') ? $('corpusQ').value.trim() : '';
  if (!q) { box.innerHTML = '<div class="muted">先输入关键词（多个词默认要求同一行都出现）。</div>'; return; }
  box.innerHTML = '<div class="muted">检索中…</div>';
  try {
    const any = $('corpusAny') && $('corpusAny').checked ? '&any=1' : '';
    const payload = await api('/api/corpus?q=' + encodeURIComponent(q) + '&limit=30' + any);
    const hits = payload.hits || [];
    let html = '<div class="muted">命中 ' + String(payload.total) + ' 行（显示前 ' + String(hits.length) + ' 行）；检索了 '
      + String(payload.scanned.sources) + ' 份来源约 ' + String(payload.scanned.chars) + ' 字'
      + (payload.scanned.withoutText ? ('；另有 ' + String(payload.scanned.withoutText) + ' 份来源没有原文，未参与检索') : '') + '</div>';
    if (!hits.length) {
      box.innerHTML = html + '<div class="muted">没有命中。换个词，或勾选「任一词命中」放宽。</div>';
      return;
    }
    html += '<div class="row">' + (payload.projects || []).map(function (row) {
      return '<span class="tag">' + escapeText(row.displayName) + ' ' + String(row.hits) + '</span>';
    }).join('') + '</div>';
    html += '<ul class="pp-plan">' + hits.map(function (row, index) {
      return '<li><a href="#" class="corpusOpen" data-project="' + escapeText(row.project) + '" data-source="' + String(row.sourceIndex) + '">'
        + escapeText(row.displayName) + ' · ' + escapeText(row.source) + ' · 第 ' + String(row.lineNo) + ' 行</a>'
        + '<div class="muted">' + escapeText(row.line) + '</div></li>';
    }).join('') + '</ul>';
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('.corpusOpen'), function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        const project = link.getAttribute('data-project');
        const index = Number(link.getAttribute('data-source'));
        showSourceText(project, index);
      });
    });
  } catch (err) {
    box.innerHTML = '<div class="warn-text">检索失败：' + escapeText(err.message)
      + '　下一步：确认服务端在跑（node src/web/server.mjs --port 8787）；关键词可先用单个词再逐步加。</div>';
  }
}

if ($('corpusBtn')) $('corpusBtn').addEventListener('click', runCorpusSearch);
if ($('corpusQ')) $('corpusQ').addEventListener('keydown', function (event) { if (event.key === 'Enter') runCorpusSearch(); });

// 刷新知识点：知识字典长大后，让老项目用上新增的知识点与题（重读原文 → 重算 → 重建索引）
if ($('ppRefreshPointsBtn')) {
  $('ppRefreshPointsBtn').addEventListener('click', async function () {
    if (!ppSelected) { $('ppMsg').textContent = '先在左边选一个项目。'; return; }
    $('ppMsg').textContent = '刷新知识点中…';
    try {
      const payload = await projectApi({ action: 'refresh', name: ppSelected });
      $('ppMsg').textContent = '刷新完成：' + String(payload.sources) + ' 条来源中 ' + String(payload.changed) + ' 条补到新知识点'
        + '（跳过 ' + String((payload.skipped || []).length) + ' 条）→ 知识点 ' + String(payload.points) + ' 个 / 可练题 ' + String(payload.tasks) + ' 道';
      loadProjectPage();
      if (ppSelected) { loadProjectSources(ppSelected); loadDrillPlan(ppSelected); }
    } catch (err) {
      $('ppMsg').textContent = '刷新失败：' + err.message + '　下一步：确认服务端在跑；老项目没有原文的可先跑 project backfill 补原文。';
    }
  });
}

// 数据体检：项目元数据 / 索引 / 原文 / 草案 / 记录是否自洽；修复只做能重算的事
async function runDoctor(fix) {
  const msg = $('doctorMsg');
  const box = $('doctorResult');
  if (msg) msg.textContent = fix ? '修复中…' : '体检中…';
  try {
    const payload = fix
      ? await api('/api/doctor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fix: true }) })
      : await api('/api/doctor');
    const stats = (fix ? payload.after : payload.stats) || {};
    if (msg) {
      msg.textContent = '发现 ' + String(stats.total) + ' 项（错误 ' + String(stats.errors) + ' / 提醒 ' + String(stats.warns) + '），可自动修 ' + String(stats.fixable) + ' 项'
        + (fix && payload.fixed && payload.fixed.length ? ('；本次修了 ' + String(payload.fixed.length) + ' 项') : '');
    }
    if (box) {
      box.innerHTML = '<textarea id="doctorText" aria-label="数据体检报告" rows="12" spellcheck="false"></textarea>';
      $('doctorText').value = payload.markdown || '';
    }
    if (fix) { if (typeof loadProjectPage === 'function') loadProjectPage(); if (jobsPanel && typeof jobsPanel.loadJobs === 'function') jobsPanel.loadJobs(); }
  } catch (err) {
    if (msg) msg.textContent = '体检失败：' + err.message + '　下一步：确认服务端在跑（node src/web/server.mjs --port 8787）。';
  }
}

if ($('doctorBtn')) $('doctorBtn').addEventListener('click', function () { runDoctor(false); });
if ($('doctorFixBtn')) $('doctorFixBtn').addEventListener('click', function () { runDoctor(true); });

// 掌握度：口径在 core/mastery.mjs，这里只渲染 + 提供「先练最弱那几道」
let masteryCache = null;
async function loadMastery() {
  const box = $('masteryBox');
  if (!box) return;
  box.innerHTML = '<div class="muted">正在计算…</div>';
  try {
    const payload = await api('/api/mastery?limit=5');
    const report = payload.report || {};
    masteryCache = report;
    const rows = report.weakest || [];
    if (!rows.length) { box.innerHTML = '<div class="muted">还没有可算的知识点。</div>'; return; }
    let html = '<div class="muted">有题的知识点 ' + String(report.withTasks) + ' 个，练过 ' + String(report.practiced) + ' 个</div>';
    html += '<ul class="pp-plan">' + rows.map(function (row) {
      return '<li><strong>' + escapeText(row.name) + '</strong>　' + String(row.passed) + '/' + String(row.total)
        + '　' + String(Math.round(row.mastery * 100)) + '%　<span class="tag">' + escapeText(row.level) + '</span>'
        + '<span class="muted">　' + escapeText(row.reason || '') + '</span></li>';
    }).join('') + '</ul>';
    if ((report.nextUp || []).length) {
      html += '<div class="muted">今天先练：' + report.nextUp.map(function (row) { return escapeText(row.id); }).join('、') + '</div>';
    }
    box.innerHTML = html;
  } catch (err) {
    box.innerHTML = '<div class="warn-text">算掌握度失败：' + escapeText(err.message) + '　下一步：确认服务端在跑。</div>';
  }
}

if ($('masteryBtn')) $('masteryBtn').addEventListener('click', loadMastery);
if ($('masteryDrillBtn')) {
  $('masteryDrillBtn').addEventListener('click', function () {
    const ids = ((masteryCache || {}).nextUp || []).map(function (row) { return row.id; });
    if (!ids.length) { loadMastery(); return; }
    startDrillWith(ids);
    showPage('learn');
  });
}

// 题包面板独立成 web/pack.mjs：依赖注入，避免与 app.mjs 循环 import
initPackPanel({ api: api, $: $, escapeText: escapeText });
