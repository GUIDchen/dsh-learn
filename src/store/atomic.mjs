// 原子写、损坏留档、写锁：三个域（进度/投递/偏好）都要用的底层件，所以单独一层。
// 设计与事故背景见 store.mjs 顶部注释（快照写临时文件再 rename、日志 O_APPEND、归档加锁）。
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, ensureHome } from './home.mjs';
export function parseRecords(text) {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return { records: data, broken: false };
    if (data && Array.isArray(data.records)) return { records: data.records, broken: false };
    return { records: [], broken: true };
  } catch (err) {
    return { records: [], broken: true };
  }
}

export function quarantine(file) {
  if (!existsSync(file)) return null;
  const target = file + '.corrupt-' + Date.now();
  try {
    renameSync(file, target);
    return target;
  } catch (err) {
    return null;
  }
}

export function withCompactLock(fn) {
  ensureHome();
  const lock = join(HOME, '.compact.lock');
  const started = Date.now();
  const hardStop = started + 30000;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx');
      try {
        return fn();
      } finally {
        try { closeSync(fd); } catch (err) { /* 已关 */ }
        try { unlinkSync(lock); } catch (err) { /* 已被清 */ }
      }
    } catch (err) {
      if (err.code !== 'EEXIST') {
        // 故障注入实测：只读 home / 写满磁盘时，原始 EACCES/ENOSPC 对用户毫无指向性，
        // 这里补上「是哪个目录、怎么办」，并保留原始 code/cause 便于程序判断。
        const hint = (err.code === 'EACCES' || err.code === 'EPERM')
          ? ('　（目录不可写：检查 ' + HOME + ' 的权限，或设置 DSH_LEARN_HOME 指到可写目录）')
          : (err.code === 'ENOSPC' ? '　（磁盘写满：先清理空间；本次写入没有执行）' : '');
        const wrapped = new Error('存储写入失败：' + (err.message || err) + hint);
        wrapped.code = err.code;
        wrapped.cause = err;
        throw wrapped;
      }
      // 陈旧锁（持有者挂了）直接抢占
      try {
        if (Date.now() - statSync(lock).mtimeMs > 5000) { unlinkSync(lock); continue; }
      } catch (gone) { /* 锁刚被释放，下一轮就能拿到 */ }
      if (Date.now() > hardStop) {
        throw new Error('存储写锁 30 秒未释放（可能有卡死的进程持有 ' + lock + '），本次写入未执行，请重试');
      }
      // 等锁：故意不做"拿不到就裸写"的兜底——那和归档 rename 打架，正是丢记录的来源
      const waitUntil = Date.now() + 5;
      while (Date.now() < waitUntil) { /* 自旋等锁 */ }
    }
  }
}

export function readJsonFile(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

export function writeJsonAtomic(file, data) {
  ensureHome();
  const tmp = file + '.tmp-' + process.pid;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    renameSync(tmp, file);
  } catch (err) {
    // 写失败（目标被目录占位、只读、写满）不能留下半成品：清掉临时文件再抛
    try { unlinkSync(tmp); } catch (gone) { /* 没写成功也没有它 */ }
    throw err;
  }
  return file;
}
