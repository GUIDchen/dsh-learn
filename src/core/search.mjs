// 搜索与资料收集：先搜（不依赖任何 API key），再把命中的页面抓回来解析成知识点与题目。
//
// 为什么多引擎 + 依次回退：实测本环境里 html.duckduckgo.com 连不上（curl 000），
// 而 www.bing.com/search 正常（200 / 98KB / 6 条 b_algo）。只押一个引擎，用户换个网络就废了。
// 默认引擎顺序 bing → duckduckgo；也可以用 DSH_LEARN_SEARCH_ENDPOINT 指向自建端点（engine=custom）。
import { analyzeText } from './knowledge.mjs';
import { buildDraftPack } from './site-learn.mjs';
import { decodeEntities, detectBlockedPage, fetchText } from './ingest.mjs';   // 实体解码与抓页共用同一份（含 hex 实体）

// HTTP 头只能是 ASCII：这里不要写中文
export const SEARCH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
export const SEARCH_LIMIT_MAX = 20;
export const ENGINES = ['bing', 'duckduckgo', 'custom'];

export const ENGINE_TEMPLATES = {
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://html.duckduckgo.com/html/?q=',
  custom: ''
};

export function searchEndpoint(engine, options) {
  const opts = options || {};
  const name = engine || opts.engine || 'bing';
  if (name === 'custom') return opts.endpoint || process.env.DSH_LEARN_SEARCH_ENDPOINT || '';
  return opts.endpoint || ENGINE_TEMPLATES[name] || ENGINE_TEMPLATES.bing;
}

function stripTags(text) {
  return decodeEntities(String(text || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// DuckDuckGo 的结果链接是跳转链：//duckduckgo.com/l/?uddg=<urlencoded>&rut=…
// 不还原就会把站内跳转当地址存进项目，之后再抓取只会 404。
export function unwrapResultUrl(href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  const withProtocol = raw.indexOf('//') === 0 ? 'https:' + raw : raw;
  try {
    const url = new URL(withProtocol, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    if (target) return target;
    if (url.hostname.endsWith('duckduckgo.com') && url.pathname === '/l/') {
      const other = url.searchParams.get('u') || '';
      if (other) return other;
    }
    return url.href;
  } catch (err) {
    return raw;
  }
}

// Bing：<li class="b_algo">…<h2><a href="…">标题</a>…<p>摘要</p>
export function parseBingResults(html, options) {
  const opts = options || {};
  const limit = Math.max(1, Math.min(SEARCH_LIMIT_MAX, Number(opts.limit) || 8));
  const rows = [];
  const seen = new Set();
  const blockRe = /<li class="b_algo"[\s\S]{0,4000}?<\/li>/g;
  const blocks = String(html || '').match(blockRe) || [];
  blocks.forEach(function (block) {
    if (rows.length >= limit) return;
    const title = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!title) return;
    const url = unwrapResultUrl(title[1]);
    if (!/^https?:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    rows.push({
      url: url,
      title: stripTags(title[2]).slice(0, 160),
      snippet: snippet ? stripTags(snippet[1]).slice(0, 300) : '',
      engine: 'bing'
    });
  });
  return rows;
}

// DuckDuckGo HTML 端点：result__a / result__snippet
export function parseDuckDuckGoResults(html, options) {
  const opts = options || {};
  const limit = Math.max(1, Math.min(SEARCH_LIMIT_MAX, Number(opts.limit) || 8));
  const text = String(html || '');
  const rows = [];
  const seen = new Set();
  const blockRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1200}?)(?=<a[^>]+class="[^"]*result__a|$)/g;
  let hit;
  while ((hit = blockRe.exec(text))) {
    const url = unwrapResultUrl(hit[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const snippetMatch = hit[3].match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    rows.push({
      url: url,
      title: stripTags(hit[2]).slice(0, 160),
      snippet: snippetMatch ? stripTags(snippetMatch[1]).slice(0, 300) : '',
      engine: 'duckduckgo'
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

// 兜底：任何 <a href="http…"> + 锚文本（自建端点只给链接也能用）
export function parseGenericResults(html, options) {
  const opts = options || {};
  const limit = Math.max(1, Math.min(SEARCH_LIMIT_MAX, Number(opts.limit) || 8));
  const rows = [];
  const seen = new Set();
  const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let hit;
  while ((hit = linkRe.exec(String(html || '')))) {
    const url = unwrapResultUrl(hit[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    const title = stripTags(hit[2]).slice(0, 160);
    if (!title) continue;
    seen.add(url);
    rows.push({ url: url, title: title, snippet: '', engine: 'generic' });
    if (rows.length >= limit) break;
  }
  return rows;
}

// 按引擎选解析器；默认引擎解析不出东西时（页面结构变了）退回兜底解析，而不是空手而归
export function parseSearchResults(html, options) {
  const opts = options || {};
  const engine = opts.engine || 'bing';
  if (engine === 'bing') {
    const rows = parseBingResults(html, opts);
    return rows.length ? rows : parseGenericResults(html, opts);
  }
  if (engine === 'duckduckgo') {
    const rows = parseDuckDuckGoResults(html, opts);
    return rows.length ? rows : parseGenericResults(html, opts);
  }
  return parseGenericResults(html, opts);
}

async function runEngine(engine, query, options) {
  const opts = options || {};
  const doFetch = opts.fetch || fetch;
  const endpoint = searchEndpoint(engine, opts);
  if (!endpoint) return { ok: false, engine: engine, reason: '引擎 ' + engine + ' 没有端点：自建引擎请设 DSH_LEARN_SEARCH_ENDPOINT' };
  if (opts.endpoint && engine !== 'custom') {
    // 显式给了端点：不管叫什么引擎，都按给定端点请求
  }
  const url = endpoint + (endpoint.indexOf('?') > -1 ? '&' : '?') + 'q=' + encodeURIComponent(query);
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, opts.timeout || 15000);
  try {
    const res = await doFetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': SEARCH_UA, accept: 'text/html,application/xhtml+xml' }
    });
    const html = await res.text();
    if (res.status !== 200) {
      return { ok: false, engine: engine, status: res.status, endpoint: endpoint, reason: 'HTTP ' + res.status + '：' + endpoint };
    }
    const blocked = detectBlockedPage(html.replace(/<[^>]+>/g, ' '), html);
    if (blocked) {
      return {
        ok: false,
        engine: engine,
        blocked: true,
        endpoint: endpoint,
        markers: blocked.markers,
        reason: '返回的是验证页 / JS 壳（命中：' + blocked.markers.join('、') + '）'
      };
    }
    const results = parseSearchResults(html, Object.assign({}, opts, { engine: engine }));
    if (!results.length) {
      return { ok: false, engine: engine, endpoint: endpoint, reason: '结果页里没解析出链接（页面结构可能变了，或关键词太窄）' };
    }
    return { ok: true, engine: engine, endpoint: endpoint, results: results, total: results.length };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || /aborted/i.test(err.message || ''));
    return {
      ok: false,
      engine: engine,
      endpoint: endpoint,
      reason: aborted ? '超时（' + ((opts.timeout || 15000) / 1000) + ' 秒）' : ('请求失败：' + (err && err.message ? err.message : err))
    };
  } finally {
    clearTimeout(timer);
  }
}

// 搜一次：按 engine 顺序试，第一个成功的赢；失败原因逐个记下来（用户能看清是网络、反爬还是结构变了）。
// options.engines 可指定顺序；options.fetch 可注入（测试用本地 fixture，不打外网）。
export async function searchWeb(query, options) {
  const opts = options || {};
  const q = String(query || '').trim();
  if (!q) return { ok: false, reason: '搜索词不能为空' };
  // 顺序：显式 engines > 显式 engine > 自建端点（设了就用，且优先）> 默认 bing → duckduckgo。
  // 用户设 DSH_LEARN_SEARCH_ENDPOINT 的预期就是"用我的搜索"，不把他排在最后。
  const customEndpoint = searchEndpoint('custom', opts);
  const order = opts.engines || (opts.engine ? [opts.engine] : (opts.endpoint ? ['custom'] : (customEndpoint ? ['custom', 'bing', 'duckduckgo'] : ['bing', 'duckduckgo'])));
  const tried = [];
  for (const engine of order) {
    const result = await runEngine(engine, q, opts);
    tried.push({ engine: engine, ok: result.ok, reason: result.ok ? '' : result.reason });
    if (result.ok) {
      return {
        ok: true,
        query: q,
        engine: result.engine,
        endpoint: result.endpoint,
        results: result.results,
        total: result.total,
        tried: tried
      };
    }
  }
  return {
    ok: false,
    query: q,
    tried: tried,
    reason: '所有搜索源都不可用：' + tried.map(function (row) { return row.engine + '（' + row.reason + '）'; }).join('；')
      + '。可以设 DSH_LEARN_SEARCH_ENDPOINT 指向自建/内网搜索，或直接粘贴链接。'
  };
}

// 搜 + 抓 + 解析：这是「链接搜索并解析收集信息」的完整能力。
// 逐个页面抓回来看知识点与命令，失败的页面如实记原因（不静默丢）。
export async function research(query, options) {
  const opts = options || {};
  const limit = Math.max(1, Math.min(SEARCH_LIMIT_MAX, Number(opts.limit) || 5));
  const found = await searchWeb(query, Object.assign({}, opts, { limit: opts.searchLimit || limit }));
  if (!found.ok) {
    return { ok: false, query: String(query || '').trim(), reason: found.reason, tried: found.tried, blocked: Boolean(found.blocked) };
  }
  const fetchOne = opts.fetchPage || fetchText;
  const rows = [];
  for (const item of found.results.slice(0, limit)) {
    const page = await fetchOne(item.url, { wantHtml: true, maxBytes: 4 * 1024 * 1024, timeout: opts.pageTimeout || 20000 });
    if (!page.ok) {
      rows.push({ url: item.url, title: item.title, ok: false, reason: page.reason, blocked: Boolean(page.blocked) });
      continue;
    }
    const plain = String(page.text || '');
    const report = analyzeText(plain, { limit: 20 });
    const draft = buildDraftPack(plain, { source: item.url, limit: 20 });
    const row = {
      url: item.url,
      title: item.title,
      ok: true,
      matched: report.matched,
      points: pointNames(report),
      tasks: draft.stats.tasks,
      taskIds: (draft.pack.tasks || []).map(function (t) { return t.id; })
    };
    // keepText：调用方要拿原文收进项目（不该为了入库再抓一次同一条链接）
    if (opts.keepText) row.text = plain;
    rows.push(row);
  }
  const points = [];
  rows.forEach(function (row) {
    (row.points || []).forEach(function (name) { if (points.indexOf(name) === -1) points.push(name); });
  });
  const taskIds = [];
  rows.forEach(function (row) {
    (row.taskIds || []).forEach(function (id) { if (taskIds.indexOf(id) === -1) taskIds.push(id); });
  });
  return {
    ok: true,
    query: found.query,
    engine: found.engine,
    tried: found.tried,
    searched: found.results.length,
    fetched: rows.filter(function (row) { return row.ok; }).length,
    results: rows,
    points: points,
    tasks: taskIds
  };
}

function pointNames(report) {
  const names = [];
  ((report && report.modules) || []).forEach(function (mod) {
    (mod.points || []).forEach(function (point) { if (names.indexOf(point.name) === -1) names.push(point.name); });
  });
  return names;
}
