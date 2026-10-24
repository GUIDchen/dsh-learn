// 浏览器层端到端：真开一个 headless Chrome，把三个页面走一遍。
//
// 为什么要入库这条：前 8 轮我每轮都手写一个 /tmp/cdp-*.mjs 冒烟脚本，问题是
//   1) 没进仓库、没进 CI，别人复现不了；2) 跑完不清理，实测攒下 52 个 Chrome 进程，
//      把「真实执行」类用例拖到假失败（第 37 轮 verify 就因此红了一次）。
// 这条脚本自己负责：起服务、开浏览器、跑场景、**无论成败都收尾**（浏览器/服务/临时 profile）。
//
// 用法：node scripts/e2e-web.mjs [--keep]（--keep 保留临时目录便于排查）
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEEP = process.argv.indexOf('--keep') > -1;

if (!existsSync(CHROME)) {
  console.log('跳过：这台机器没有 Google Chrome（浏览器层端到端需要它）');
  process.exit(0);
}

const home = mkdtempSync(join(tmpdir(), 'dsh-e2e-web-'));
const profile = join(home, 'chrome-profile');
const logFile = join(home, 'server.log');
const trace = [];
let step = 0;
let server = null;
let chrome = null;
let client = null;

function check(label, ok, detail) {
  step += 1;
  trace.push((ok ? 'PASS  ' : 'FAIL  ') + String(step).padStart(2, '0') + '. ' + label + (ok ? '' : ('　← ' + String(detail || ''))));
  if (!ok) {
    console.log(trace.join(String.fromCharCode(10)));
    console.log('浏览器层端到端失败：' + label + '（' + detail + '）');
    if (KEEP) console.log('临时目录保留在：' + home);
    cleanup();
    process.exit(1);
  }
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function cleanup() {
  try { if (client) client.close(); } catch (err) { /* 已关 */ }
  try { if (chrome && !chrome.killed) chrome.kill('SIGKILL'); } catch (err) { /* 已退 */ }
  try { if (server && !server.killed) server.kill('SIGKILL'); } catch (err) { /* 已退 */ }
  if (!KEEP) { try { rmSync(home, { recursive: true, force: true }); } catch (err) { /* 尽力 */ } }
}

// 起服务：随机端口（--port 0），从 stdout 解析真实地址（与 scripts/e2e-api.mjs 同一约定）
server = spawn(process.execPath, [join(ROOT, 'src/web/server.mjs'), '--host', '127.0.0.1', '--port', '0'], {
  env: Object.assign({}, process.env, { DSH_LEARN_HOME: home }),
  stdio: ['ignore', 'pipe', 'pipe']
});
const buffered = { text: '' };
let logText = '';
server.stdout.on('data', function (chunk) { buffered.text += String(chunk); logText += String(chunk); });
server.stderr.on('data', function (chunk) { logText += String(chunk); });
let base = '';
for (let i = 0; i < 60 && !base; i += 1) {
  await sleep(200);
  const hit = buffered.text.match(/DSH_LEARN_URL=(\S+)/);
  if (hit) base = hit[1].replace(/\/$/, '');
}
if (!base) {
  console.log('起服务失败：' + logText.slice(-400));
  cleanup();
  process.exit(1);
}

// 播种：项目页要有一个项目 + 一条来源（只用临时 home，不碰真实数据）
const seedInit = await fetch(base + '/api/project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'init', name: 'e2e-web' }) }).then(function (r) { return r.json(); }).catch(function (e) { return { error: String(e.message) }; });
const seedAdd = await fetch(base + '/api/project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'e2e-web', kind: 'text', text: '招聘 Go 工程师：熟悉 docker build 与 kubectl，会用 git rebase' }) }).then(function (r) { return r.json(); }).catch(function (e) { return { error: String(e.message) }; });
check('临时环境里能建项目并收一条来源', Boolean(seedInit && seedInit.project) && Boolean(seedAdd && seedAdd.knowledge), JSON.stringify(seedInit).slice(0, 120) + ' / ' + JSON.stringify(seedAdd).slice(0, 120));

// 开浏览器：CDP 端口交给 Chrome 自己挑，从 DevToolsActivePort 读回来
chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--disable-gpu', 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });
let cdpPort = '';
const portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 60 && !cdpPort; i += 1) {
  await sleep(200);
  if (existsSync(portFile)) {
    try { cdpPort = String(readFileSync(portFile, 'utf8')).split(String.fromCharCode(10))[0].trim(); } catch (err) { cdpPort = ''; }
  }
}
check('headless Chrome 起来了（CDP 端口自动发现）', Boolean(cdpPort), '没读到 DevToolsActivePort');

const targets = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
const page = targets.filter(function (t) { return t.type === 'page'; })[0];
check('拿到浏览器标签页', Boolean(page && page.webSocketDebuggerUrl), JSON.stringify(targets).slice(0, 160));

// 极简 CDP 客户端：只用到 Runtime/Network/Page 几个命令
client = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(function (resolve, reject) { client.addEventListener('open', resolve); client.addEventListener('error', reject); });
let msgId = 0;
const pending = new Map();
const errors = [];
const modules = [];
client.addEventListener('message', function (event) {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails || {};
    errors.push(String((d.exception && d.exception.description) || d.text || '').slice(0, 160));
  }
  if (msg.method === 'Network.responseReceived') {
    const url = String(msg.params.response.url || '');
    if (url.indexOf('.mjs') > -1) modules.push({ url: url.replace(base, ''), status: msg.params.response.status });
  }
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || {}); pending.delete(msg.id); }
});
function send(method, params) {
  msgId += 1;
  const id = msgId;
  client.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  return new Promise(function (resolve) { pending.set(id, resolve); });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) return { error: String(result.exceptionDetails.text || '页面抛错') };
  return { value: result.result ? result.result.value : undefined };
}
async function evaluateValue(expression) {
  const out = await evaluate(expression);
  return out.error ? ('(抛错: ' + out.error + ')') : out.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.setBypassServiceWorker', { bypass: true });

// —— 场景 1：学习页 ——
await send('Page.navigate', { url: base + '/#page=' });
await sleep(1500);
await send('Page.reload', { ignoreCache: true });
// 固定 sleep 在慢机器上不够（GitHub runner 上 3.5s 时列表还是空的）：轮询到有题目为止，最多 20 秒
let taskCount = 0;
const listDeadline = Date.now() + 20000;
while (Date.now() < listDeadline) {
  taskCount = await evaluateValue("document.querySelectorAll('#taskList button, #taskList li').length");
  if (Number(taskCount) > 0) break;
  await sleep(400);
}
check('学习页：题目列表渲染出来了', Number(taskCount) > 0, '列表条数=' + taskCount);
const panels = ['/app.mjs', '/jobs.mjs', '/panels.mjs'];
const loaded = panels.filter(function (name) { return modules.some(function (m) { return m.url === name && m.status === 200; }); });
check('学习页：拆出去的模块全部 200（app/jobs/panels）', loaded.length === panels.length, JSON.stringify(modules.slice(0, 6)));
await evaluate("(function () { var rows = document.querySelectorAll('#taskList button, #taskList li'); if (rows[0]) rows[0].click(); })()");
await sleep(1200);
await evaluate("(function () { var el = document.querySelector('#answer'); if (!el) return; el.value = 'git --version'; el.dispatchEvent(new Event('input', { bubbles: true })); var btn = document.querySelector('#checkBtn'); if (btn) btn.click(); })()");
await sleep(3000);
const resultText = String(await evaluateValue("(function () { var el = document.querySelector('#result'); return el ? el.textContent.replace(/\\s+/g, ' ') : ''; })()"));
check('学习页：提交判定后结果区有内容', resultText.length > 4, resultText.slice(0, 120));
const onboardingText = String(await evaluateValue("(function () { var el = document.querySelector('#onboardingBox'); return el ? el.textContent.trim() : ''; })()"));
check('学习页：首次运行引导卡片有内容（六步走到哪 + 下一步）', onboardingText.length > 4, onboardingText.slice(0, 100));
check('学习页：掌握度面板在', Boolean(await evaluateValue("!!document.querySelector('#masteryBox')")), '缺 #masteryBox');

// —— 场景 2：项目页（来源挂在项目下方 + 右侧结构化详情）——
await send('Page.navigate', { url: base + '/#page=projects' });
await sleep(3000);
await evaluate("var b = document.querySelector('#projectListBtn'); if (b) b.click();");
await sleep(1800);
const itemCount = Number(await evaluateValue("document.querySelectorAll('.pp-item').length"));
check('项目页：项目行渲染出来了', itemCount > 0, '项目行=' + itemCount);
await evaluate("(function () { var t = document.querySelector('.pp-sources-toggle'); if (t) t.click(); })()");
await sleep(1800);
const sourceCount = Number(await evaluateValue("document.querySelectorAll('.pp-sources .ppSource').length"));
check('项目页：展开项目后能看到它的来源', sourceCount > 0, '来源条数=' + sourceCount);
await evaluate("(function () { var s = document.querySelector('.pp-sources .ppSource'); if (s) s.click(); })()");
await sleep(2000);
check('项目页：点来源后右侧出现结构化详情（字段表）', Boolean(await evaluateValue("!!document.querySelector('#ppSourceText table.kv')")), '缺字段表');
check('项目页：详情里带原文折叠', Boolean(await evaluateValue("!!document.querySelector('#ppSourceText details')")), '缺原文折叠');

// —— 场景 3：投递页 ——
await send('Page.navigate', { url: base + '/#page=jobs' });
await sleep(2500);
const jobStats = String(await evaluateValue("(function () { var el = document.querySelector('#jobStats'); return el ? el.textContent.trim() : ''; })()"));
check('投递页：状态行有内容', jobStats.length > 0, jobStats.slice(0, 80));
const followText = String(await evaluateValue("(function () { var el = document.querySelector('#jobFollow'); return el ? el.textContent.trim() : ''; })()"));
check('投递页：待跟进区有内容', followText.length > 0, followText.slice(0, 80));

// —— 场景 4：命令面板（⌘K）——
await send('Page.navigate', { url: base + '/#page=' });
await sleep(2500);
await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))");
await sleep(700);
check('命令面板：⌘K 能打开', Boolean(await evaluateValue("!!document.querySelector('#palette') && document.querySelector('#palette').style.display === 'flex'")), '面板没打开');
await evaluate("(function () { var el = document.querySelector('#paletteInput'); if (el) { el.value = '备份'; el.dispatchEvent(new Event('input', { bubbles: true })); } })()");
await sleep(500);
const paletteHits = String(await evaluateValue("(function () { var box = document.querySelector('#paletteList'); return box ? box.textContent : ''; })()"));
check('命令面板：输入关键词能筛出命令', paletteHits.indexOf('备份') > -1, paletteHits.slice(0, 80));
await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
await sleep(400);
check('命令面板：Esc 能关掉', Boolean(await evaluateValue("document.querySelector('#palette').style.display === 'none'")), '面板没关掉');
// —— 场景 5：深色模式（点切换按钮 → html[data-theme] 变深 → 偏好写回服务端）——
const beforeTheme = String(await evaluateValue("document.documentElement.getAttribute('data-theme')"));
await evaluate("(function () { var b = document.getElementById('themeToggle'); if (b) b.click(); })()");
await sleep(900);
const afterTheme = String(await evaluateValue("document.documentElement.getAttribute('data-theme')"));
check('深色模式：点切换按钮能改变外观', beforeTheme !== afterTheme && ['dark', 'light'].indexOf(afterTheme) > -1, beforeTheme + ' → ' + afterTheme);
const prefsAfter = await (await fetch(base + '/api/prefs')).json();
check('深色模式：偏好写回三端共用的 preferences', Boolean(prefsAfter && prefsAfter.prefs && prefsAfter.prefs.theme && prefsAfter.prefs.theme !== 'auto'), JSON.stringify(prefsAfter));
// —— 场景 6：移动端视口（390×844）——
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(1200);
const overflow = Number(await evaluateValue("document.documentElement.scrollWidth - window.innerWidth"));
check('移动端：390 宽下没有横向溢出', overflow <= 2, '横向溢出 ' + overflow + 'px');
const tracks = String(await evaluateValue("getComputedStyle(document.querySelector('.layout')).gridTemplateColumns"));
check('移动端：三栏塌成一栏', tracks.split(' ').length === 1, '列轨道：' + tracks);
// 再显式切到宽视口：断点要能双向生效（headless 默认窗口本身很窄，不能靠 clear 来代表宽屏）
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(900);
const tracksWide = String(await evaluateValue("getComputedStyle(document.querySelector('.layout')).gridTemplateColumns"));
check('移动端：切回 1280 宽后恢复多栏', tracksWide.split(' ').length > 1, '列轨道：' + tracksWide);
await send('Emulation.clearDeviceMetricsOverride');
// —— 场景 7：UI 层 i18n（切英文 → 界面文案变英文 → 偏好写回 → 切回中文）——
const beforeSummary = String(await evaluateValue("(function () { var el = document.getElementById('onboardingSummary'); return el ? el.textContent : ''; })()"));
await evaluate("(function () { var b = document.getElementById('langToggle'); if (b) b.click(); })()");
await sleep(1200);
const afterSummary = String(await evaluateValue("(function () { var el = document.getElementById('onboardingSummary'); return el ? el.textContent : ''; })()"));
const buttonText = String(await evaluateValue("(function () { var b = document.getElementById('langToggle'); return b ? b.textContent : ''; })()"));
check('i18n：切英文后界面文案变英文', afterSummary === 'Start here' && beforeSummary !== afterSummary, beforeSummary + ' → ' + afterSummary + '（按钮：' + buttonText + '）');
const prefsLang = await (await fetch(base + '/api/prefs')).json();
check('i18n：语言偏好写回三端共用的 preferences', Boolean(prefsLang && prefsLang.prefs && prefsLang.prefs.lang === 'en'), JSON.stringify(prefsLang));
await evaluate("(function () { var b = document.getElementById('langToggle'); if (b) b.click(); })()");
await sleep(1000);
const backSummary = String(await evaluateValue("(function () { var el = document.getElementById('onboardingSummary'); return el ? el.textContent : ''; })()"));
check('i18n：再点一次切回中文', backSummary === '从这里开始' && backSummary !== 'Start here', backSummary);
// —— 场景 8：进度趋势卡片（柱状图 + 下载按钮）——
const trendBars = Number(await evaluateValue("document.querySelectorAll('#trendBox rect').length"));
check('趋势：右栏出现柱状图（有练习记录就有柱子）', trendBars > 0, '柱子数=' + trendBars);
check('趋势：卡片带成绩单下载按钮', Boolean(await evaluateValue("!!document.getElementById('trendDownload')")), '缺下载按钮');
// —— 场景 9：目标提醒条 ——
const reminderText = String(await evaluateValue("(function () { var el = document.getElementById('reminderBar'); return el ? el.textContent.trim() : ''; })()"));
check('目标提醒：页面顶部出现提醒条且有文字', reminderText.length > 4, reminderText.slice(0, 90));
check('全程没有页面异常（Runtime.exceptionThrown = 0）', errors.length === 0, JSON.stringify(errors.slice(0, 2)));

console.log(trace.join(String.fromCharCode(10)));
console.log('浏览器层端到端通过：' + step + ' 步全过（临时环境 + 随机端口 + 自动清理）');
cleanup();
process.exit(0);
