// 投递记录存储：快照 + 操作日志（与进度同一套「追加日志、归档时才并进快照」的做法）。
//
// 拆出理由：store.mjs 到 606 行时仍混着进度/投递/偏好/笔记/运维五个域；投递这块自成一体
//（JOBS_FILE 快照 + JOBS_JOURNAL 操作日志 + 500 条阈值归档 + upsert 幂等），先整块搬出来。
// 对外名字在 store.mjs 里原样再导出，调用方零改动。
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOBS_COMPACT_THRESHOLD, JOBS_FILE, JOBS_JOURNAL, ensureHome } from './home.mjs';
import { readJsonFile, withCompactLock, writeJsonAtomic } from './atomic.mjs';

export function readJobsSnapshot() {
  const data = readJsonFile(JOBS_FILE, []);
  // v1 是裸数组，v2 是 { version, jobs }——两种都认，这样没迁移的旧数据也照常可用
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.jobs)) return data.jobs;
  return [];
}

export function readJobsJournal() {
  let raw = '';
  try {
    raw = readFileSync(JOBS_JOURNAL, 'utf8');
  } catch (err) {
    return { ops: [], brokenLines: 0 };
  }
  const lines = raw.split('\n');
  const ops = [];
  let brokenLines = 0;
  lines.forEach(function (line) {
    const text = line.trim();
    if (!text) return;
    try {
      const op = JSON.parse(text);
      if (op && (op.op === 'upsert' || op.op === 'delete')) ops.push(op);
      else brokenLines += 1;
    } catch (err) {
      brokenLines += 1;
    }
  });
  return { ops: ops, brokenLines: brokenLines };
}

export function applyJobsOps(base, ops) {
  const map = new Map((base || []).filter(function (job) { return job && job.id; }).map(function (job) { return [job.id, job]; }));
  (ops || []).forEach(function (op) {
    if (op.op === 'delete') { map.delete(op.id); return; }
    if (op.op === 'upsert' && op.job && op.job.id) map.set(op.job.id, op.job);
  });
  return Array.from(map.values());
}

export function readRawJobsJournalAt(target) {
  try {
    return { text: readFileSync(target, 'utf8') };
  } catch (err) {
    return { text: '' };
  }
}

export function parseJobsOps(raw) {
  const lines = String(raw || '').split('\n');
  const ops = [];
  let brokenLines = 0;
  lines.forEach(function (line) {
    const text = line.trim();
    if (!text) return;
    try {
      const op = JSON.parse(text);
      if (op && (op.op === 'upsert' || op.op === 'delete')) ops.push(op);
      else brokenLines += 1;
    } catch (err) { brokenLines += 1; }
  });
  return { ops: ops, brokenLines: brokenLines };
}

export function readRawJobsJournal() {
  try {
    const text = readFileSync(JOBS_JOURNAL, 'utf8');
    let size = 0;
    try { size = statSync(JOBS_JOURNAL).size; } catch (err) { size = Buffer.byteLength(text); }
    return { text: text, size: size };
  } catch (err) {
    return { text: '', size: 0 };
  }
}

export function compactJobs() {
  const result = withCompactLock(function () { return compactJobsLocked(); });
  if (result === null) { const rows = readJobs(); return Array.isArray(rows) ? rows.length : 0; }
  return result;
}

export function clearJobs() {
  const done = withCompactLock(function () {
    writeJsonAtomic(JOBS_FILE, { version: 2, jobs: [] });
    try { unlinkSync(JOBS_JOURNAL); } catch (err) { /* 没有日志 */ }
    return true;
  });
  if (!done) {
    writeJsonAtomic(JOBS_FILE, { version: 2, jobs: [] });
    try { unlinkSync(JOBS_JOURNAL); } catch (err) { /* 没有日志 */ }
  }
  return [];
}

export function compactJobsLocked() {
  const journal = readJobsJournal();
  const merged = applyJobsOps(readJobsSnapshot(), journal.ops);
  writeJsonAtomic(JOBS_FILE, { version: 2, jobs: merged });
  try { unlinkSync(JOBS_JOURNAL); } catch (err) { /* 没有日志 */ }
  return merged.length;
}

export function appendJobsOps(ops) {
  if (!ops || !ops.length) return readJobs();
  ensureHome();
  const payload = ops.map(function (op) { return JSON.stringify(op); }).join('\n') + '\n';
  // 锁内完成；拿不到锁会一直等（陈旧锁可抢占），不会退化成"裸写"
  return withCompactLock(function () {
    appendFileSync(JOBS_JOURNAL, payload);
    if (readJobsJournal().ops.length >= JOBS_COMPACT_THRESHOLD) compactJobsLocked();
    return readJobs();
  });
}

export function diffJobs(current, next) {
  const curMap = new Map((current || []).map(function (job) { return [job.id, job]; }));
  const nextMap = new Map((next || []).filter(function (job) { return job && job.id; }).map(function (job) { return [job.id, job]; }));
  const ops = [];
  nextMap.forEach(function (job, id) {
    const before = curMap.get(id);
    if (!before || JSON.stringify(before) !== JSON.stringify(job)) ops.push({ op: 'upsert', job: job });
  });
  curMap.forEach(function (job, id) {
    if (job && !nextMap.has(id)) ops.push({ op: 'delete', id: id });
  });
  return ops;
}

export function readJobs() {
  const snapshot = readJobsSnapshot();
  const journal = readJobsJournal();
  const rows = applyJobsOps(snapshot, journal.ops);
  if (journal.brokenLines) rows.brokenJournalLines = journal.brokenLines;
  return rows;
}

export function upsertJobs(jobs) {
  const current = new Map();
  (readJobs() || []).forEach(function (job) { if (job && job.id) current.set(job.id, job); });
  const seen = new Map();
  (Array.isArray(jobs) ? jobs : []).forEach(function (job) {
    if (job && job.id) seen.set(job.id, job);
  });
  // 只追加"新增或内容有变化"的行：把整份数组都写成操作会放大日志（200 个写入者 → 频繁归档 → 抢锁）
  const ops = [];
  seen.forEach(function (job, id) {
    const before = current.get(id);
    if (!before || JSON.stringify(before) !== JSON.stringify(job)) ops.push({ op: 'upsert', job: job });
  });
  if (ops.length) appendJobsOps(ops);
  const rows = readJobs();
  return Array.isArray(rows) ? rows.slice() : rows;
}

export function deleteJobRecord(id) {
  if (!id) { const rows = readJobs(); return Array.isArray(rows) ? rows.slice() : rows; }
  appendJobsOps([{ op: 'delete', id: String(id) }]);
  const rows = readJobs();
  return Array.isArray(rows) ? rows.slice() : rows;
}

export function writeJobs(jobs) {
  return upsertJobs(jobs);
}
