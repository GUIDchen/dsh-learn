// 进度存储：多客户端（CLI / 网页 / agent）共用一份进度。
//
// 设计要点（为了"并发写不丢记录、断电不写坏文件"）：
//   1. 快照 progress.json 用"写临时文件 + rename"原子替换，永不会读到半截 JSON。
//   2. 新记录先追加到 progress.ndjson（O_APPEND 单行写入，POSIX 下是原子的），
//      不做"读-改-写"，所以多个进程同时提交也不会互相覆盖。
//   3. 只有归档（compaction）时才把日志并进快照：先把日志 rename 走再写快照，
//      期间新写入的会落到新的日志文件里，不会丢。
//   4. 快照损坏时自动回退到 .bak；回退也失败就把坏文件改名留档，绝不让它被静默吞掉。
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { leaderboard } from './core/progress.mjs';
import { detectStorage, migrateStorageValue, storageReport } from './core/storage-schema.mjs';
import { logEvent } from './core/log.mjs';
import {
  BACKUP, COMPACT_THRESHOLD, FILE, GOALS_FILE, HOME, JOBS_COMPACT_THRESHOLD, JOBS_FILE, JOBS_JOURNAL, JOURNAL,
  LANG_VALUES, NOTES_FILE, PREFS_FILE, THEME_VALUES,
  ensureHome, goalsPath, homeDir, jobsJournalPath, jobsPath, langValues, notesPath, preferencesPath, storagePath, themeValues
} from './store/home.mjs';
import { parseRecords, quarantine, readJsonFile, withCompactLock, writeJsonAtomic } from './store/atomic.mjs';

// 对外接口保持不变：搬走的名字在这里原样再导出，24 个调用方零改动。
export {
  BACKUP, STORAGE_PATH, JOURNAL_PATH, BACKUP_PATH,
  homeDir, storagePath, jobsPath, jobsJournalPath, goalsPath, notesPath, preferencesPath, langValues, themeValues
} from './store/home.mjs';

// 投递域已拆到 src/store/jobs.mjs。**import 建立本地绑定**（export ... from 不给本地绑定，
// 上一轮 progress.streakDays 与本轮 store.readJobs 都栽在这上面），再原样导出给调用方。
import { appendJobsOps, clearJobs, compactJobs, deleteJobRecord, diffJobs, readJobs, upsertJobs, writeJobs } from './store/jobs.mjs';
export { appendJobsOps, clearJobs, compactJobs, deleteJobRecord, diffJobs, readJobs, upsertJobs, writeJobs };

function recordKey(item) {
  // 每条记录在写入时就拿到唯一 id。**不要拿字段组合当身份**：同毫秒、同分数、同判定的两次练习
  // 会被当成重复静默丢掉（实测：快速连交 5 次，第 5 次显示"累计第 4 次"，只在机器快时复现）。
  // 老记录（备份文件里没有 id 的）继续按字段组合去重，导入那份文件的幂等性保持不变。
  if (item.id) return item.id;
  return [item.client, item.taskId, item.at, item.score, item.verdict].join('|');
}

function dedupe(records) {
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

// 读快照：坏了就用 .bak，.bak 也坏就把坏文件改名留档并返回空
function readSnapshot() {
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

// 读日志：结尾可能是半行（进程被杀），坏行直接忽略
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

export function load() {
  const snapshot = readSnapshot();
  const journal = readJournalFile();
  const data = { version: 1, records: dedupe(snapshot.records.concat(journal.records)) };
  if (snapshot.recovered) data.recoveredFromBackup = true;
  if (snapshot.quarantined) data.quarantinedFile = snapshot.quarantined;
  if (journal.brokenLines) data.brokenJournalLines = journal.brokenLines;
  return data;
}

// 原子写快照：临时文件 + rename，顺带把上一版留成 .bak
function writeSnapshot(data) {
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

// 读日志原文（连大小一起返回）：归档需要"读完再确认没变"，才能安全删除。
// 之前是"先把日志 rename 走"——那会让并发读者在窗口期看不到这些记录（实测固定丢 1 条）。
function readRawJournal(file) {
  try {
    const text = readFileSync(file, 'utf8');
    let size = 0;
    try { size = statSync(file).size; } catch (err) { size = Buffer.byteLength(text); }
    return { text: text, size: size };
  } catch (err) {
    return { text: '', size: 0 };
  }
}

// 用给定记录重写快照（日志里的记录会被一起并进来，不会丢）
// 存储写锁：**追加日志、归档、清空**都走它。
// 演进过程（都是实测逼出来的）：
//   1. 只串行归档 → 仍有 1 条丢：追加与归档 rename 之间有窗口；
//   2. 归档改成"rename 抢 inode + 补读" → 仍有偶发：补读与 unlink 之间还能追加；
//   3. 写入也持锁 → 窗口彻底消失（本工具真实并发只有 CLI/网页/原生几个客户端，串行代价可忽略）。
// 拿不到锁就跳过归档（日志继续增长，记录不会丢），而不是硬上。

// 归档（调用方必须已持锁）
function compactProgressLocked(baseRecords) {
  const journal = readJournalFile();
  const records = dedupe((baseRecords || []).concat(journal.records));
  writeSnapshot({ records: records });
  try { unlinkSync(JOURNAL); } catch (err) { /* 没有日志 */ }
  return records.length;
}

export function save(data) {
  const result = withCompactLock(function () {
    return compactProgressLocked(data && data.records ? data.records : []);
  });
  // 没抢到锁：本次不归档（日志留着，load() 仍能读全）
  if (result === null) return load().records.length;
  return result;
}

// 追加一条记录：不做读-改-写，所以并发提交不会互相覆盖
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

// 当前 home 目录（DSH_LEARN_HOME 或 ~/.dsh-learn）——备份/恢复、体检、CLI 都要用它

// 存储健康度：有没有从备份恢复、有没有被忽略的坏行、日志攒了多少。
// CLI 与接口都会把它暴露出来，避免"数据悄悄少了几条却没人知道"。
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

// 导出要**完整**：只带记录的话，换机器/重装后笔记与学习目标就没了（这两样都是用户自己写的，比记录更贵）。
// version 1 的字段保持不动，新增 notes / goals 两个字段，老客户端读不懂会直接忽略。
export function exportProgress() {
  const data = load();
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    records: data.records,
    notes: readNotes(),
    goals: readGoals(),
    // 求职记录也一起备份：换了机器不用重新录一遍（老客户端读不懂这个字段会忽略）
    jobs: readJobs()
  };
}

// 合并导入：按记录 id 去重（老记录没有 id 时回退到字段组合），重复的不覆盖既有记录。
// 笔记与目标一并合并：笔记按"谁的更新时间更晚"取胜，目标只在本地没设过时采纳（不悄悄改掉这台机器的目标）。
export function importProgress(payload) {
  const incoming = Array.isArray(payload) ? payload : ((payload && payload.records) || []);
  const incomingNotes = (!Array.isArray(payload) && payload && payload.notes) || null;
  const incomingGoals = (!Array.isArray(payload) && payload && payload.goals) || null;
  const data = load();
  const seen = new Set(data.records.map(recordKey));
  let added = 0;
  let skipped = 0;
  incoming.forEach(function (item) {
    if (!item || !item.taskId) {
      skipped += 1;
      return;
    }
    const key = recordKey(item);
    if (seen.has(key)) {
      skipped += 1;
      return;
    }
    seen.add(key);
    data.records.push(item);
    added += 1;
  });
  const total = save(data);

  // 笔记合并：同一道题取"更新时间更晚"的那条；只有当本地没有这条笔记时才采纳传入的
  let notesAdded = 0;
  if (incomingNotes && typeof incomingNotes === 'object') {
    const localNotes = readNotes();
    Object.keys(incomingNotes).forEach(function (taskId) {
      const row = incomingNotes[taskId];
      if (!row || !row.text) return;
      const mine = localNotes[taskId];
      const mineAt = String((mine && mine.updatedAt) || '');
      const theirsAt = String(row.updatedAt || '');
      if (mine && mineAt >= theirsAt) return;
      localNotes[taskId] = { text: String(row.text).slice(0, 4000), updatedAt: row.updatedAt || new Date().toISOString() };
      notesAdded += 1;
    });
    writeJsonAtomic(NOTES_FILE, localNotes);
  }

  // 目标：本地没设过（每天 0 题 0 分钟）才采纳，避免"导入别人的备份"把本机目标改掉
  let goalsAdopted = false;
  if (incomingGoals) {
    const current = readGoals();
    if (!current.dailyTasks && !current.dailyMinutes) {
      const tasks = Math.max(0, Number(incomingGoals.dailyTasks) || 0);
      const minutes = Math.max(0, Number(incomingGoals.dailyMinutes) || 0);
      if (tasks || minutes) { writeGoals({ dailyTasks: tasks, dailyMinutes: minutes }); goalsAdopted = true; }
    }
  }

  return { added: added, skipped: skipped, total: total, notes: notesAdded, goals: goalsAdopted };
}

// 清空进度：日志里的待归档记录也必须一起丢掉，否则"清零"后会立刻复活。
// ---------------- 目标与笔记（同样是原子写，坏了不拖累进度） ----------------
// 岗位记录也用「追加日志 + 定期归档」：写单文件是原子的，但 readJobs → 改 → writeJobs
// 整段不是原子操作，多进程同时改会互相覆盖（实测 20 个写入者只剩 7 条，见 scripts/stress-jobs-write.mjs）。
// 日志按「操作」追加（upsert / delete），读取时回放合并；攒够阈值再归档成快照。

// 读岗位日志：结尾可能是半行（进程被杀），坏行忽略并计数

// 把操作回放到快照上：upsert 覆盖同 id，delete 移除

// 按路径读日志原文（归档抢到 inode 后要用它再读一遍）

// 解析岗位操作（供归档补读使用）

// 读日志原文（连大小）：归档要"读完再确认没变"才能删

// 归档：把抢到的日志并进快照（期间新写入会落到新日志文件里，不会丢）

// 清空岗位记录（测试与"重置"用）：显式操作，不能靠 writeJobs([]) 表达删除

// 归档（调用方必须已持锁）

// 差量：把「整份新数组」翻译成操作（调用方照旧传全量，语义不变）

// 简历投递记录：一个数组（口径在 core/jobs.mjs，CLI / 网页版 / 原生端同一份）。

// 只增改：把传入的每一行当作 upsert 追加（**不会删除**任何记录）。
// 这样即使调用方基于陈旧读取拼出数组，也不会把别人的记录删掉——竞态由此消失。

// 删除必须显式调用（不能用"写一份不含它的数组"来表达删除，那正是丢记录的根源）

// 兼容老调用点：writeJobs 现在等价于 upsert（只增改）。删除请用 deleteJobRecord。

// 外观与界面偏好：三端共用一份（CLI 可改，网页与原生端读取后应用）。
// 只存"用户显式选过的"，系统跟随（auto）是默认值——这样新装用户开箱就是跟随系统。

export function readPrefs() {
  const data = readJsonFile(PREFS_FILE, {});
  const theme = THEME_VALUES.indexOf(data.theme) > -1 ? data.theme : 'auto';
  const lang = LANG_VALUES.indexOf(data.lang) > -1 ? data.lang : 'zh-CN';
  return { version: 1, theme: theme, lang: lang, updatedAt: data.updatedAt || null };
}

// 局部更新：只改传进来的字段（网页切主题时不该把语言重置掉）
export function writePrefs(patch) {
  const current = readPrefs();
  const wantedTheme = patch && patch.theme !== undefined ? String(patch.theme) : current.theme;
  if (THEME_VALUES.indexOf(wantedTheme) === -1) {
    const err = new Error('theme 只能是 auto / light / dark，收到：' + wantedTheme);
    err.code = 'EINVAL';
    throw err;
  }
  const wantedLang = patch && patch.lang !== undefined ? String(patch.lang) : current.lang;
  if (LANG_VALUES.indexOf(wantedLang) === -1) {
    const err = new Error('lang 只能是 zh-CN / en，收到：' + wantedLang);
    err.code = 'EINVAL';
    throw err;
  }
  const next = { version: 1, theme: wantedTheme, lang: wantedLang, updatedAt: new Date().toISOString() };
  writeJsonAtomic(PREFS_FILE, next);
  logEvent('info', 'prefs.write', { theme: wantedTheme, lang: wantedLang });
  return next;
}

// 学习目标：每天做几题、每天投入多少分钟（0 表示不设）
export function readGoals() {
  const data = readJsonFile(GOALS_FILE, {});
  return {
    dailyTasks: Math.max(0, Number(data.dailyTasks) || 0),
    dailyMinutes: Math.max(0, Number(data.dailyMinutes) || 0),
    updatedAt: data.updatedAt || null
  };
}

export function writeGoals(patch) {
  const current = readGoals();
  const next = {
    dailyTasks: patch && patch.dailyTasks !== undefined ? Math.max(0, Number(patch.dailyTasks) || 0) : current.dailyTasks,
    dailyMinutes: patch && patch.dailyMinutes !== undefined ? Math.max(0, Number(patch.dailyMinutes) || 0) : current.dailyMinutes,
    updatedAt: new Date().toISOString()
  };
  writeJsonAtomic(GOALS_FILE, next);
  return next;
}

// 三份存储的 schema 现状（只读；CLI storage status、接口 GET /api/storage、doctor 都用它）
export function storageStatus() {
  const files = [
    { name: 'progress', path: storagePath() },
    { name: 'jobs', path: jobsPath() },
    { name: 'goals', path: goalsPath() }
  ];
  return storageReport(files.map(function (row) {
    const exists = existsSync(row.path);
    const raw = exists ? readJsonFile(row.path, null) : null;
    return Object.assign({ path: row.path, exists: exists }, detectStorage(row.name, raw));
  }));
}

// 迁移：逐份检测 → 留 .bak 备份 → 写新形状 → 记一行 migrations.log。
// dryRun 只报计划、不落盘（CLI --dry-run / 接口 dryRun:true 都走它）。
export function migrateStorage(options) {
  const opts = options || {};
  const report = storageStatus();
  const logFile = join(HOME, 'migrations.log');
  const steps = [];
  report.rows.forEach(function (row) {
    if (!row.exists) { steps.push({ name: row.name, action: 'skip（没有文件）', from: row.version, to: row.target }); return; }
    if (!row.needsMigration) { steps.push({ name: row.name, action: 'ok', from: row.version, to: row.target }); return; }
    if (opts.dryRun) { steps.push({ name: row.name, action: 'would-migrate', from: row.version, to: row.target }); return; }
    const raw = readJsonFile(row.path, null);
    const backup = row.path + '.bak-' + Date.now();
    try { writeFileSync(backup, JSON.stringify(raw, null, 2)); } catch (err) { /* 备份失败也要继续：原文件此刻还没动 */ }
    writeJsonAtomic(row.path, migrateStorageValue(row.name, raw));
    try { appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), store: row.name, from: row.version, to: row.target, backup: backup }) + '\n'); } catch (err) { /* 日志失败不影响迁移结果 */ }
    steps.push({ name: row.name, action: 'migrated', from: row.version, to: row.target, backup: backup });
    logEvent('info', 'storage.migrate', { store: row.name, from: row.version, to: row.target });
  });
  return { ok: true, dryRun: Boolean(opts.dryRun), steps: steps, log: logFile, after: opts.dryRun ? null : storageStatus() };
}

// 题目笔记：每道题一条，方便记下自己的坑与心得
export function readNotes() {
  const data = readJsonFile(NOTES_FILE, {});
  return data && typeof data === 'object' ? data : {};
}

export function readNote(taskId) {
  const entry = readNotes()[taskId];
  return entry || null;
}

export function writeNote(taskId, text) {
  const notes = readNotes();
  const content = String(text === undefined || text === null ? '' : text).trim();
  if (!content) {
    delete notes[taskId];
    writeJsonAtomic(NOTES_FILE, notes);
    return { taskId: taskId, deleted: true, notes: notes };
  }
  notes[taskId] = { text: content.slice(0, 4000), updatedAt: new Date().toISOString() };
  writeJsonAtomic(NOTES_FILE, notes);
  return { taskId: taskId, deleted: false, note: notes[taskId], notes: notes };
}

export function deleteNote(taskId) {
  const notes = readNotes();
  const existed = Boolean(notes[taskId]);
  delete notes[taskId];
  writeJsonAtomic(NOTES_FILE, notes);
  return { taskId: taskId, deleted: existed };
}

export function reset() {
  // 清空进度：日志与快照都要清，且在锁内做，避免与并发写入/归档互相打断
  const done = withCompactLock(function () {
    try { unlinkSync(JOURNAL); } catch (err) { /* 没有日志 */ }
    writeSnapshot({ records: [] });
    return 0;
  });
  if (done === null) {
    try { unlinkSync(JOURNAL); } catch (err) { /* 没有日志 */ }
    writeSnapshot({ records: [] });
  }
  return 0;
}
