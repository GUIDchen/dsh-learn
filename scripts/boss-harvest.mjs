// BOSS 岗位采集器：借用"已经登录且开着调试端口"的 Chrome，把人看得到的岗位列表与详情落成语料。
//
// 为什么要写成工具：
//   1. BOSS 对非浏览器请求是 JS 壳 + 安全验证（实测 curl 只拿到 9KB 的"请稍候"页），服务端抓不动；
//   2. 用户已经在浏览器里登录，**用他的会话**是最省事也最合规的做法（不碰账号密码，不绕验证码）；
//   3. 采集是节流的（默认每页停 2.5 秒、一次最多 8 条），目的是调研，不是批量搬运。
//
// 用法：
//   node scripts/boss-harvest.mjs --port=9223 --out=docs/samples/boss --limit=8 [--list-url=<列表页>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = {};
process.argv.slice(2).forEach(function (item) {
  const match = item.match(/^--([^=]+)=?(.*)$/);
  if (match) args[match[1]] = match[2] || true;
});
const port = Number(args.port) || 9223;
const outDir = String(args.out || 'docs/samples/boss');
const limit = Math.max(1, Math.min(30, Number(args.limit) || 8));
const delay = Math.max(800, Number(args.delay) || 2500);

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function targets() {
  const res = await fetch('http://127.0.0.1:' + port + '/json/list');
  return res.json();
}

function connect(url) {
  return new Promise(function (resolve) {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', function () {
      resolve({
        send: function (method, params) {
          id += 1;
          const current = id;
          ws.send(JSON.stringify({ id: current, method: method, params: params || {} }));
          return new Promise(function (res) { pending.set(current, res); });
        },
        close: function () { ws.close(); }
      });
    });
    ws.addEventListener('message', function (event) {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg.error || {}); pending.delete(msg.id); }
    });
  });
}

async function main() {
  const list = await targets();
  const page = list.filter(function (row) { return row.type === 'page' && String(row.url).indexOf('zhipin.com') > -1; })[0];
  if (!page) {
    console.log('没有找到已登录的 BOSS 标签页。请用一个带 --remote-debugging-port=9223 的窗口打开 BOSS 并登录。');
    process.exit(3);
  }
  const client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  async function evaluate(expression) {
    const result = await client.send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('页面里执行失败：' + JSON.stringify(result.exceptionDetails).slice(0, 200));
    return result.result ? result.result.value : null;
  }

  if (args['list-url']) {
    await client.send('Page.navigate', { url: String(args['list-url']) });
    await sleep(4000);
  }
  console.log('当前页面：' + await evaluate('location.href'));

  // BOSS 的列表卡片 class 换过几次，这里按"能找到岗位详情链接"来兜底
  const extractList = 'JSON.stringify(Array.from(document.querySelectorAll(\'a[href*="job_detail"]\')).map(function (a) {'
    + ' var card = a.closest("li") || a.parentElement;'
    + ' return { href: a.href, text: (card ? card.innerText : a.innerText).replace(/\\s+/g, " ").trim().slice(0, 400) };'
    + ' }).filter(function (row) { return row.text.length > 20; }))';
  const raw = await evaluate(extractList);
  const cards = JSON.parse(raw || '[]');
  const unique = [];
  const seen = new Set();
  cards.forEach(function (row) {
    const key = row.href.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    unique.push({ href: key, text: row.text });
  });
  console.log('列表里解析出岗位 ' + unique.length + ' 条');
  if (!unique.length) {
    console.log('（页面上没有岗位卡片：可能还没登录、或停在验证页。请在那个窗口里确认能看到岗位列表。）');
    client.close();
    process.exit(4);
  }

  mkdirSync(outDir, { recursive: true });
  const index = [];
  const picked = unique.slice(0, limit);
  for (let i = 0; i < picked.length; i += 1) {
    const card = picked[i];
    await client.send('Page.navigate', { url: card.href });
    await sleep(delay);
    // 只取岗位相关字段：整页 innerText 里混着导航/公司简介/福利标签，
    // 直接喂给提取器会把 HTTP、公司名之类也算成技术栈（实测踩过）。
    const fieldsExpr = 'JSON.stringify((function () {'
      + ' var pick = function (sel) { var el = document.querySelector(sel); return el ? el.innerText.replace(/\\s+/g, \' \').trim() : \'\'; };'
      + ' var bad = /补助|福利|聚餐|下午茶|奖金|体检|五险|全勤|期权|包吃|加班|假期|零食|团建/;'
      + ' var seen = {}; var tags = [];'
      + ' Array.from(document.querySelectorAll(\'.job-keyword-list li, .job-keyword-list span\')).forEach(function (n) { var t = n.innerText.trim(); if (!t || bad.test(t) || seen[t]) return; seen[t] = 1; tags.push(t); });'
      + ' return {'
      + ' name: pick(\'.job-name\') || pick(\'.name h1\') || document.title,'
      + ' salary: pick(\'.salary\'),'
      + ' city: pick(\'.text-city\') || pick(\'.job-area\'),'
      + ' exp: pick(\'.text-experience\'),'
      + ' degree: pick(\'.text-degree\'),'
      + ' company: pick(\'.company-info a\') || pick(\'.company-name\') || pick(\'.sider-company .name\'),'
      + ' tags: tags,'
      + ' jd: pick(\'.job-sec-text\') || pick(\'.job-detail-section .text\') || pick(\'[class*="job-sec"]\'),'
      + ' url: location.href'
      + ' };'
      + '})())';
    const raw = await evaluate(fieldsExpr);
    const fields = JSON.parse(raw || '{}');
    const detail = String(fields.jd || '');
    const at = String(fields.url || '');
    const title = String(fields.name || '');
    const isJob = at.indexOf('/job_detail/') > -1 && (detail.length > 20 || (fields.tags || []).length > 0);
    if (!isJob) {
      console.log('  跳过非岗位详情：' + title.slice(0, 30));
      continue;
    }
    // 规范化成"干净的岗位要求"：招聘信息 + 技能标签 + 职位描述（丢掉导航/福利/公司简介）
    const detailText = [
      title,
      '',
      [fields.company, fields.city, fields.salary, fields.exp, fields.degree].filter(Boolean).join('　'),
      '',
      '技能标签：' + (fields.tags || []).join('、'),
      '',
      '职位描述',
      detail
    ].join('\n');
    const slug = 'boss-' + String(i + 1).padStart(2, '0') + '-' + String(title || 'job').replace(/[^\w\u4e00-\u9fa5]+/g, '-').slice(0, 40);
    const body = ['# ' + title, '', '来源：' + at, '', detailText].join('\n');
    writeFileSync(join(outDir, slug + '.txt'), body);
    index.push({ file: slug + '.txt', url: at, title: title, company: fields.company || '', city: fields.city || '', salary: fields.salary || '', tags: fields.tags || [], jdChars: detail.length });
    console.log('  已存 ' + slug + '.txt（' + body.length + ' 字）');
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ at: new Date().toISOString(), port: port, count: index.length, items: index }, null, 2));
  console.log('完成：' + index.length + ' 份岗位 → ' + outDir);
  console.log('下一步：node src/cli.mjs survey --dir=' + outDir + ' --out=调研.md');
  client.close();
}

main().catch(function (err) {
  console.error('采集失败：' + err.message);
  process.exit(1);
});
