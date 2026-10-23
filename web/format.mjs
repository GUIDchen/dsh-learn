// 网页端的纯格式化工具：不依赖任何模块内状态，可以安全地从 app.mjs 里搬出来。
//
// 为什么要有这个文件：app.mjs 已经 3,4xx 行，按页面拆分需要先打通"浏览器原生 ESM 模块"
// 这条链路（服务端 /xx.mjs 通用分支 + Service Worker 缓存清单 + 体量守卫）。把纯函数先搬出来，
// 链路就验证完了，后续按页面搬运是纯搬运。

export function escapeText(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

export function baseName(file) {
  const text = String(file || '');
  const at = text.lastIndexOf('/');
  return at === -1 ? text : text.slice(at + 1);
}

export function levelText(level) {
  if (level === 'easy') return '简单';
  if (level === 'hard') return '困难';
  if (level === 'medium') return '中等';
  return '未标难度';
}

// 百分比：整数时直接给整数；0.1% 这种极小值保留一位小数（避免"0%"看起来像没通过）
export function percentText(passed, total, rounded) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safePassed = Number(passed) || 0;
  const value = typeof rounded === 'number' ? rounded : Math.round(safePassed / safeTotal * 100);
  if (value === 0 && safePassed > 0) return (Math.round(safePassed / safeTotal * 1000) / 10) + '%';
  return value + '%';
}
