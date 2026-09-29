// 输入摄取：把"链接 / 文件 / 剪贴板文字"统一变成纯文本，交给 knowledge.analyzeText 分析。
// 只用标准库与 Node 自带的 fetch，不引入 HTML 解析依赖：够用的正则 + 实体解码即可。
import { readFileSync } from 'node:fs';

const MAX_BYTES = 512 * 1024;

// HTTP 头只能是 ASCII：这里不要写中文
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) dsh-learn/0.1 (local-learning-tool)';

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&middot;': '·',
  '&copy;': '©', '&reg;': '®', '&trade;': '™', '&times;': '×', '&laquo;': '«', '&raquo;': '»'
};

export function decodeEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, function (m, code) { return String.fromCodePoint(Number(code)); })
    .replace(/&#x([0-9a-f]+);/gi, function (m, code) { return String.fromCodePoint(parseInt(code, 16)); })
    .replace(/&[a-z#0-9]+;/gi, function (m) { return ENTITIES[m.toLowerCase()] !== undefined ? ENTITIES[m.toLowerCase()] : m; });
}

// 去脚本/样式/标签，保留换行；块级标签转换成换行，避免把整页粘成一行
export function htmlToText(html) {
  const cleaned = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // 块级标签收尾要变成换行，否则整页会粘成一行——命令抽取是按行看的，
    // pre 不在表里时，一页 <pre> 命令会被拼成一条，只抽出第一道题（真踩过）。
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|pre|blockquote|dd|dt|table|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(cleaned)
    .split('\n')
    .map(function (line) { return line.replace(/[ \t\u00a0]+/g, ' ').trim(); })
    .filter(function (line, index, rows) { return line.length > 0 || (index > 0 && rows[index - 1].length > 0); })
    .join('\n')
    .trim();
}

// 抓一个网页并转成文本。岗位站点多半要登录/反爬，失败时给出人话原因。
// 读取 cookie：优先用传入的字符串，其次从文件读（Netscape cookies.txt 或"name=value; name2=value2"都行）。
// 岗位站点（BOSS/拉勾等）登录后内容才可见，用户可以从浏览器开发者工具里把 Cookie 头整段复制出来。
export function readCookies(options) {
  const opts = options || {};
  if (opts.cookie && String(opts.cookie).trim()) return String(opts.cookie).trim();
  // 环境变量兜底：招聘站点（BOSS/拉勾）登录后才看得到 JD，而三个客户端各加一个 Cookie 输入框很笨重。
  // export DSH_LEARN_COOKIE='…' 或 DSH_LEARN_COOKIE_FILE=cookies.txt 一次配好，CLI/网页/原生都能用。
  if (process.env.DSH_LEARN_COOKIE && process.env.DSH_LEARN_COOKIE.trim()) return process.env.DSH_LEARN_COOKIE.trim();
  const cookieFile = opts.cookieFile || process.env.DSH_LEARN_COOKIE_FILE;
  if (cookieFile) {
    try {
      const raw = readFileSync(String(cookieFile), 'utf8');
      const pairs = raw.split('\n')
        .map(function (line) { return line.replace(/^#.*$/, '').trim(); })
        .filter(Boolean)
        .map(function (line) {
          const parts = line.split(/\t|\s{2,}/).filter(Boolean); // Netscape 格式
          if (parts.length >= 7) return parts[5] + '=' + parts.slice(6).join('=');
          return line;
        })
        .filter(function (pair) { return pair.indexOf('=') > 0; });
      const joined = pairs.join('; ').trim();
      return joined || null;
    } catch (err) {
      return null;
    }
  }
  return null;
}

// 反爬 / 登录墙的识别：BOSS 直聘、拉勾这类站点对非浏览器请求常常返回"验证页 / JS 壳"，
// 正文虽短但能过 40 字节的下限，于是被当成正常页面分析了——实测一条 BOSS 链接的分析结果是
// "识别出 1 个知识点"，其实抓到的是验证页的样板文字。宁可明确说"没抓到"，也不要这种看似成功的糊弄。
const BLOCK_MARKERS = [
  '安全验证', '请完成验证', '人机验证', '验证码', '访问异常', '操作过于频繁', '当前环境异常',
  '请开启 javascript', '请开启javascript', '登录后查看', 'geetest', 'recaptcha', 'cf-browser-verification',
  '请稍候', '正在加载中', '正在加载', '页面加载中', 'please wait', 'loading…', 'loading...',
  'just a moment', 'attention required', 'enable javascript and cookies', 'robot check'
];

export function detectBlockedPage(text, html) {
  const head = String(text || '').slice(0, 800).toLowerCase();
  const raw = String(html || '').slice(0, 4000).toLowerCase();
  const hit = BLOCK_MARKERS.filter(function (m) { return head.indexOf(m) > -1 || raw.indexOf(m) > -1; });
  if (!hit.length) return null;
  // 有标记但正文很长（比如一篇讲验证码的技术文档）就不当拦截：宁可放过，不误伤。
  if (String(text || '').length > 1500) return null;
  return { markers: hit.slice(0, 3) };
}

export async function fetchText(url, options) {
  const opts = options || {};
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) {
    return { ok: false, reason: '只支持 http/https 链接，收到的是：' + (target.slice(0, 60) || '(空)') };
  }
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, opts.timeout || 8000);
  try {
    const headers = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' };
    const cookie = readCookies(opts);
    if (cookie) headers.cookie = cookie;
    const res = await fetch(target, { redirect: 'follow', signal: controller.signal, headers: headers });
    const raw = await res.text();
    const maxBytes = opts.maxBytes || MAX_BYTES;
    if (raw.length > maxBytes) {
      return { ok: false, reason: '页面太大（' + Math.round(raw.length / 1024) + 'KB，上限 ' + Math.round(maxBytes / 1024) + 'KB）：请只把需要的段落粘进来，或用 --limit 抓更小的页面' };
    }
    const text = htmlToText(raw);
    const blocked = detectBlockedPage(text, raw);
    if (blocked) {
      return {
        ok: false,
        blocked: true,
        status: res.status,
        markers: blocked.markers,
        reason: '页面是验证页 / JS 壳，不是正文（命中：' + blocked.markers.join('、') + '）——这类站点对非浏览器请求做了反爬；可行路径：① 截图（本机 OCR，离线）② 把正文复制成文字粘进来 ③ 登录后带 Cookie 再试（--cookie / --cookie-file）。',
        advice: ['截图走本机 OCR', '复制正文成文字', '带 Cookie 再试']
      };
    }
    if (res.status !== 200 || text.length < 40) {
      const loggedIn = Boolean(cookie);
      return {
        ok: false,
        status: res.status,
        reason: 'HTTP ' + res.status + '：页面正文没抓到（岗位站点通常需要登录或做了反爬）。'
          + (loggedIn ? '已经带上 cookie 还是没抓到，可能是页面靠 JS 渲染——把 JD 文字复制进文本框最稳。'
                      : '可以在浏览器里登录后，从开发者工具把 Cookie 头复制出来，用 --cookie 或 --cookie-file 传进来再试；或者直接把 JD 文字复制进文本框。')
      };
    }
    return {
      ok: true,
      status: res.status,
      url: target,
      withCookie: Boolean(cookie),
      text: text.slice(0, maxBytes),
      // 需要"从文档里学命令"时得看原始 HTML：代码块边界在去标签之后就没了
      html: opts.wantHtml ? raw.slice(0, maxBytes) : undefined,
      bytes: raw.length
    };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || /aborted/i.test(err.message || ''));
    return { ok: false, reason: aborted ? '抓取超时（' + ((opts.timeout || 8000) / 1000) + ' 秒）' : ('抓取失败：' + (err && err.message ? err.message : err)) };
  } finally {
    clearTimeout(timer);
  }
}

// 从本地文件读文本（限定文本类后缀，避免把二进制塞进分析器）
export function readTextFile(file, fsModule) {
  const fs = fsModule || { readFileSync: readFileSync };
  const path = String(file || '').trim();
  if (!path) return { ok: false, reason: '没有给文件路径' };
  if (!/\.(txt|md|markdown|json|ya?ml|csv|log|ini|cfg|conf|toml|py|js|mjs|ts|c|h|cpp|hpp|java|go|rs|sh|sql|html?)$/i.test(path)) {
    return { ok: false, reason: '只支持文本类文件（txt/md/json/yaml/csv/log/源码等）；截图请用 --ocr' };
  }
  try {
    const text = fs.readFileSync(path, 'utf8');
    return { ok: true, text: text.slice(0, MAX_BYTES), path: path };
  } catch (err) {
    return { ok: false, reason: '读取失败：' + err.message };
  }
}
