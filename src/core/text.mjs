// 共用的小工具：难度标签与 slug。
//
// 为什么收敛到一处：评审时量到 levelLabel 有 3 份、slug 有 3 份、LEVEL_ORDER 有 2 份。
// 但三份 slug **行为并不相同**（一份保留中文、一份限长 48、一份只留 ASCII 限长 40），
// 所以这里不是"合成一个函数"，而是**一份实现 + 显式选项**，各调用点按原行为迁移——
// 重构不能顺手改掉别人的行为。

export const LEVEL_ORDER = { easy: 0, medium: 1, hard: 2 };
export const LEVEL_LABELS = { easy: '简单', medium: '中等', hard: '困难' };

export function levelLabel(level) {
  return LEVEL_LABELS[level] || '未标难度';
}

// 排序用的难度序号：未标注的与"中等"同档（保持原有口径）
export function levelRank(level) {
  return LEVEL_ORDER[level] === undefined ? 1 : LEVEL_ORDER[level];
}

// slug：保留中英文，其余字符折叠成连字符。
// options.max 截断长度；options.fallback 为空时的兜底（不传则返回空串）。
export function slug(text, options) {
  const opts = options || {};
  const raw = String(text || '').trim().toLowerCase();
  const folded = raw.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  const cut = opts.max ? folded.slice(0, opts.max) : folded;
  return cut || (opts.fallback || '');
}

// slugAscii：只保留 ASCII（命令名 / 包名 / 文件名场景，中文会被丢掉）。
export function slugAscii(text, options) {
  const opts = options || {};
  const folded = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return opts.max ? folded.slice(0, opts.max) : folded;
}
