// 响应压缩：JSON 与文本资源开压缩（题库 bootstrap 现在是 490KB，压完 121KB 上下）。
// 优先 brotli（同一份 JSON 比 gzip 再小两成），客户端不支持就退回 gzip；小响应不折腾。
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';

const MIN_SIZE = 1024;

// 实测（真实 /api/bootstrap，490128 字节 JSON）：
//   brotli q11（zlib 默认）  1055 ms → 110 KB   ← 默认值，单个请求就把事件循环卡住一秒
//   brotli q9                  39 ms → 118 KB
//   brotli q6                  16 ms → 121 KB   ← 选它
//   gzip   l6                  13 ms → 139 KB
// 1 秒的**同步**压缩不止让这一个请求慢：Node 是单线程，期间所有并发请求（页面同时打的
// /api/progress、/api/drill、/api/daily…）都在排队。省下来的 11 KB 带宽不值得这个代价。
const BROTLI_QUALITY = 6;
// 同一份内容只压一次：bootstrap 按平台是一份固定正文，app.mjs/index.html 也是，
// 每次刷新都重压是纯浪费。只留最近若干份，避免内存无限长。
const CACHE_LIMIT = 12;
const cache = new Map();

let compressedCount = 0;
let cacheHits = 0;

function compressBuffer(encoding, buffer) {
  const key = encoding + ':' + buffer.length + ':' + createHash('sha1').update(buffer).digest('hex');
  const hit = cache.get(key);
  if (hit) { cacheHits += 1; return hit; }
  compressedCount += 1;
  const zipped = encoding === 'br'
    ? brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } })
    : gzipSync(buffer);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, zipped);
  return zipped;
}

// 给测试与实测用：确认压缩质量没被改回 11，也能看到缓存有没有命中
export const COMPRESSION = { brotliQuality: BROTLI_QUALITY, cacheLimit: CACHE_LIMIT };
export function compressionCacheSize() { return cache.size; }
export function compressionStats() { return { compressed: compressedCount, hits: cacheHits, cached: cache.size }; }
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json|xml))/i;

const ENCODING_OF = function (req) {
  const header = String((req && req.headers && req.headers['accept-encoding']) || '');
  if (/\bbr\b/i.test(header)) return 'br';
  if (/\bgzip\b/i.test(header)) return 'gzip';
  return '';
};

export function acceptsGzip(req) {
  return ENCODING_OF(req) !== '';
}

export function isCompressible(contentType) {
  return COMPRESSIBLE.test(String(contentType || ''));
}

// 统一的"聪明发送"：字节数、编码、长度头一次算好，调用方不用各自写 writeHead
export function sendSmart(req, res, code, body, contentType, extraHeaders) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const headers = Object.assign({ 'content-type': contentType }, extraHeaders || {});
  const encoding = ENCODING_OF(req);
  if (encoding && isCompressible(contentType) && buffer.length >= MIN_SIZE) {
    const zipped = compressBuffer(encoding, buffer);
    headers['content-encoding'] = encoding;
    headers['vary'] = 'Accept-Encoding';
    headers['content-length'] = zipped.length;
    res.writeHead(code, headers);
    res.end(zipped);
    return zipped.length;
  }
  headers['content-length'] = buffer.length;
  res.writeHead(code, headers);
  res.end(buffer);
  return buffer.length;
}
