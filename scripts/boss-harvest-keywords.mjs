// 按关键词分类采集 BOSS 岗位：每类抓 N 份，**按分类原封不动**存到项目下。
//
//   node scripts/boss-harvest-keywords.mjs --port=9223 --out=docs/samples/boss --per=10 --delay=2600
//
// 设计取舍：
//   * 岗位描述（职位描述正文）原样保存，不改写、不摘要——它是后续调研与出题的原始素材；
//   * 每类一个子目录 docs/samples/boss/<分类>/，每份一个 .txt（含来源链接），并写 index.json；
//   * 节流（默认 2.6 秒/份）+ 逐类落盘：中途被验证码打断，已完成的部分照样可用；
//   * 关键词与目录名分开配置，目录用英文 slug，方便命令行使用。
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildSourceFile, detailReasonOf } from '../src/core/harvest.mjs';

export const CATEGORY_JOBS = [
  { slug: 'c-cpp', keyword: 'C++' },
  { slug: 'embedded', keyword: '嵌入式' },
  { slug: 'python', keyword: 'Python' },
  { slug: 'ai', keyword: 'AI' },
  { slug: 'ai-cn', keyword: '人工智能' },
  { slug: 'rust', keyword: 'Rust' },
  { slug: 'imaging', keyword: '图像处理' },
  { slug: 'yolo', keyword: 'YOLO' },
  { slug: 'machine-learning', keyword: '机器学习' },
  { slug: 'deep-learning', keyword: '深度学习' }
];

const args = {};
process.argv.slice(2).forEach(function (item) {
  const match = item.match(/^--([^=]+)=?(.*)$/);
  if (match) args[match[1]] = match[2] || true;
});
const port = Number(args.port) || 9223;
const outDir = String(args.out || 'docs/samples/boss');
const per = Math.max(1, Math.min(30, Number(args.per) || 10));
const delay = Math.max(1200, Number(args.delay) || 2600);
const only = args.only ? String(args.only).split(',').map(function (s) { return s.trim(); }) : null;

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function slugify(text) { return String(text || 'job').replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'job'; }

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

const CARD_JS = 'JSON.stringify(Array.from(document.querySelectorAll(\'a[href*="job_detail"]\')).map(function (a) {'
  + ' var card = a.closest("li") || a.parentElement;'
  + ' return { href: a.href.split("?")[0], text: (card ? card.innerText : a.innerText).replace(/\\s+/g, " ").trim().slice(0, 500) };'
  + ' }).filter(function (row) { return row.text.length > 15; }))';

const FIELD_JS = `JSON.stringify((function () {
  var pick = function (sel) { var el = document.querySelector(sel); return el ? el.innerText.replace(/\s+/g, " ").trim() : ""; };
  var bad = /补助|福利|聚餐|下午茶|奖金|体检|五险|全勤|期权|包吃|加班|假期|零食|团建/;
  var seen = {}; var tags = [];
  Array.from(document.querySelectorAll(".job-keyword-list li, .job-keyword-list span")).forEach(function (n) { var t = n.innerText.trim(); if (!t || bad.test(t) || seen[t]) return; seen[t] = 1; tags.push(t); });
  var cands = [".job-sec-text", ".job-detail-section", ".job-detail", "[class*=job-sec]", "[class*=job-detail]"];
  var best = "";
  cands.forEach(function (sel) {
    try { Array.from(document.querySelectorAll(sel)).forEach(function (el) { var t = el.innerText.trim(); if (t.length > best.length) best = t; }); } catch (e) {}
  });
  return {
    name: pick(".job-name") || pick(".name h1") || document.title,
    salary: pick(".salary"),
    city: pick(".text-city") || pick(".job-area"),
    exp: pick(".text-experience"),
    degree: pick(".text-degree"),
    company: pick(".company-info a") || pick(".company-name") || pick(".sider-company .name"),
    tags: tags,
    jd: best,
    url: location.href
  };
})())`;

// 展开「查看更多」：长描述会被折叠，不点开只抓到半截（实测 233 字就断）
const EXPAND_JS = `(function () { var more = Array.from(document.querySelectorAll('a, button, span, div')).filter(function (n) { return /查看更多|展开全文|展开/.test(n.innerText || '') && n.offsetParent; })[0]; if (more) { more.click(); return true; } return false; })()`;

async function main() {
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = targets.filter(function (row) { return row.type === 'page' && String(row.url).indexOf('zhipin.com') > -1; })[0];
  if (!page) { console.log('没找到已登录的 BOSS 标签页'); process.exit(3); }
  const client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  async function evaluate(expression) {
    const result = await client.send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('页面执行失败');
    return result.result ? result.result.value : null;
  }

  // 详情页经常先渲染骨架再填正文：轮询等它出现，而不是固定睡 700ms
  // （旧写法实测在反爬 / 慢网下直接抓到空正文，退化成「只有列表卡片」）
  async function waitDetail(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 8000);
    let last = {};
    for (;;) {
      try { last = JSON.parse((await evaluate(FIELD_JS)) || '{}'); } catch (err) { last = {}; }
      if (String(last.jd || '').length >= 40) return last;
      if (Date.now() > deadline) return last;
      await sleep(500);
    }
  }
  async function pageText() {
    try { return String((await evaluate('document.body ? document.body.innerText : ""')) || ''); } catch (err) { return ''; }
  }

  // --resume：只重抓详情缺失的条目（用 index.json 里记的详情链接），成功就覆盖原文件
  if (args.resume) {
    const indexPath = String(args.resume === true ? join(outDir, 'index.json') : args.resume);
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const dir = dirname(indexPath);
    const items = index.items || [];
    const todoResume = items.filter(function (row) { return !row.jdChars; });
    console.log('--resume：' + indexPath + ' 共 ' + items.length + ' 条，详情缺失 ' + todoResume.length + ' 条');
    let fixed = 0;
    for (const item of todoResume) {
      const url = item.detailUrl || item.url;
      if (!url) continue;
      await client.send('Page.navigate', { url: url });
      await sleep(delay);
      await evaluate(EXPAND_JS);
      const fields = await waitDetail(9000);
      const detail = String(fields.jd || '').trim();
      const reason = detailReasonOf(fields, await pageText());
      let cardText = '';
      try {
        const old = readFileSync(join(dir, item.file), 'utf8');
        const at = old.indexOf('（详情未取到，以下为列表卡片原文）');
        if (at > -1) cardText = old.slice(at).split(String.fromCharCode(10)).slice(1).join(String.fromCharCode(10)).trim();
      } catch (err) { cardText = ''; }
      const built = buildSourceFile({ title: item.title, categorySlug: index.category, keyword: index.keyword, listUrl: item.listUrl, detailUrl: url, jd: detail, cardText: cardText, fields: fields, reason: reason });
      writeFileSync(join(dir, item.file), built.text);
      item.jdChars = built.jdChars;
      item.detailReason = built.reason;
      item.detailUrl = url;
      if (built.jdChars >= 40) fixed += 1;
      console.log('   ' + item.file + ' → ' + (built.jdChars ? ('详情 ' + built.jdChars + ' 字') : ('仍失败：' + reason)));
    }
    writeFileSync(indexPath, JSON.stringify(index, null, 2));
    console.log('--resume 完成：修好 ' + fixed + ' / ' + todoResume.length + ' 条');
    return;
  }

  const categories = only ? CATEGORY_JOBS.filter(function (row) { return only.indexOf(row.slug) > -1; }) : CATEGORY_JOBS;
  const summary = [];
  for (const category of categories) {
    const dir = join(outDir, category.slug);
    mkdirSync(dir, { recursive: true });
    const listUrl = 'https://www.zhipin.com/web/geek/jobs?query=' + encodeURIComponent(category.keyword);
    await sleep(2500);
    await client.send('Page.navigate', { url: listUrl });
    await sleep(5000);
    async function grabCards() {
      try { return JSON.parse((await evaluate(CARD_JS)) || '[]'); } catch (err) { return []; }
    }
    let cards = await grabCards();
    if (!cards.length) {
      // 实测：直接拼 ?query= 的链接会被 BOSS 降级到通用招聘页（9 类里有 5 类这样）。
      // 回退到走站内搜索框：更像真人操作，命中率也高得多。
      await client.send('Page.navigate', { url: 'https://www.zhipin.com/web/geek/jobs' });
      await sleep(4500);
      const typed = await evaluate('(function () {'
        + ' var box = document.querySelector(\'input[type=search], .search-input input, input[placeholder*=搜索], .ipt-search\');'
        + ' if (!box) return false;'
        + ' box.focus();'
        + ' var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, \'value\').set;'
        + ' setter.call(box, ' + JSON.stringify(category.keyword) + ');'
        + ' box.dispatchEvent(new Event(\'input\', { bubbles: true }));'
        + ' box.dispatchEvent(new KeyboardEvent(\'keydown\', { key: \'Enter\', keyCode: 13, bubbles: true }));'
        + ' box.dispatchEvent(new KeyboardEvent(\'keyup\', { key: \'Enter\', keyCode: 13, bubbles: true }));'
        + ' var form = box.closest(\'form\'); if (form) { try { form.requestSubmit ? form.requestSubmit() : form.submit(); } catch (e) {} }'
        + ' return true; })()');
      await sleep(6500);
      cards = await grabCards();
      console.log('   （直链没结果，改用站内搜索框：' + (typed ? '已输入' : '没找到搜索框') + '，得到 ' + cards.length + ' 条）');
    }
    const seen = new Set();
    const picked = [];
    cards.forEach(function (row) {
      if (seen.has(row.href)) return;
      seen.add(row.href);
      picked.push(row);
    });
    const todo = picked.slice(0, per);
    console.log('[ ' + category.slug + ' ] 关键词「' + category.keyword + '」列表解析到 ' + picked.length + ' 条，取前 ' + todo.length + ' 条');
    if (!todo.length) {
      const blocked = await evaluate('document.body.innerText.indexOf("验证") > -1 ? "验证页" : document.title');
      console.log('   （列表没解析出岗位，页面状态：' + String(blocked).slice(0, 40) + '）');
      summary.push({ category: category.slug, keyword: category.keyword, saved: 0, note: '列表未解析出岗位' });
      continue;
    }
    const index = [];
    for (let i = 0; i < todo.length; i += 1) {
      await client.send('Page.navigate', { url: todo[i].href });
      await sleep(delay);
      // BOSS 会把长描述折叠：先点开再看，否则抓到的是半截（实测 233 字就断了）
      await evaluate(EXPAND_JS);
      let fields = await waitDetail(9000);
      // 详情页第一次经常只给出骨架：再导航一次重试（实测能救回一部分）
      if (String(fields.jd || '').length < 40) {
        await client.send('Page.navigate', { url: todo[i].href });
        await sleep(delay);
        await evaluate(EXPAND_JS);
        fields = await waitDetail(9000);
      }
      const detail = String(fields.jd || '').trim();
      const title = String(fields.name || todo[i].text.slice(0, 30));
      const file = String(i + 1).padStart(2, '0') + '-' + slugify(title) + '.txt';
      const reason = detailReasonOf(fields, await pageText());
      // 文件头统一由 core 组装：字段用页面选择器 + 解析器 + 卡片三层兜底，
      // 并把「详情页链接」「抓取状态」写进去——这样事后能 --resume 重抓（旧文件没这两项，抓不回来）。
      const built = buildSourceFile({
        title: title, categorySlug: category.slug, keyword: category.keyword,
        listUrl: listUrl, detailUrl: todo[i].href, jd: detail, cardText: todo[i].text,
        fields: fields, reason: reason
      });
      writeFileSync(join(dir, file), built.text);
      index.push({
        file: file, title: title, url: fields.url || todo[i].href, detailUrl: todo[i].href, listUrl: listUrl,
        jdChars: built.jdChars, detailReason: built.reason,
        company: built.company, city: built.city, salary: built.salary, tags: fields.tags || []
      });
      console.log('   已存 ' + category.slug + '/' + file + '（' + (built.jdChars ? ('详情 ' + built.jdChars + ' 字') : ('只有卡片：' + built.reason)) + '）');
    }
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ at: new Date().toISOString(), category: category.slug, keyword: category.keyword, count: index.length, items: index }, null, 2));
    summary.push({ category: category.slug, keyword: category.keyword, saved: index.length });
  }
  writeFileSync(join(outDir, 'categories.json'), JSON.stringify({ at: new Date().toISOString(), per: per, categories: summary }, null, 2));
  console.log('');
  console.log('分类采集完成：');
  summary.forEach(function (row) { console.log('  ' + row.category + '（' + row.keyword + '）：' + row.saved + ' 份' + (row.note ? '　' + row.note : '')); });
  client.close();
}

main().catch(function (err) { console.error('采集失败：' + err.message); process.exit(1); });
