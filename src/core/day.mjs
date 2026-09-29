// 日期口径的唯一实现（原来有三份，其中两份语义不同，见下）。
//
// 为什么必须是**本地时区**：记录里的 at 是 ISO 时间戳，学习者在 UTC+8 凌晨 00:30 练完一道题，
// 那一刻的 UTC 日期还是前一天。按 UTC 分日，目标提醒会说「今天还没练」，
// 而进度/连续天数按本地分日说「已经练了」——同一个晚上两个界面互相打架。
// core/progress.mjs 的注释早就写明了这一点（"避免 UTC 跨天把连续天数算断"），
// 但 core/trend.mjs 后来自己写了一份 UTC 版，于是 scorecard/reminder 与 progress 分了家。
export function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const pad = function (n) { return n < 10 ? '0' + n : String(n); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function streakDays(records, options) {
  const opts = options instanceof Date || typeof options === 'string' ? { now: options } : (options || {});
  const days = new Set();
  (records || []).forEach(function (item) {
    const key = dayKey(item.at);
    if (key) days.add(key);
  });
  if (!days.size) return 0;
  const today = opts.now ? new Date(opts.now) : new Date();
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // 今天没练不算断：从昨天开始数
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
