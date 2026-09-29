// 界面偏好 / 学习目标 / 题目笔记：三份小存储，同一套原子写。
//
// 拆出理由：它们都很小但要被组合层（导出/导入/inspect）和各个路由用到；独立成模块后
// 进度域与组合层都能引用它，而不会互相引用（避免循环依赖）。
import { logEvent } from '../core/log.mjs';
import { GOALS_FILE, LANG_VALUES, NOTES_FILE, PREFS_FILE, THEME_VALUES } from './home.mjs';
import { readJsonFile, writeJsonAtomic } from './atomic.mjs';

export function readPrefs() {
  const data = readJsonFile(PREFS_FILE, {});
  const theme = THEME_VALUES.indexOf(data.theme) > -1 ? data.theme : 'auto';
  const lang = LANG_VALUES.indexOf(data.lang) > -1 ? data.lang : 'zh-CN';
  return { version: 1, theme: theme, lang: lang, updatedAt: data.updatedAt || null };
}

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
