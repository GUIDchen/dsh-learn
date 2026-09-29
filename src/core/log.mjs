// 结构化日志 + 指标汇总。
//
// 现状（第 213 轮前）：只有零散的 console 文本，长期观察（"今天错了几次"、"哪条接口最慢"）
// 只能靠翻屏幕或文件。这里落一份 NDJSON：一行一个事件，便于 tail、grep、聚合。
//
// 设计取舍：
//   * 路径自己算（DSH_LEARN_HOME 或 ~/.dsh-learn），**不 import store**——否则 store 里埋点会形成循环依赖；
//   * 轮转只保留一代（dsh.ndjson → dsh.ndjson.1），本地工具不需要无限历史；
//   * 读日志容忍坏行（进程被杀会留半行），并如实计数——与进度日志同一套原则。
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LOG_MAX_BYTES = 2 * 1024 * 1024;

export function homePath() {
  return process.env.DSH_LEARN_HOME || join(homedir(), '.dsh-learn');
}

export function logDir(home) { return join(home || homePath(), 'logs'); }
export function logPath(home) { return join(logDir(home), 'dsh.ndjson'); }

export function logEvent(level, event, fields, options) {
  const opts = options || {};
  const home = opts.home || homePath();
  try {
    mkdirSync(logDir(home), { recursive: true });
    const file = logPath(home);
    const max = Number(opts.maxBytes) || LOG_MAX_BYTES;
    if (existsSync(file) && statSync(file).size >= max) {
      try { rmSync(file + '.1', { force: true }); } catch (err) { /* 旧的一代尽力清 */ }
      try { renameSync(file, file + '.1'); } catch (err) { /* 抢不到就继续追加 */ }
    }
    const row = Object.assign({ at: new Date().toISOString(), level: level || 'info', event: event || 'event' }, fields || {});
    appendFileSync(file, JSON.stringify(row) + String.fromCharCode(10));
    return row;
  } catch (err) {
    // 日志失败绝不能影响主流程：这是可观测性，不是业务
    return null;
  }
}

// 读事件：默认只读当前文件；limit 不够时再补读 .1（新→旧拼回来）
export function readEvents(options) {
  const opts = options || {};
  const home = opts.home || homePath();
  const want = Math.max(1, Number(opts.limit) || 200);
  const rows = [];
  let broken = 0;
  const readOne = function (file) {
    if (!existsSync(file)) return;
    const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10));
    for (let i = lines.length - 1; i >= 0 && rows.length < want; i -= 1) {
      const text = lines[i].trim();
      if (!text) continue;
      try { rows.push(JSON.parse(text)); } catch (err) { broken += 1; }
    }
  };
  readOne(logPath(home));
  if (rows.length < want) readOne(logPath(home) + '.1');
  if (opts.since) {
    const at = new Date(opts.since).getTime();
    if (isFinite(at)) return { events: rows.filter(function (row) { return new Date(row.at).getTime() >= at; }), broken: broken };
  }
  return { events: rows, broken: broken };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort(function (a, b) { return a - b; });
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

// 汇总：HTTP 请求量/延迟/错误率 + 各事件次数（metrics 接口与 CLI 共用）
export function summarizeEvents(events) {
  const byEvent = {};
  const byLevel = {};
  const paths = {};
  const latencies = [];
  let httpErrors = 0;
  (events || []).forEach(function (row) {
    byEvent[row.event] = (byEvent[row.event] || 0) + 1;
    byLevel[row.level] = (byLevel[row.level] || 0) + 1;
    if (row.event === 'http') {
      if (typeof row.ms === 'number') latencies.push(row.ms);
      if (Number(row.status) >= 400) httpErrors += 1;
      paths[row.path] = (paths[row.path] || 0) + 1;
    }
  });
  const topPaths = Object.keys(paths).map(function (path) { return { path: path, count: paths[path] }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, 8);
  const requests = byEvent.http || 0;
  return {
    events: (events || []).length,
    byEvent: byEvent,
    byLevel: byLevel,
    http: {
      requests: requests,
      errors: httpErrors,
      errorRate: requests ? Number((httpErrors / requests).toFixed(3)) : 0,
      p50ms: percentile(latencies, 50),
      p95ms: percentile(latencies, 95),
      topPaths: topPaths
    }
  };
}

export function logStatus(home) {
  const file = logPath(home);
  if (!existsSync(file)) return { exists: false, file: file, sizeBytes: 0 };
  let size = 0;
  try { size = statSync(file).size; } catch (err) { size = 0; }
  const read = readEvents({ home: home, limit: 500 });
  const summary = summarizeEvents(read.events);
  return { exists: true, file: file, sizeBytes: size, brokenLines: read.broken, summary: summary };
}
