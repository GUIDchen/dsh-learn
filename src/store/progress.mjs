// 进度存储：快照 + 追加日志 + 归档（多客户端共用一份进度）。
//
// 拆出理由：store.mjs 到 457 行时还混着进度/偏好/笔记/组合四块。进度这块自带一整套并发与恢复
// 设计（原子替换、O_APPEND 日志、归档加锁、坏文件留档），是 store 里最大也最独立的一块。
// 顶层设计说明仍留在 store.mjs 头部注释（那里是这套约定的出处）。
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { leaderboard } from '../core/progress.mjs';
import { logEvent } from '../core/log.mjs';
import { BACKUP, COMPACT_THRESHOLD, FILE, JOURNAL, ensureHome } from './home.mjs';
import { parseRecords, quarantine, writeJsonAtomic, withCompactLock } from './atomic.mjs';

export function recordKey(item) {
  // 每条记录在写入时就拿到唯一 id。**不要拿字段组合当身份**：同毫秒、同分数、同判定的两次练习
  // 会被当成重复静默丢掉（实测：快速连交 5 次，第 5 次显示"累计第 4 次"，只在机器快时复现）。
  // 老记录（备份文件里没有 id 的）继续按字段组合去重，导入那份文件的幂等性保持不变。
  if (item.id) return item.id;
  return [item.client, item.taskId, item.at, item.score, item.verdict].join('|');
}

export function dedupe(records) {
  const map = new Map();
  (records || []).forEach(function (item) {
    if (!item || !item.taskId) return;
    const key = recordKey(item);
    if (!map.has(key)) map.set(key, item);
  });
  return Array.from(map.values()).sort(function (a, b) {
    return String(a.at || '').localeCompare(String(b.at || ''));
  });
}

export function readSnapshot() {
  if (existsSync(FILE)) {
    const parsed = parseRecords(readFileSync(FILE, 'utf8'));
    if (!parsed.broken) return { records: parsed.records, recovered: false };
    const bad = quarantine(FILE);
    if (existsSync(BACKUP)) {
      const backup = parseRecords(readFileSync(BACKUP, 'utf8'));
      if (!backup.broken) return { records: backup.records, recovered: true, quarantined: bad };
    }
    return { records: [], recovered: false, quarantined: bad };
  }
  if (existsSync(BACKUP)) {
    const backup = parseRecords(readFileSync(BACKUP, 'utf8'));
    if (!backup.broken) return { records: backup.records, recovered: true };
  }
  return { records: [], recovered: false };
}

export function writeSnapshot(data) {
  ensureHome();
  const tmp = FILE + '.tmp-' + process.pid;
  try {
    // schema 版本写在这里：读侧两种都认（parseRecords 只取 records），所以升级不会把旧数据读坏
    writeFileSync(tmp, JSON.stringify({ version: 2, records: data.records }, null, 2));
    if (existsSync(FILE)) {
      try {
        writeFileSync(BACKUP, readFileSync(FILE));
      } catch (err) {
        // 备份失败不影响主流程
      }
    }
    renameSync(tmp, FILE);
  } catch (err) {
    try { unlinkSync(tmp); } catch (gone) { /* 没写成功也没有它 */ }
    throw err;
  }
}

export function readJournalFile(file) {
  const target = file || JOURNAL;
  // 不要先 existsSync 再读：归档方可能在这两步之间把日志 rename 走（实测并发下 ENOENT 崩溃）。
  // 直接读、读不到就当空。
  let raw = '';
  try {
    raw = readFileSync(target, 'utf8');
  } catch (err) {
    return { records: [], brokenLines: 0 };
  }
  const lines = raw.split('\n');
  const records = [];
  let brokenLines = 0;
  lines.forEach(function (line) {
    const text = line.trim();
    if (!text) return;
    try {
      records.push(JSON.parse(text));
    } catch (err) {
      brokenLines += 1;
    }
  });
  return { records: records, brokenLines: brokenLines };
}

export function journalSize() {
  try {
    return statSync(JOURNAL).size;
  } catch (err) {
    return 0;
  }
}

export function readRawJournal(file) {
  try {
    const text = readFileSync(file, 'utf8');
    let size = 0;
    try { size = statSync(file).size; } catch (err) { size = Buffer.byteLength(text); }
    return { text: text, size: size };
  } catch (err) {
    return { text: '', size: 0 };
  }
}

export function load() {
  const snapshot = readSnapshot();
  const journal = readJournalFile();
  const data = { version: 1, records: dedupe(snapshot.records.concat(journal.records)) };
  if (snapshot.recovered) data.recoveredFromBackup = true;
  if (snapshot.quarantined) data.quarantinedFile = snapshot.quarantined;
  if (journal.brokenLines) data.brokenJournalLines = journal.brokenLines;
  return data;
}

export function save(data) {
  const result = withCompactLock(function () {
    return compactProgressLocked(data && data.records ? data.records : []);
  });
  // 没抢到锁：本次不归档（日志留着，load() 仍能读全）
  if (result === null) return load().records.length;
  return result;
}

export function record(entry) {
  ensureHome();
  const item = Object.assign({ id: randomUUID(), at: new Date().toISOString() }, entry);
  // 追加与归档都在锁内：这样归档不可能在追加中途把日志 rename 走
  const result = withCompactLock(function () {
    appendFileSync(JOURNAL, JSON.stringify(item) + '\n');
    const journal = readJournalFile();
    if (journal.records.length >= COMPACT_THRESHOLD) compactProgressLocked(readSnapshot().records);
    return load().records.length;
  });
  if (result === null) {
    // 极端情况下拿不到锁：退化成"只追加不归档"，记录不会丢
    appendFileSync(JOURNAL, JSON.stringify(item) + '\n');
    return load().records.length;
  }
  return result;
}

export function compactProgressLocked(baseRecords) {
  const journal = readJournalFile();
  const records = dedupe((baseRecords || []).concat(journal.records));
  writeSnapshot({ records: records });
  try { unlinkSync(JOURNAL); } catch (err) { /* 没有日志 */ }
  return records.length;
}

export function storageHealth() {
  const snapshot = readSnapshot();
  const journal = readJournalFile();
  return {
    path: FILE,
    journalPath: JOURNAL,
    records: snapshot.records.length + journal.records.length,
    journalRecords: journal.records.length,
    journalBytes: journalSize(),
    brokenJournalLines: journal.brokenLines,
    recoveredFromBackup: Boolean(snapshot.recovered),
    quarantinedFile: snapshot.quarantined || null
  };
}

export function board() {
  return leaderboard(load().records);
}
