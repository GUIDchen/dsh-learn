// analyze：把岗位 JD / 技术文档 / 截图里的文字变成"知识点清单 + 该练的题"。
// 输入三选一：--text "..."、--file path、--url link、--ocr 图片；没有参数就读 stdin。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { buildDraftPack, renderDraft, readSourceFile } from '../../core/site-learn.mjs';
import { analyzeText, summarizeAnalysis, MODULES, POINTS } from '../../core/knowledge.mjs';
import { fetchText, readTextFile, htmlToText } from '../../core/ingest.mjs';
import { ocrImage, saveDataUrl } from '../../core/ocr.mjs';
import { findTask, TASKS } from '../../core/tasks.mjs';
import { summarize as summarizeProgress } from '../../core/progress.mjs';
import { load } from '../../store.mjs';
import { isAbsolute, resolve } from 'node:path';
import { withinDir } from '../../core/project.mjs';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch (err) {
    return '';
  }
}

function moduleName(id) {
  const row = MODULES.filter(function (m) { return m.id === id; })[0];
  return row ? row.name : id;
}

// 把分析结果渲染成人读的清单：按模块分组，标出难度与对应题目
export function renderAnalysis(report, options) {
  const opts = options || {};
  const lines = [];
  lines.push(summarizeAnalysis(report));
  report.modules.forEach(function (mod) {
    lines.push('');
    lines.push('【' + mod.name + '】' + mod.points.length + ' 个知识点' + (mod.tasks.length ? '　可练 ' + mod.tasks.length + ' 题' : '　（题库暂未覆盖）'));
    mod.points.forEach(function (point) {
      const taskText = point.tasks.length ? ('　→ ' + point.tasks.join('、')) : '　→ （暂无对应题）';
      lines.push('  · ' + point.name + '（' + point.level + '）' + taskText);
      if (point.tip) lines.push('      ' + point.tip);
      if (opts.evidence !== false && point.evidence.length) {
        lines.push('      依据：' + point.evidence.map(function (e) { return '"' + e.text + '"'; }).join('、'));
      }
    });
  });
  if (report.unmatchedLines.length) {
    lines.push('');
    lines.push('字典没覆盖到的要求行（可以反馈给我加词条，或用 --list-points 看现有词条）：');
    report.unmatchedLines.forEach(function (line) { lines.push('  ? ' + line.slice(0, 80)); });
  }
  if (report.tasks.length) {
    lines.push('');
    lines.push('建议训练顺序（按命中强度排序）：');
    report.tasks.slice(0, opts.top || 10).forEach(function (row, index) {
      const task = findTask(row.taskId);
      lines.push('  ' + (index + 1) + '. ' + row.taskId + (task ? '　' + task.title : ''));
    });
    lines.push('');
    lines.push('开始训练：node src/cli.mjs drill --tasks=' + report.tasks.map(function (r) { return r.taskId; }).join(','));
  }
  return lines.join('\n');
}

export async function analyze(ctx) {
  const { args, asJson, out } = ctx;
  const top = Number(args.top) || 10;
  let text = '';
  let source = 'text';

  if (typeof args.text === 'string' && args.text.trim()) {
    text = args.text;
  } else if (typeof args.file === 'string') {
    const read = readTextFile(args.file);
    if (!read.ok) {
      console.error('读取失败：' + read.reason);
      return 2;
    }
    text = read.text;
    source = 'file:' + args.file;
  } else if (typeof args.url === 'string') {
    const fetched = await fetchText(args.url, {
      cookie: typeof args.cookie === 'string' ? args.cookie : undefined,
      cookieFile: typeof args['cookie-file'] === 'string' ? args['cookie-file'] : undefined
    });
    if (!fetched.ok) {
      console.error('抓取失败：' + fetched.reason);
      return 3;
    }
    text = fetched.text;
    source = 'url:' + args.url;
  } else if (typeof args.ocr === 'string') {
    const done = ocrImage(args.ocr);
    if (!done.ok) {
      console.error('OCR 失败：' + done.reason);
      return 4;
    }
    text = done.text;
    source = 'ocr:' + args.ocr + (done.compiled ? '（首次编译了 OCR 助手）' : '');
  } else if (typeof args.html === 'string') {
    text = htmlToText(readFileSync(args.html, 'utf8'));
    source = 'html:' + args.html;
  } else {
    text = readStdin();
    if (!text.trim()) {
      console.error('用法：node src/cli.mjs analyze --text "岗位描述" | --file jd.md | --url https://... | --ocr shot.png');
      console.error('      也可以把文字通过管道喂进来：pbpaste | node src/cli.mjs analyze');
      return 2;
    }
    source = 'stdin';
  }

  const report = analyzeText(text, { limit: Number(args.limit) || 20 });

  // --tasks 是给管道用的机器模式：stdout 只吐题号，一行一个（配合 drill --tasks=$(...)）
  if (args.tasks && !asJson) {
    console.error('识别出 ' + report.matched + ' 个知识点，推荐 ' + report.tasks.length + ' 道题');
    report.tasks.forEach(function (row) { console.log(row.taskId); });
    return 0;
  }

  if (asJson) {
    out(Object.assign({ source: source }, report));
    return 0;
  }
  console.log('输入来源：' + source + '（' + report.summary.textLength + ' 字）');
  console.log(renderAnalysis(report, { top: top }));
  return 0;
}

// learn-site：给一个网站/文档链接，抓正文里的命令示例，生成"题库草案"供人工复核。
// 刻意不自动入库：草案必须过一次体检（audit）并改写题面，才算自己的题。
export async function learnSite(ctx) {
  const { args, asJson, out } = ctx;
  const target = String(args._[1] || args.url || args.file || '').trim();
  if (!target) {
    console.error('用法：node src/cli.mjs learn-site <网页链接 | 本地文件> [--limit=20] [--out=drafts/x.json] [--cookie=...]');
    console.error('      --apply 会把草案写进 packs/ 目录（仍需人工复核并加进 BUILTIN_PACKS）');
    return 2;
  }

  // 边界先查：相对路径不许 ../ 爬出当前目录（显式绝对路径放行，用户自己指定位置）。
  // 放在抓取之前——省一次白跑的网络请求，也让这条规则不依赖网络就能测。
  if (typeof args.out === 'string' && args.out && !isAbsolute(args.out) && !withinDir(process.cwd(), resolve(process.cwd(), args.out))) {
    console.error('--out 必须写在 ' + process.cwd() + ' 之内，收到的是：' + args.out);
    return 2;
  }

  let raw = '';
  let source = target;
  if (/^https?:\/\//i.test(target)) {
    // 文档页通常比 JD 大得多：给 4MB 上限
    const fetched = await fetchText(target, {
      cookie: typeof args.cookie === 'string' ? args.cookie : undefined,
      maxBytes: 4 * 1024 * 1024,
      timeout: 20000,
      wantHtml: true
    });
    if (!fetched.ok) {
      console.error(fetched.reason);
      return 3;
    }
    // 有原始 HTML 就交给它抽代码块（更准），否则退化成正文扫描
    raw = fetched.html || fetched.text;
    try { source = new URL(target).hostname; } catch (err) { source = target; }
  } else {
    const read = readSourceFile(target);
    if (!read.ok) {
      console.error(read.reason);
      return 2;
    }
    raw = read.text;
    source = target.split('/').pop();
  }

  const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
  const result = buildDraftPack(raw, { source: source, limit: limit, packId: args.out ? undefined : undefined });

  if (asJson) {
    out(result);
    return 0;
  }

  console.log(renderDraft(result));
  if (!result.stats.tasks) {
    console.log('');
    console.log('没有识别到可用命令：这个页面可能不是命令行文档，或正文需要登录/JS 渲染。');
    return 0;
  }

  const outFile = typeof args.out === 'string' ? args.out : ('drafts/' + result.pack.id + '.json');
  const dir = outFile.split('/').slice(0, -1).join('/');
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(result.pack, null, 2) + '\n');
  console.log('');
  console.log('草案已写入：' + outFile + '（' + result.pack.tasks.length + ' 道题）');
  console.log('入库前请：1) 改写题面与提示　2) 跑 node src/cli.mjs pack validate ' + outFile + '　3) 跑 node src/cli.mjs audit');

  if (args.apply) {
    const target2 = 'packs/' + result.pack.id + '.json';
    writeFileSync(target2, JSON.stringify(result.pack, null, 2) + '\n');
    console.log('已复制到 ' + target2 + '：把 "' + result.pack.id + '" 加进 src/core/packs.mjs 的 BUILTIN_PACKS 才能被加载。');
  }
  return 0;
}

// modules：按模块总览——题库有多少题、练到什么程度、还有哪些知识点没题
export function modules(ctx) {
  const { asJson, out } = ctx;
  const summary = summarizeProgress(load().records, TASKS);
  const byTrack = new Map(summary.byTrack.map(function (row) { return [row.track, row]; }));

  const rows = MODULES.map(function (mod) {
    const points = POINTS.filter(function (point) { return point.module === mod.id; });
    const covered = points.filter(function (point) { return point.tasks.length; });
    const trackRow = mod.track ? byTrack.get(mod.track) : null;
    return {
      id: mod.id,
      name: mod.name,
      blurb: mod.blurb,
      track: mod.track || null,
      tasks: trackRow ? trackRow.total : 0,
      passed: trackRow ? trackRow.passed : 0,
      percent: trackRow ? trackRow.percent : null,
      points: points.length,
      pointsWithTasks: covered.length,
      pointsWithoutTasks: points.length - covered.length
    };
  });

  if (asJson) {
    out({ modules: rows, totalPoints: POINTS.length });
    return 0;
  }

  console.log('模块总览：' + MODULES.length + ' 个模块　' + POINTS.length + ' 个知识点　题库 ' + TASKS.length + ' 题');
  // 中文按两格宽对齐，否则 padEnd 出来的列会参差不齐
  function pad(text, width) {
    let used = 0;
    for (let i = 0; i < text.length; i++) used += text.charCodeAt(i) > 255 ? 2 : 1;
    return text + ' '.repeat(Math.max(1, width - used));
  }
  rows.forEach(function (row) {
    const cover = row.track
      ? pad(String(row.passed) + '/' + row.tasks, 9) + pad(row.percent + '%', 6)
      : pad('（暂无题库）', 15);
    const points = pad('知识点 ' + row.points, 10) + pad('有题 ' + row.pointsWithTasks, 9);
    console.log('  ' + pad(row.name, 20) + cover + points + row.blurb);
  });
  console.log('');
  console.log('按模块练习：node src/cli.mjs drill --track=<轨道> ｜ 分析岗位：node src/cli.mjs analyze --file jd.md');
  return 0;
}

// knowledge：打印字典里的全部知识点（离线可查，方便对着 JD 手工核对；也说明哪些还没有题目）
export function knowledge(ctx) {
  const { asJson, out } = ctx;
  if (asJson) {
    out({
      modules: MODULES,
      points: POINTS.map(function (point) {
        return { id: point.id, module: point.module, name: point.name, level: point.level, patterns: point.patterns, tasks: point.tasks, tip: point.tip };
      })
    });
    return 0;
  }
  console.log('知识点字典：' + POINTS.length + ' 条，覆盖 ' + MODULES.length + ' 个模块');
  MODULES.forEach(function (mod) {
    const points = POINTS.filter(function (point) { return point.module === mod.id; });
    if (!points.length) return;
    console.log('');
    console.log('【' + mod.name + '】' + mod.blurb);
    points.forEach(function (point) {
      console.log('  ' + point.id.padEnd(24) + point.level.padEnd(4) + point.name + (point.tasks.length ? '' : '　（暂无对应题）'));
    });
  });
  const uncovered = POINTS.filter(function (point) { return !point.tasks.length; });
  console.log('');
  console.log('有知识点但还没有题的：' + uncovered.length + ' 条　' + uncovered.map(function (point) { return point.id; }).join(', '));
  return 0;
}
