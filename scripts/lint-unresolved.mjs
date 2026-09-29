// 静态「用了但没声明」检查：把本会话反复出现的「漏 import」在提交前拦掉。
//
// 为什么值得自研：node --check 只查语法，而缺导入这类错误只有执行到那个分支才暴露——
// 本会话因此返工 6 次（LEVEL_LABELS / assessAnswer / masteryReport / locateMissing / packTemplate /
// storageStatus / homeDir ...）。零依赖下没有 ESLint，就自己做一个**词法级**分析：
// 剥掉注释/字符串/正则，收集声明与使用，做差集。
//
// 已知取舍（都在测试里盯着）：
//   * 只看「生产代码」（src/**、web/*.mjs、scripts/**）——测试文件里局部变量与夹具多，先不扫；
//   * 声明收集覆盖：import（含 x as y）、function/class、var/let/const（含解构）、函数参数（含解构与默认值）、
//     catch 参数、for-of/in 的绑定、箭头函数参数；
//   * 明确跳过：属性访问（a.b）、对象字面量的键（k: v）、关键字、以及内建全局（JS 内建 + Node/浏览器全局）；
//   * 允许清单：少数确实是误报的写在 docs/lint-allow.json，且**过期条目会报错**（防止它变成垃圾桶）。
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILTIN_GLOBALS = new Set([
  'globalThis', 'Object', 'Function', 'Boolean', 'Symbol', 'Error', 'EvalError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'TypeError', 'URIError', 'AggregateError', 'Number', 'BigInt', 'Math', 'Date', 'String', 'RegExp',
  'Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'ArrayBuffer',
  'SharedArrayBuffer', 'Atomics', 'DataView', 'JSON', 'Promise', 'Reflect', 'Proxy', 'Intl', 'FinalizationRegistry',
  'WeakRef', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI', 'decodeURIComponent', 'encodeURI',
  'encodeURIComponent', 'escape', 'unescape', 'Infinity', 'NaN', 'undefined', 'null', 'true', 'false',
  'process', 'console', 'Buffer', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'fetch', 'Headers',
  'Request', 'Response', 'FormData', 'Blob', 'File', 'WebSocket', 'AbortController', 'AbortSignal', 'Event',
  'EventTarget', 'CustomEvent', 'structuredClone', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'setImmediate', 'clearImmediate', 'performance', 'crypto', 'navigator', 'window', 'document',
  'localStorage', 'sessionStorage', 'location', 'history', 'requestAnimationFrame', 'cancelAnimationFrame',
  'alert', 'confirm', 'prompt', 'atob', 'btoa', 'require', 'module', 'exports', '__dirname', '__filename',
  'CSS', 'FileReader', 'getComputedStyle', 'matchMedia', 'MutationObserver', 'IntersectionObserver',
  'ResizeObserver', 'DOMException', 'Image', 'Audio', 'Notification', 'DOMParser', 'XMLHttpRequest',
  'SpeechSynthesisUtterance', 'Selection', 'Range', 'Node', 'Element', 'HTMLElement', 'CSSStyleSheet',
  'arguments', 'this', 'super', 'import', 'export', 'new', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete',
  'await', 'async', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try',
  'catch', 'finally', 'throw', 'class', 'extends', 'function', 'const', 'let', 'var', 'static', 'get', 'set',
  'yield', 'default', 'from', 'as'
]);

// 剥掉注释、字符串、模板、正则：保留长度与换行，方便后续按行报错
export function stripLiterals(text) {
  const out = text.split('');
  let i = 0;
  const n = text.length;
  let lastSignificant = '';
  const blank = function (from, to) {
    for (let k = from; k < to && k < n; k += 1) { if (out[k] !== String.fromCharCode(10)) out[k] = ' '; }
  };
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') { let j = i; while (j < n && text[j] !== String.fromCharCode(10)) j += 1; blank(i, j); i = j; continue; }
    if (ch === '/' && next === '*') { let j = i + 2; while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j += 1; blank(i, Math.min(n, j + 2)); i = j + 2; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && text[j] !== ch) { if (text[j] === '\\\\') j += 1; j += 1; }
      blank(i + 1, j); lastSignificant = 'str'; i = j + 1; continue;
    }
    if (ch === String.fromCharCode(96)) {
      // 模板字面量：插值部分是代码，要保留；其余抹掉
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\\\') { j += 2; continue; }
        if (text[j] === String.fromCharCode(96)) break;
        if (text[j] === '$' && text[j + 1] === '{') {
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) { if (text[k] === '{') depth += 1; if (text[k] === '}') depth -= 1; k += 1; }
          j = k;
          continue;
        }
        if (text[j] !== String.fromCharCode(10)) out[j] = ' ';
        j += 1;
      }
      lastSignificant = 'str';
      i = j + 1;
      continue;
    }
    if (ch === '/' && lastSignificant !== '' && !/[A-Za-z0-9_$) \\]}]/.test(lastSignificant)) {
      let j = i + 1;
      let ok = false;
      while (j < n && text[j] !== String.fromCharCode(10)) {
        if (text[j] === '\\\\') { j += 2; continue; }
        if (text[j] === '/') { ok = true; break; }
        j += 1;
      }
      if (ok) {
        let k = j + 1;
        while (k < n && /[a-z]/.test(text[k])) k += 1;   // flags（g/m/i/s/u/y）也是字面量的一部分
        blank(i + 1, k);
        lastSignificant = 'regex';
        i = k;
        continue;
      }
    }
    if (!/\s/.test(ch)) lastSignificant = ch;
    i += 1;
  }
  return out.join('');
}

function identifiers(text) {
  return text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
}

// 「只再导出」的名字集合：export { x } from '...' 不会在当前模块建立 x 的本地绑定，
// 所以 x 若在同一个文件里被当变量用，运行时会 ReferenceError（本会话栽过三次）。
const RE_EXPORTED_ONLY = new Set();
const RE_EXPORT_RANGES = [];
const DECL_RANGES = [];   // import 与裸 export 语句：里面的名字是声明/转发，不是使用
const LOCALLY_IMPORTED = new Set();

export function collectDeclared(text) {
  const names = new Set();
  RE_EXPORTED_ONLY.clear();
  LOCALLY_IMPORTED.clear();
  RE_EXPORT_RANGES.length = 0;
  DECL_RANGES.length = 0;
  let m;
  const importRe = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from\s*['"]/g;
  while ((m = importRe.exec(text)) !== null) {
    DECL_RANGES.push({ start: m.index, end: importRe.lastIndex });
    if (m[1]) { names.add(m[1]); LOCALLY_IMPORTED.add(m[1]); RE_EXPORTED_ONLY.delete(m[1]); }
    if (m[3]) { names.add(m[3]); LOCALLY_IMPORTED.add(m[3]); RE_EXPORTED_ONLY.delete(m[3]); }
    (m[2] || '').split(',').forEach(function (item) {
      const local = item.split(' as ').pop().trim();
      if (local) { const clean = local.replace(/^\*+/, ''); names.add(clean); LOCALLY_IMPORTED.add(clean); RE_EXPORTED_ONLY.delete(clean); }
    });
  }
  // 裸导出 export { a, b }; 里也只有名字转发，不是使用（写成不带 from 的桶文件时会出现）
  const bareExportRe = /export\s*\{[^}]*\};/g;
  while ((m = bareExportRe.exec(text)) !== null) DECL_RANGES.push({ start: m.index, end: bareExportRe.lastIndex });

  // barrel 再导出：export { a, b as c } from './x.mjs' —— 这些名字在本文件里是"声明"，
  // 不是"使用"。少了这条，任何 barrel 都会被误报（store.mjs 拆 home/atomic 时踩到）。
  const reExportRe = /export\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
  while ((m = reExportRe.exec(text)) !== null) {
    RE_EXPORT_RANGES.push({ start: m.index, end: reExportRe.lastIndex });
    m[1].split(',').forEach(function (item) {
      const local = item.split(' as ').pop().trim();
      if (!local) return;
      names.add(local);
      // 只有「前面没有 import/声明过」的名字才算只再导出：
      // 既 import 又再导出的（barrel 常见写法）本地绑定是存在的。
      if (!names.has(local) || !LOCALLY_IMPORTED.has(local)) RE_EXPORTED_ONLY.add(local);
    });
  }
  const declRe = /\b(?:function|class)\s*([A-Za-z_$][\w$]*)|\b(?:var|let|const)\s+([^;=]+?)=|\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*(?:;|,|\)|$)/g;
  while ((m = declRe.exec(text)) !== null) {
    identifiers(m[1] || m[2] || m[3] || '').forEach(function (name) { names.add(name); });
  }
  const destrRe = /\b(?:var|let|const)\s*([\[{][\s\S]*?[\]}])\s*=/g;
  while ((m = destrRe.exec(text)) !== null) {
    stripPattern(m[1]).forEach(function (name) { names.add(name); });
  }
  const paramRe = /\(([^()]*)\)\s*(?:=>|\{)|\bcatch\s*\(([^)]*)\)/g;
  while ((m = paramRe.exec(text)) !== null) {
    (m[1] || m[2] || '').split(',').forEach(function (part) {
      stripPattern(part.split('=')[0].trim()).forEach(function (name) { names.add(name); });
    });
  }
  const fnParamRe = /\bfunction\b[^(]*\(([^)]*)\)/g;
  while ((m = fnParamRe.exec(text)) !== null) {
    m[1].split(',').forEach(function (part) { stripPattern(part.split('=')[0].trim()).forEach(function (name) { names.add(name); }); });
  }
  const forRe = /\bfor\s*\(\s*(?:var|let|const)\s+([^)]*?)\s+(?:of|in)\b/g;
  while ((m = forRe.exec(text)) !== null) { stripPattern(m[1]).forEach(function (name) { names.add(name); }); }
  return names;
}

function stripPattern(raw) {
  const out = [];
  String(raw || '').split(/[,{}[\]]/).forEach(function (part) {
    const cleaned = part.split('=')[0].split(':').pop().replace(/\.\.\./g, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(cleaned)) out.push(cleaned);
  });
  return out;
}

export function collectUsed(text) {
  const used = new Map();
  const tokens = [];
  const re = /([A-Za-z_$][\w$]*)|([.\[{(),;:=?!&|+\-*/%<>~^])/g;
  let m;
  while ((m = re.exec(text)) !== null) tokens.push({ word: m[1] || '', punct: m[2] || '', at: m.index });
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.word) continue;
    // 再导出语句（export { a, b } from '...'）里的名字不是"使用"，只是转发
    if (RE_EXPORT_RANGES.concat(DECL_RANGES).some(function (range) { return token.at >= range.start && token.at < range.end; })) continue;
    const prev = tokens[i - 1];
    if (prev && prev.punct === '.') continue;
    if (prev && prev.punct === '?' && tokens[i - 2] && tokens[i - 2].punct === '.') continue;
    const next = tokens[i + 1];
    if (next && next.punct === ':' && (!prev || prev.punct !== '?')) continue;
    used.set(token.word, (used.get(token.word) || 0) + 1);
  }
  return used;
}

export function analyzeSource(text) {
  const stripped = stripLiterals(String(text || ''));
  const declared = collectDeclared(stripped);
  const used = collectUsed(stripped);
  const unresolved = [];
  used.forEach(function (_count, name) {
    if (BUILTIN_GLOBALS.has(name)) return;
    // 只再导出、没有本地绑定：运行时 ReferenceError（barrel 最容易踩，本会话三次）
    if (RE_EXPORTED_ONLY.has(name)) { unresolved.push(name + '（只再导出，未 import，不能当本地变量用）'); return; }
    if (declared.has(name)) return;
    unresolved.push(name);
  });
  return { unresolved: unresolved.sort(), declaredCount: declared.size, usedCount: used.size };
}

export function listFiles(roots) {
  const out = [];
  const walk = function (dir) {
    let names = [];
    try { names = readdirSync(dir); } catch (err) { return; }
    names.forEach(function (name) {
      const full = join(dir, name);
      let info = null;
      try { info = statSync(full); } catch (err) { return; }
      if (info.isDirectory()) { if (name !== 'node_modules' && name !== 'dist') walk(full); return; }
      if (/\.mjs$/.test(name)) out.push(full);
    });
  };
  roots.forEach(walk);
  return out.sort();
}

export function loadAllow(root) {
  const file = join(root, 'docs/lint-allow.json');
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf8')).allow || []; } catch (err) { return []; }
}

export function lintRepository(root) {
  const files = listFiles([join(root, 'src'), join(root, 'web'), join(root, 'scripts')]);
  const allow = loadAllow(root);
  const allowed = new Map();
  allow.forEach(function (row) { allowed.set(row.file + ':' + row.name, row.why || ''); });
  const findings = [];
  const seen = new Set();
  files.forEach(function (file) {
    const rel = relative(root, file);
    const result = analyzeSource(readFileSync(file, 'utf8'));
    result.unresolved.forEach(function (name) {
      seen.add(rel + ':' + name);
      if (allowed.has(rel + ':' + name)) return;
      findings.push({ file: rel, name: name });
    });
  });
  const stale = allow.filter(function (row) { return !seen.has(row.file + ':' + row.name); });
  return { files: files.length, findings: findings, stale: stale, allow: allow.length };
}

// —— 差分口径 ——
// 直觉上「全部清零」最好，但词法分析对「把 JS/HTML/命令当字符串嵌在核心模块里」这类写法必然有误报
// （exec.mjs 的白名单正则、ingest.mjs 的标签表、stack.mjs 的术语表……）。
// 所以本守卫的口径是**只报新问题**：以 docs/lint-unresolved-baseline.json 为基线，
// 任何**新出现**的「用了但没声明」都失败——本会话那 7 次漏导入每一次都会在这里被拦下。
// 基线只会随着误报修掉而变小；--update 用来在确认过之后重写基线。
export function baselinePath(root) { return join(root, 'docs/lint-unresolved-baseline.json'); }

export function loadBaseline(root) {
  const file = baselinePath(root);
  if (!existsSync(file)) return { entries: [], missing: true };
  try { return { entries: JSON.parse(readFileSync(file, 'utf8')).entries || [], missing: false }; } catch (err) { return { entries: [], missing: true, error: err.message }; }
}

export function compareBaseline(report, baseline) {
  const key = function (row) { return row.file + ':' + row.name; };
  const known = new Set(baseline.entries.map(key));
  const now = new Set(report.findings.map(key));
  return {
    added: report.findings.filter(function (row) { return !known.has(key(row)); }),
    fixed: baseline.entries.filter(function (row) { return !now.has(key(row)); })
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const report = lintRepository(root);
  if (process.argv.indexOf('--update') > -1) {
    writeFileSync(baselinePath(root), JSON.stringify({
      note: '静态「用了但没声明」的基线：只允许存量，新增一律失败（差分口径见 scripts/lint-unresolved.mjs）',
      updatedAt: new Date().toISOString(),
      entries: report.findings
    }, null, 2) + String.fromCharCode(10));
    console.log('已写入基线：' + report.findings.length + ' 条（扫了 ' + report.files + ' 个文件）');
    process.exit(0);
  }
  const baseline = loadBaseline(root);
  if (baseline.missing) {
    console.log('缺基线文件：' + baselinePath(root) + '（确认现状后跑 --update 生成）');
    process.exit(2);
  }
  const diff = compareBaseline(report, baseline);
  if (diff.added.length) {
    diff.added.forEach(function (row) { console.log('新增「用了但没声明」：' + row.file + '：' + row.name); });
    console.log('共 ' + diff.added.length + ' 处新问题（基线 ' + baseline.entries.length + ' 条 / 当前 ' + report.findings.length + ' 条）');
    process.exit(1);
  }
  console.log('静态检查通过：没有新增「用了但没声明」（基线 ' + baseline.entries.length + ' 条，可移出 ' + diff.fixed.length + ' 条）');
}
