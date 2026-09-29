// 小型进程内缓存：按"文件指纹（大小 + mtime）"或自定义 key 记住结果。
//
// 为什么需要：第 11 轮实测发现两个热点——语料检索每次都把 115 份原文从磁盘读一遍再切行，
// JD 练习清单每次点都把所有来源重跑一遍 analyzeText + extractStack（150–270ms）。
// 这些都是"输入没变就结果不变"的纯计算，缓存即可；但**必须按指纹失效**，
// 否则用户改了文件还拿到旧结果（比慢更糟）。
//
// 边界：只在单进程内有效（CLI 每次进程新起，没有跨进程缓存），也不写磁盘——
// 缓存写盘要处理失效与并发，收益（毫秒级）不值这个复杂度。
import { statSync } from 'node:fs';

const store = new Map();
let hits = 0;
let misses = 0;

// 文件指纹：拿不到就返回 null（调用方会退化成不缓存，而不是拿旧数据）
export function fileFingerprint(file) {
  try {
    const info = statSync(file);
    return String(info.size) + ':' + String(Math.round(info.mtimeMs));
  } catch (err) {
    return null;
  }
}

export function memo(key, fingerprint, loader) {
  if (fingerprint === null || fingerprint === undefined) return loader();
  const full = key + '@@' + String(fingerprint);
  if (store.has(full)) {
    hits += 1;
    return store.get(full);
  }
  misses += 1;
  const value = loader();
  store.set(full, value);
  return value;
}

export function cacheStats() {
  return { entries: store.size, hits: hits, misses: misses };
}

export function clearCache() {
  store.clear();
  hits = 0;
  misses = 0;
}
