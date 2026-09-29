// 整机备份 / 恢复：把 home 里「用户的资产」打包成一个可校验的 JSON 包。
//
// 为什么不用 tar：零依赖是硬约束，而 tar 的跨平台参数（BSD vs GNU）差异正是本项目一直在躲的坑。
// 这里备的东西**全是文本**（progress/jobs/goals/notes/migrations.log + projects/ 下的 JSON、txt、md），
// 所以 JSON 包足够，而且可 diff、可逐文件校验 hash、dry-run 能精确到"会写哪些文件"。
//
// 明确**不备**：bin/（本机编译出来的 OCR 助手，换机器要重编）、backups/（别把备份塞进备份）、
// *.bak-*（迁移/归档的临时副本）。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { logEvent } from './log.mjs';

export const BACKUP_FORMAT = 'dsh-learn-backup';
export const BACKUP_VERSION = 1;

const INCLUDE_FILES = ['progress.json', 'progress.ndjson', 'jobs.json', 'jobs.ndjson', 'goals.json', 'notes.json', 'migrations.log', 'trust.json'];
const INCLUDE_DIRS = ['projects'];
const EXCLUDE = [/^bin\//, /^backups\//, /\.bak-/, /\.tmp-?$/, /\.compacting-/, /^\.compact\.lock$/];

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }

function walk(dir, home, out) {
  let names = [];
  try { names = readdirSync(dir); } catch (err) { return out; }
  names.forEach(function (name) {
    const full = join(dir, name);
    const rel = relative(home, full).split('\\').join('/');
    let info = null;
    try { info = statSync(full); } catch (err) { return; }
    if (info.isDirectory()) { walk(full, home, out); return; }
    if (EXCLUDE.some(function (re) { return re.test(rel); })) return;
    out.push({ rel: rel, size: info.size, mtime: info.mtime.toISOString() });
  });
  return out;
}

// 家里有什么可备的（只读；dry-run 与备份共用同一份清单）
export function collectHome(home) {
  const rows = [];
  INCLUDE_FILES.forEach(function (name) {
    const full = join(home, name);
    if (!existsSync(full)) return;
    try { const info = statSync(full); rows.push({ rel: name, size: info.size, mtime: info.mtime.toISOString() }); } catch (err) { /* 跳过 */ }
  });
  INCLUDE_DIRS.forEach(function (name) {
    const full = join(home, name);
    if (!existsSync(full)) return;
    walk(full, home, rows);
  });
  return rows.sort(function (a, b) { return a.rel < b.rel ? -1 : 1; });
}

export function backupDir(home) { return join(home, 'backups'); }

// 备份计划：备什么、多大、写到哪（dry-run 直接打印它）
export function planBackup(home, options) {
  const opts = options || {};
  const rows = collectHome(home);
  const at = opts.at || new Date().toISOString();
  const stamp = at.replace(/[:.]/g, '-');
  return {
    home: home,
    at: at,
    files: rows,
    fileCount: rows.length,
    totalBytes: rows.reduce(function (sum, row) { return sum + row.size; }, 0),
    out: opts.out || join(backupDir(home), 'dsh-learn-backup-' + stamp + '.json')
  };
}

export function createBackup(home, options) {
  const opts = options || {};
  const plan = planBackup(home, opts);
  if (opts.dryRun) return Object.assign({ ok: true, dryRun: true, wrote: false }, plan);
  const files = {};
  plan.files.forEach(function (row) {
    const buffer = readFileSync(join(home, row.rel));
    const hash = sha256(buffer);
    const text = buffer.toString('utf8');
    // 文本直接存（可 diff）；含不可打印字节的退回 base64（本项目 home 目前全是文本）
    files[row.rel] = Buffer.from(text, 'utf8').compare(buffer) === 0
      ? { text: text, size: row.size, sha256: hash }
      : { base64: buffer.toString('base64'), size: row.size, sha256: hash };
  });
  const bundle = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    at: plan.at,
    home: home,
    fileCount: plan.fileCount,
    totalBytes: plan.totalBytes,
    files: files
  };
  mkdirSync(backupDir(home), { recursive: true });
  writeFileSync(plan.out, JSON.stringify(bundle));
  writeFileSync(join(backupDir(home), 'latest.json'), JSON.stringify({ at: plan.at, file: plan.out, fileCount: plan.fileCount, totalBytes: plan.totalBytes }, null, 2));
  logEvent('info', 'backup.create', { file: plan.out, fileCount: plan.fileCount, bytes: plan.totalBytes });
  return Object.assign({ ok: true, dryRun: false, wrote: true }, plan, { bundle: { at: plan.at, fileCount: plan.fileCount } });
}

export function readBackup(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (raw && raw.format !== BACKUP_FORMAT) throw new Error('不是本项目的备份包：' + String(raw && raw.format));
  return raw;
}

export function verifyBackup(file) {
  const bundle = readBackup(file);
  const bad = [];
  Object.keys(bundle.files || {}).forEach(function (rel) {
    const entry = bundle.files[rel];
    const buffer = entry.text !== undefined ? Buffer.from(entry.text, 'utf8') : Buffer.from(entry.base64 || '', 'base64');
    const hash = sha256(buffer);
    if (hash !== entry.sha256) bad.push(rel);
  });
  return { ok: bad.length === 0, fileCount: Object.keys(bundle.files || {}).length, broken: bad, at: bundle.at };
}

// 恢复计划：哪些是新建、哪些会覆盖（dry-run 直接打印它）
export function planRestore(file, home) {
  const bundle = readBackup(file);
  const rows = Object.keys(bundle.files || {}).sort().map(function (rel) {
    const entry = bundle.files[rel];
    return { rel: rel, size: entry.size || 0, exists: existsSync(join(home, rel)), action: existsSync(join(home, rel)) ? 'overwrite' : 'create' };
  });
  return {
    file: file, home: home, at: bundle.at,
    rows: rows,
    create: rows.filter(function (r) { return r.action === 'create'; }).length,
    overwrite: rows.filter(function (r) { return r.action === 'overwrite'; }).length,
    totalBytes: rows.reduce(function (sum, r) { return sum + r.size; }, 0)
  };
}

// 恢复：默认先给「会被覆盖的文件」留一份 pre-restore 副本——恢复本身是危险操作，先把后悔药备上
export function restoreBackup(file, options) {
  const opts = options || {};
  const home = opts.home;
  const plan = planRestore(file, home);
  if (opts.dryRun) return Object.assign({ ok: true, dryRun: true, wrote: false }, plan);
  const bundle = readBackup(file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyDir = join(backupDir(home), 'pre-restore-' + stamp);
  let safetyCount = 0;
  const targets = Object.keys(bundle.files || {});
  targets.forEach(function (rel) {
    const full = join(home, rel);
    if (existsSync(full)) {
      mkdirSync(join(safetyDir, rel.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
      writeFileSync(join(safetyDir, rel), readFileSync(full));
      safetyCount += 1;
    }
    mkdirSync(join(home, rel.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
    const entry = bundle.files[rel];
    writeFileSync(full, entry.text !== undefined ? entry.text : Buffer.from(entry.base64 || '', 'base64'));
  });
  logEvent('info', 'backup.restore', { file: file, files: plan.rows.length, overwrite: plan.overwrite, safetyCount: safetyCount });
  return Object.assign({ ok: true, dryRun: false, wrote: true, safetyDir: safetyCount ? safetyDir : null, safetyCount: safetyCount }, plan);
}

// 体检用：最近一次备份离现在多久
export function backupStatus(home) {
  const latestFile = join(backupDir(home), 'latest.json');
  if (!existsSync(latestFile)) return { exists: false, latest: null, ageDays: null };
  try {
    const latest = JSON.parse(readFileSync(latestFile, 'utf8'));
    const ageDays = Math.floor((Date.now() - new Date(latest.at).getTime()) / 86400000);
    return { exists: true, latest: latest, ageDays: ageDays, stale: ageDays >= 7 };
  } catch (err) {
    return { exists: false, latest: null, ageDays: null, error: err.message };
  }
}
