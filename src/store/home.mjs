// 存储位置与界面偏好的取值域：**只有这一处**知道 home 在哪、文件叫什么。
// 拆出来的原因：store.mjs 里 6 个域都直接用这些常量，先让「路径」独立成最底层模块。
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = process.env.DSH_LEARN_HOME || join(homedir(), '.dsh-learn');
export const FILE = join(HOME, 'progress.json');
export const BACKUP = FILE + '.bak';
export const JOURNAL = join(HOME, 'progress.ndjson');
// 日志攒到这么多条就归档进快照（太小会频繁重写，太大读取会变慢）
export const COMPACT_THRESHOLD = 200;
export const STORAGE_PATH = FILE;
export const JOURNAL_PATH = JOURNAL;
export const BACKUP_PATH = BACKUP;
export const GOALS_FILE = join(HOME, 'goals.json');
export const NOTES_FILE = join(HOME, 'notes.json');
export const JOBS_FILE = join(HOME, 'jobs.json');
export const JOBS_JOURNAL = join(HOME, 'jobs.ndjson');
export const JOBS_COMPACT_THRESHOLD = 500;
export const PREFS_FILE = join(HOME, 'preferences.json');
export const THEME_VALUES = ['auto', 'light', 'dark'];
export const LANG_VALUES = ['zh-CN', 'en'];

export function ensureHome() {
  mkdirSync(HOME, { recursive: true });
}

export function homeDir() { return HOME; }

export function storagePath() {
  return FILE;
}

export function jobsJournalPath() {
  return JOBS_JOURNAL;
}

export function preferencesPath() { return PREFS_FILE; }

export function langValues() { return LANG_VALUES.slice(); }

export function themeValues() { return THEME_VALUES.slice(); }

export function goalsPath() {
  return GOALS_FILE;
}

export function notesPath() {
  return NOTES_FILE;
}

export function jobsPath() {
  return JOBS_FILE;
}
