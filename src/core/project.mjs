// 项目目录与仓库解析：把"某个项目里能学到什么"落成可复核的草案。
//
// 设计上刻意分两层：
//   1. 项目目录（~/.dsh-learn/projects/<名字>/）只负责"收集"：截图 / 文字 / 链接 / 仓库各是什么时候加的、解析出多少知识点；
//   2. 草案（drafts/*.json）永远是草案：不自动进题库，必须人工改写题目再跑一次 audit。
// 这样"AI 生成的题"不会绕过判定口径直接污染题库。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { POINTS, analyzeText } from './knowledge.mjs';
// 知识点 id → 记录：检索命中时要把 id 说成人话（显示中文名）
const POINT_INDEX = new Map(POINTS.map(function (row) { return [row.id, row]; }));
import { taskStats } from './progress.mjs';
import { PASS_SCORE } from './judge.mjs';
import { fileFingerprint, memo } from './cache.mjs';
import { levelLabel, levelRank, slug as slugBase } from './text.mjs';
import { TASKS } from './tasks.mjs';
import { PACK_DIR, userPackDir } from './packs.mjs';
import { htmlToText } from './ingest.mjs';
import { buildDraftPack, renderDraft } from './site-learn.mjs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';

export function projectsRoot(home) {
  return (home || process.env.DSH_LEARN_HOME || join(homedir(), '.dsh-learn')) + '/projects';
}

// 原行为：保留中英文、限长 48、空则 'project'（实现在 core/text.mjs，选项在这里固定）
export function slug(name) {
  return slugBase(name, { max: 48, fallback: 'project' });
}

export function projectDir(name, options) {
  const opts = options || {};
  return join(projectsRoot(opts.home), slug(name));
}

// 只有一层文件名：报表名、草案名这类"用户给的片段"必须过这一关，
// 否则 ../../etc/hosts 这种输入就能借 join 读到项目目录之外（实测能读到 /etc/hosts）。
export function safeBaseName(name, fallback) {
  const raw = String(name || '').trim();
  const base = raw.split(/[\\/]/).pop() || '';
  if (!base || base === '.' || base === '..' || base !== raw) return fallback === undefined ? '' : fallback;
  return base;
}

// 目标路径必须落在允许的根之内：调用方给的是"想写哪儿"，这里只放行根内的写法。
export function withinDir(baseDir, candidate) {
  const base = resolve(baseDir) + sep;
  const target = resolve(candidate);
  return target === resolve(baseDir) || target.indexOf(base) === 0;
}

export function projectMetaPath(name, options) {
  return join(projectDir(name, options), 'project.json');
}

// 三种状态：没建过 / 正常 / **元数据坏了**。
// 坏的必须与"没建过"分开：否则任何一次写入都会把损坏的 project.json 静默覆盖掉，
// 连同里面的来源台账一起丢（实测：2 条来源 → 损坏 → 再收一次 → 只剩 1 条，且没有任何提示）。
export function projectState(name, options) {
  const file = projectMetaPath(name, options);
  if (!existsSync(file)) return { state: 'missing', file: file };
  const meta = readProject(name, options);
  return meta ? { state: 'ok', file: file, meta: meta } : { state: 'corrupted', file: file };
}

export function createProject(name, options) {
  const opts = options || {};
  const dir = projectDir(name, options);
  const meta = readProject(name, options);
  if (meta) return { ok: false, reason: '项目已存在：' + dir, dir: dir, meta: meta };
  const state = projectState(name, options);
  if (state.state === 'corrupted') {
    // 不动坏文件：先让人看一眼，再决定备份、修复还是换名字
    return {
      ok: false,
      corrupted: true,
      dir: dir,
      reason: '项目元数据损坏，不敢覆盖：' + state.file + '（先备份或修好这个 JSON，或换一个项目名）'
    };
  }
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'drafts'), { recursive: true });
  mkdirSync(join(dir, 'notes'), { recursive: true });
  const created = {
    name: slug(name),
    displayName: String(name || slug(name)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sources: [],
    note: opts.note || ''
  };
  writeFileSync(projectMetaPath(name, options), JSON.stringify(created, null, 2) + '\n');
  return { ok: true, dir: dir, meta: created };
}

export function readProject(name, options) {
  const file = projectMetaPath(name, options);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (err) { return null; }
}

export function writeProject(name, meta, options) {
  const next = Object.assign({}, meta, { updatedAt: new Date().toISOString() });
  writeFileSync(projectMetaPath(name, options), JSON.stringify(next, null, 2) + '\n');
  return next;
}

// 缺原文的来源数：meta 里记了 textFile；旧数据没有这个字段，文件被删也算缺。
// 精确判断（不做"猜路径"），因为 doctor / backfill 用的就是同一个事实。
export function missingTextSources(row, options) {
  const dir = projectDir(row.name, options);
  return (row.sources || []).filter(function (item) {
    if (!item.textFile) return true;
    return !existsSync(join(dir, item.textFile));
  });
}

// 一条项目记录是否命中关键词；返回命中的字段，便于界面说明"为什么它出现在结果里"。
// 命中面：项目名 / 显示名 / 备注 / 来源文件名 / 来源知识点（id 与中文名）
export function projectSearchHit(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { hit: true, fields: [] };
  const fields = [];
  const hit = function (label, value) {
    if (value && String(value).toLowerCase().indexOf(q) > -1) fields.push(label);
  };
  hit('项目名', row.name);
  hit('显示名', row.displayName);
  hit('备注', row.note);
  (row.sources || []).forEach(function (item) {
    hit('来源文件名', item.source);
    (item.points || []).forEach(function (id) {
      hit('知识点', id);
      const point = POINT_INDEX.get(id);
      if (point) hit('知识点名称', point.name);
    });
  });
  return { hit: fields.length > 0, fields: fields };
}

// 筛选 + 排序：CLI / 接口 / 原生端都调它，避免三处各写一份导致口径漂移
export function filterProjects(rows, options) {
  const opts = options || {};
  const query = opts.query || opts.q || '';
  const onlyMissing = Boolean(opts.missingText);
  const sort = String(opts.sort || 'updated');
  let list = (rows || []).slice();
  if (onlyMissing) list = list.filter(function (row) { return missingTextSources(row, opts).length > 0; });
  if (String(query).trim()) {
    list = list.filter(function (row) { return projectSearchHit(row, query).hit; });
  }
  const count = function (row, key) {
    return (row.sources || []).reduce(function (sum, item) { return sum + (item[key] || 0); }, 0);
  };
  if (sort === 'name') list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  else if (sort === 'sources') list.sort(function (a, b) { return (b.sources || []).length - (a.sources || []).length; });
  else if (sort === 'knowledge') list.sort(function (a, b) { return count(b, 'knowledge') - count(a, 'knowledge'); });
  else if (sort === 'tasks') list.sort(function (a, b) { return count(b, 'tasks') - count(a, 'tasks'); });
  else list.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
  return list;
}

export function listProjects(options) {
  const opts = options || {};
  const root = projectsRoot(opts.home);
  if (!existsSync(root)) return [];
  const all = readdirSync(root)
    .filter(function (entry) { return statSync(join(root, entry)).isDirectory(); })
    .map(function (entry) { return readProject(entry, opts) || { name: entry, sources: [] }; });
  return filterProjects(all, opts);
}

// 记一条来源：截图 / 文字 / 链接 / 仓库。artifacts 是这次落到项目目录里的文件（相对路径）。
export function recordSource(name, entry, options) {
  const opts = options || {};
  const meta = readProject(name, options) || { name: slug(name), createdAt: new Date().toISOString(), sources: [] };
  const row = {
    kind: entry.kind,
    source: entry.source,
    at: new Date().toISOString(),
    knowledge: entry.knowledge || 0,
    tasks: entry.tasks || 0,
    // 记下命中的知识点 id：有了它才能从项目直接生成"开练清单"（只记数量的话就只能看不能练）
    points: entry.points || [],
    artifacts: entry.artifacts || [],
    // 原文文件（项目页点来源时读它）；老数据没有这个字段时前端会如实说明
    textFile: entry.textFile || '',
    textChars: entry.textChars || 0
  };
  meta.sources = (meta.sources || []).concat([row]);
  return writeProject(name, meta, options);
}

export function writeProjectFile(name, relative, content, options) {
  const dir = projectDir(name, options);
  const target = resolve(dir, relative);
  if (target.indexOf(resolve(dir)) !== 0) throw new Error('路径越出项目目录：' + relative);
  const parts = target.split('/');
  parts.pop();
  mkdirSync(parts.join('/'), { recursive: true });
  writeFileSync(target, content);
  return target;
}

export function projectArtifactName(prefix, source) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tail = slug(basename(String(source || 'input'))).slice(0, 24);
  return prefix + '-' + stamp + (tail ? '-' + tail : '');
}
// 一次输入 → 知识点 + 草案 + 落盘 + 记账。CLI 与网页版共用这一份，避免两边行为不一致。
// input: { kind: 'text'|'link'|'screenshot'|'file'|'repo', source, text, commandText? }
// commandText 只在「知识点该看全文、抽命令只该看命令部分」时给：
// 仓库来源就是这样——知识点要读仓库画像（信号、清单），但抽命令不能读清单里的指令，
// 否则 go.mod 的 `go 1.22` 会被当成一条命令生成草案（实测网页版比命令行多出这种废草案）。
export function ingestIntoProject(name, input, options) {
  const opts = options || {};
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 20));
  const existing = readProject(name, options);
  if (!existing) {
    const created = createProject(name, options);
    if (!created.ok) {
      // 元数据损坏时如实拒绝，而不是"重建一个空台账"把原内容顶掉
      return { ok: false, error: created.reason, corrupted: Boolean(created.corrupted), dir: created.dir };
    }
  }
  const meta = existing || { name: slug(name), createdAt: new Date().toISOString(), sources: [] };
  // 链接来源拿到的是整页 HTML。这里**只剥一次**标签，知识点与命令抽取都用同一份纯文本：
  // 之前知识点用剥过的、草案却拿到原始 HTML，于是"从网页抽命令生成草案题"对任何网页都是失效的。
  const raw = String(input.text || '');
  const plain = raw.indexOf('<') > -1 ? htmlToText(raw) : raw;
  const report = analyzeText(plain, { limit: limit });
  // 仓库来源的包名带上 repo- 前缀：一眼能看出草案是从仓库还是从网页文档来的
  const packId = input.kind === 'repo'
    ? 'repo-' + (slug(String(input.source || '').split('/').pop()) || 'repo')
    : undefined;
  const commandSource = input.commandText ? String(input.commandText) : plain;
  const draft = buildDraftPack(commandSource, { source: input.source, limit: limit, packId: packId });
  const artifacts = [];
  const noteRel = 'notes/' + projectArtifactName(input.kind, input.source) + '.md';
  writeProjectFile(name, noteRel, '# 来源：' + input.source + '（' + input.kind + '）\n\n' + renderKnowledgeNote(report), options);
  artifacts.push(noteRel);
  let draftFiles = null;
  if (draft.stats.tasks) {
    const packRel = 'drafts/' + projectArtifactName(input.kind, input.source) + '.json';
    writeProjectFile(name, packRel, JSON.stringify(draft.pack, null, 2) + '\n', options);
    const reviewRel = packRel.replace(/\.json$/, '.md');
    writeProjectFile(name, reviewRel, renderDraft(draft) + '\n', options);
    draftFiles = { pack: packRel, review: reviewRel };
    artifacts.push(packRel, reviewRel);
  }
  const pointIds = pointIdsFromReport(report);
  // 原文另存一份（sources/NNNN-xxx.txt）：项目页要能看「这条来源到底写了什么」，
  // 只存提炼后的笔记不够——用户要看的是原封不动的岗位描述/文档。
  const sourceIndex = (meta.sources || []).length + 1;
  const textRel = 'sources/' + String(sourceIndex).padStart(4, '0') + '-' + slug(String(input.source || 'source')).slice(0, 40) + '.txt';
  writeProjectFile(name, textRel, raw + (raw.endsWith('\n') ? '' : '\n'), options);
  artifacts.push(textRel);
  const next = recordSource(name, {
    kind: input.kind,
    source: input.source,
    knowledge: report.matched,
    tasks: draft.stats.tasks,
    points: pointIds,
    artifacts: artifacts,
    textFile: textRel,
    textChars: raw.length
  }, options);
  // 每次收完来源就地刷新索引：前端读到的永远是当前状态，不用等下一次分析
  const index = buildProjectIndex(name, options);
  return { project: next, knowledge: report, draft: draft, draftFiles: draftFiles, artifacts: artifacts, index: index, dir: projectDir(name, options) };
}

// 项目索引：把"这个项目里能练什么"落成项目目录里的一份可加载清单（tasks.json）。
// 为什么要有它：项目目录原先只有笔记（知识点）和草案（题），想练一次就得重新分析一遍；
// 有了索引，任何客户端打开项目就能直接列出"知识点 → 可练题"和"草案包 → 待入库的题"。
export function buildProjectIndex(name, options) {
  const opts = options || {};
  const meta = readProject(name, options);
  if (!meta) return null;
  const dir = projectDir(name, options);
  // 「已入总题库」查两个地方：用户题库目录（promote 的默认去处）与随工具发布的 packs/。
  // 允许 opts.packDir 覆盖，测试要在临时目录里验证这件事，不能去动真实的题库目录。
  const packDirs = opts.packDir ? [opts.packDir] : [userPackDir(opts), PACK_DIR];
  const points = [];
  const seenPoint = new Set();
  (meta.sources || []).forEach(function (row) {
    (row.points || []).forEach(function (id) {
      if (seenPoint.has(id)) return;
      seenPoint.add(id);
      const point = POINTS.filter(function (p) { return p.id === id; })[0];
      if (!point) return;
      points.push({ id: point.id, name: point.name, module: point.module, level: point.level, tasks: (point.tasks || []).slice() });
    });
  });
  const taskIds = [];
  points.forEach(function (p) { p.tasks.forEach(function (id) { if (taskIds.indexOf(id) === -1) taskIds.push(id); }); });
  const tasks = taskIds.map(function (id) {
    const task = TASKS.filter(function (t) { return t.id === id; })[0];
    if (!task) return null;
    return { id: task.id, track: task.track, level: task.level || null, title: task.title, source: "builtin" };
  }).filter(Boolean);
  // 草案包：扫 drafts/*.json。坏文件跳过但记下来——索引不该被一个坏草案拖垮
  const drafts = [];
  const draftsDir = join(dir, "drafts");
  if (existsSync(draftsDir)) {
    readdirSync(draftsDir).filter(function (f) { return f.endsWith(".json"); }).sort().forEach(function (file) {
      try {
        const pack = JSON.parse(readFileSync(join(draftsDir, file), "utf8"));
        // 计划草案（kind: plan，如 JD → 练习清单）没有新题定义，只有一份"练这些题"的清单：
        // 索引要把它与题目草案区别开，界面才不会给计划草案一个"加入总题库"的按钮。
        const isPlan = pack.kind === 'plan';
        drafts.push({
          file: "drafts/" + file,
          packId: pack.id || null,
          track: pack.track || null,
          name: pack.name || "",
          kind: isPlan ? 'plan' : 'pack',
          planTasks: isPlan ? (pack.nextUp || pack.rows || []).map(function (row) { return row.taskId; }).filter(Boolean) : [],
          // 已经在总题库里了吗：promote 到 packs/ 之后，索引要如实标出来，
          // 否则界面上会一直劝用户"加入总题库"，而他早就加过了
          inCatalog: Boolean(pack.id) && packDirs.some(function (dir) { return existsSync(join(dir, slug(pack.id) + ".json")); }),
          tasks: isPlan
            ? (pack.rows || []).map(function (row) {
                return { id: row.taskId, title: row.title, level: row.level || null, elements: 0 };
              })
            : (pack.tasks || []).map(function (t) {
                return { id: t.id, title: t.title, level: t.level || null, elements: (t.require || []).length };
              })
        });
      } catch (err) {
        drafts.push({ file: "drafts/" + file, broken: true, reason: err.message });
      }
    });
  }
  const index = {
    project: meta.name,
    displayName: meta.displayName || meta.name,
    generatedAt: new Date().toISOString(),
    points: points,
    tasks: tasks,
    drafts: drafts
  };
  writeProjectFile(name, "tasks.json", JSON.stringify(index, null, 2) + String.fromCharCode(10), options);
  return index;
}

// 读索引：优先读 tasks.json；老项目（还没有索引）就地补一份，行为对调用方不变。
export function loadProjectTasks(name, options) {
  const file = join(projectDir(name, options), "tasks.json");
  if (existsSync(file)) {
    try {
      const index = JSON.parse(readFileSync(file, "utf8"));
      // 「是否已入总题库」是外部状态（packs/ 里有没有这个文件），读的时候重算一遍：
      // 索引是上一次分析时落盘的，之后的 promote 会让它过期——实测界面会一直显示「未入总题库」，
      // 而用户其实已经加过了。重算比"记得每次 promote 后刷新索引"更不容易漏。
      const dirs = options && options.packDir ? [options.packDir] : [userPackDir(options), PACK_DIR];
      (index.drafts || []).forEach(function (row) {
        row.inCatalog = Boolean(row.packId) && dirs.some(function (dir) {
          return existsSync(join(dir, slug(row.packId) + ".json"));
        });
      });
      return index;
    } catch (err) { /* 坏了就走重建 */ }
  }
  return buildProjectIndex(name, options);
}

export function renderKnowledgeNote(report) {
  const lines = [];
  lines.push('## 知识点（按字典匹配，与 JD 分析同一套）');
  lines.push('');
  lines.push('识别出 ' + report.matched + ' 个知识点，覆盖 ' + report.modules.length + ' 个模块：');
  lines.push('');
  report.modules.forEach(function (mod) {
    lines.push('- ' + mod.name + '：' + mod.points.map(function (point) { return point.name; }).join('、'));
  });
  if (report.unmatched && report.unmatched.length) {
    lines.push('');
    lines.push('字典没覆盖到的行（可以考虑补知识点）：');
    report.unmatched.slice(0, 10).forEach(function (line) { lines.push('  - ' + line); });
  }
  return lines.join('\n') + '\n';
}
// 项目里的知识点 → 可练的题目清单。
// 映射规则与 JD 分析完全一致：知识点在自己声明的 tasks 里挂着哪些题，就练哪些。
export function projectTaskList(name, options) {
  const meta = readProject(name, options);
  if (!meta) return null;
  const points = [];
  (meta.sources || []).forEach(function (row) {
    (row.points || []).forEach(function (id) { if (points.indexOf(id) === -1) points.push(id); });
  });
  const tasks = [];
  points.forEach(function (id) {
    const point = POINTS.find(function (row) { return row.id === id; });
    if (!point) return;
    (point.tasks || []).forEach(function (taskId) { if (tasks.indexOf(taskId) === -1) tasks.push(taskId); });
    if (!point.tasks || !point.tasks.length) return;
  });
  return {
    project: meta.name,
    points: points,
    tasks: tasks,
    sourcesWithPoints: (meta.sources || []).filter(function (row) { return (row.points || []).length; }).length,
    sourcesWithoutPoints: (meta.sources || []).filter(function (row) { return !(row.points || []).length; }).length
  };
}

// 从分析报告里取知识点 id（去重）：ingest 与 CLI 的 learn-repo 都要用，
// 少写一处就会让"某条来源进了项目但开练清单里看不到题"。
export function pointIdsFromReport(report) {
  const ids = [];
  ((report && report.modules) || []).forEach(function (mod) {
    (mod.points || []).forEach(function (point) {
      if (ids.indexOf(point.id) === -1) ids.push(point.id);
    });
  });
  return ids;
}

// 按目录批量导入语料：把一个目录（或它的每个子目录）收成项目。
//
// 场景：调研抓回来一堆岗位文本（docs/samples/boss/<分类>/*.txt），要按分类变成项目页里的项目，
// 这样才能看到「这个方向涉及哪些知识点、能出多少道题」。
//
// 两种用法：
//   importTree(baseDir, { prefix })              → 每个子目录一个项目（prefix + 子目录名）
//   importTree(dir, { project: '名字' })          → 一个项目，收这个目录（含子目录）里的所有文件
// 只读文本类文件（.txt/.md/.html/.htm），按文件名排序，逐份 ingest；每一份的返回值都会汇总，失败不吞。

export const IMPORT_EXTS = ['.txt', '.md', '.html', '.htm'];

function listFiles(dir, exts) {
  const out = [];
  readdirSync(dir).forEach(function (name) {
    const full = join(dir, name);
    let stat = null;
    try { stat = statSync(full); } catch (err) { return; }
    if (stat.isDirectory()) { out.push.apply(out, listFiles(full, exts)); return; }
    if (exts.indexOf(extname(name).toLowerCase()) === -1) return;
    out.push(full);
  });
  return out.sort();
}

// 把一份文件收进项目：source 用相对目录（分类/文件名），便于在项目页看出处
export function importFile(name, filePath, options) {
  const opts = options || {};
  const exts = opts.exts || IMPORT_EXTS;
  let text = '';
  try { text = readFileSync(filePath, 'utf8'); } catch (err) { return { ok: false, file: filePath, error: '读不到：' + err.message }; }
  if (!text.trim()) return { ok: false, file: filePath, error: '空文件' };
  const label = opts.label || basename(filePath);
  const result = ingestIntoProject(name, { kind: 'text', source: label, text: text }, { limit: opts.limit || 20 });
  if (result && result.ok === false) return { ok: false, file: filePath, error: result.error || '入库失败' };
  const sources = (result && result.project && result.project.sources) || [];
  const last = sources[sources.length - 1] || {};
  return {
    ok: true,
    file: filePath,
    label: label,
    knowledge: Number(last.knowledge) || 0,
    tasks: Number(last.tasks) || 0,
    points: last.points || []
  };
}

// 读某条来源的原文（项目页点来源时用）。index 从 1 开始，与 sources/ 里的编号一致。
export function readSourceText(name, index, options) {
  const meta = readProject(name, options);
  if (!meta) return { ok: false, error: '没有这个项目：' + name };
  const sources = meta.sources || [];
  const at = Number(index);
  const row = sources[at - 1];
  if (!row) return { ok: false, error: '没有第 ' + index + ' 条来源（共 ' + sources.length + ' 条）' };
  // 老数据（加这个功能之前收的）没有 textFile：如实说明，而不是返回空字符串让人以为文件是空的
  if (!row.textFile) return { ok: false, error: '这条来源是旧数据，没有存原文；重新收一次即可' , source: row };
  const full = join(projectDir(name, options), row.textFile);
  if (!existsSync(full)) return { ok: false, error: '原文文件不在：' + row.textFile, source: row };
  // 原文按文件指纹缓存：语料检索每次都要读全部来源（115 份 ~95k 字），实测冷启动 33ms、热 12ms。
  // 指纹（大小 + mtime）变了就重读，绝不会拿到改前的内容。
  const text = memo('source:' + full, fileFingerprint(full), function () { return readFileSync(full, 'utf8'); });
  return { ok: true, index: at, source: row, text: text, file: row.textFile };
}

// 重命名项目：移动目录 + 改元数据里的名字。新名字要合法（slug 之后不能为空），目标不存在。
export function renameProject(name, to, options) {
  const from = projectDir(name, options);
  if (!existsSync(from)) return { ok: false, error: '没有这个项目：' + name };
  const next = slug(String(to || ''));
  if (!next) return { ok: false, error: '新名字不合法：' + to };
  if (next === slug(name)) return { ok: true, name: next, unchanged: true };
  const target = projectDir(next, options);
  if (existsSync(target)) return { ok: false, error: '已经有叫这个的项目：' + next };
  try {
    renameSync(from, target);
  } catch (err) {
    return { ok: false, error: '改名失败：' + err.message };
  }
  const meta = readProject(next, options);
  if (meta) {
    meta.name = next;
    meta.displayName = next;
    meta.renamedFrom = name;
    meta.updatedAt = new Date().toISOString();
    writeFileSync(projectMetaPath(next, options), JSON.stringify(meta, null, 2) + '\n');
  }
  return { ok: true, name: next, from: name };
}

export function importTree(baseDir, options) {
  const opts = options || {};
  const prefix = opts.prefix === undefined ? '' : String(opts.prefix);
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 20));
  let stat = null;
  try { stat = statSync(baseDir); } catch (err) { return { ok: false, error: '读不到目录：' + err.message }; }
  if (!stat.isDirectory()) return { ok: false, error: '不是目录：' + baseDir };

  const jobs = [];
  if (opts.project) {
    // 一个项目收全部（含子目录），source 里带上相对路径
    const files = listFiles(baseDir, opts.exts || IMPORT_EXTS);
    files.forEach(function (file) {
      const rel = file.slice(baseDir.length + 1);
      jobs.push({ name: opts.project, file: file, label: rel });
    });
  } else {
    readdirSync(baseDir).forEach(function (name) {
      const full = join(baseDir, name);
      let sub = null;
      try { sub = statSync(full); } catch (err) { return; }
      if (!sub.isDirectory()) return;
      const files = listFiles(full, opts.exts || IMPORT_EXTS);
      files.forEach(function (file) {
        jobs.push({ name: prefix + name, file: file, label: name + '/' + basename(file) });
      });
    });
  }

  const projects = new Map();
  const failures = [];
  jobs.forEach(function (job) {
    const result = importFile(job.name, job.file, { label: job.label, limit: limit });
    if (!projects.has(job.name)) projects.set(job.name, { name: job.name, files: 0, knowledge: 0, tasks: 0, points: [] });
    const row = projects.get(job.name);
    if (result.ok) {
      row.files += 1;
      row.knowledge += Number(result.knowledge) || 0;
      row.tasks += Number(result.tasks) || 0;
      (result.points || []).forEach(function (id) { if (row.points.indexOf(id) === -1) row.points.push(id); });
    } else {
      failures.push({ file: job.file, error: result.error });
    }
  });

  return {
    ok: true,
    baseDir: baseDir,
    files: jobs.length,
    projects: Array.from(projects.values()).sort(function (a, b) { return a.name.localeCompare(b.name); }),
    failures: failures
  };
}

// 旧数据回填原文：加"原文另存"之前收的来源没有 textFile，项目页只能显示「（旧数据，无原文）」。
// 只要原始文件还在磁盘上（语料目录 / 仓库目录），就能把原文补回去——比让用户重新收一遍友好得多。
//
// 找文件的三条路（按顺序试）：
//   ① source 本身就是绝对路径且存在（仓库来源常见）
//   ② join(baseDir, source)：语料导入的来源名是「分类/文件名」，baseDir 是语料根目录
//   ③ join(baseDir, basename(source))：只按文件名碰一次，兜住路径前缀不一致的情况
export function backfillSourceText(name, baseDir, options) {
  const meta = readProject(name, options);
  if (!meta) return { ok: false, error: '没有这个项目：' + name };
  const sources = meta.sources || [];
  const filled = [];
  const missed = [];
  const next = sources.map(function (row, index) {
    if (row.textFile) return row;
    const label = String(row.source || '');
    const candidates = [];
    if (label && existsSync(label) && statSync(label).isFile()) candidates.push(label);
    if (baseDir && label) candidates.push(join(baseDir, label));
    if (baseDir && label) candidates.push(join(baseDir, basename(label)));
    const hit = candidates.filter(function (file) { return existsSync(file) && statSync(file).isFile(); })[0];
    if (!hit) { missed.push({ index: index + 1, source: label }); return row; }
    let text = '';
    try { text = readFileSync(hit, 'utf8'); } catch (err) { missed.push({ index: index + 1, source: label, error: err.message }); return row; }
    const rel = 'sources/' + String(index + 1).padStart(4, '0') + '-' + slug(label).slice(0, 40) + '.txt';
    writeProjectFile(name, rel, text + (text.endsWith('\n') ? '' : '\n'), options);
    filled.push({ index: index + 1, source: label, file: rel, chars: text.length });
    return Object.assign({}, row, { textFile: rel, textChars: text.length, artifacts: (row.artifacts || []).concat([rel]) });
  });
  if (filled.length) {
    const updated = Object.assign({}, meta, { sources: next, updatedAt: new Date().toISOString() });
    writeFileSync(projectMetaPath(name, options), JSON.stringify(updated, null, 2) + '\n');
  }
  return { ok: true, name: slug(name), filled: filled.length, missed: missed, total: sources.length };
}

// 批量回填：没给项目名时，把项目目录里所有项目都试一遍（同一个语料根目录）
export function backfillAll(baseDir, options) {
  const rows = listProjects(options);
  const results = rows.map(function (row) { return backfillSourceText(row.name, baseDir, options); });
  return {
    ok: true,
    baseDir: baseDir || '',
    projects: results.map(function (item) {
      return { name: item.name, filled: item.filled || 0, missed: (item.missed || []).length, total: item.total || 0, error: item.error || '' };
    })
  };
}

// 开练清单：项目的知识点 → 题 → 与你的练习记录对照，给出"先练哪几道"。
//
// 与 projectTaskList 的区别：那个只回答"这个项目涉及哪些题"，这个回答"我还差哪些、先练哪几道"。
// 排序口径（可解释）：① 没通过的排前面 ② 没通过内部按历史最好分升序（越差越先）
// ③ 已通过内部按分数升序（刚过的先巩固） ④ 同分按题号，保证输出稳定。
// 支持一次合并多个项目（prefix），用于"把这批语料涉及的方向一起练"。
// 难度中文名（界面与 CLI 都用这一份）
// 难度标签与排序口径统一在 core/text.mjs；这里 re-export，保持老调用点可用
export { levelLabel } from './text.mjs';

export function projectDrillPlan(targets, options) {
  const opts = options || {};
  const records = opts.records || [];
  const list = Array.isArray(targets) ? targets : [targets];
  const names = [];
  const perProject = [];
  const taskIds = [];
  const points = [];
  list.forEach(function (name) {
    const listed = projectTaskList(name, options);
    if (!listed) { perProject.push({ name: name, ok: false, error: '没有这个项目' }); return; }
    names.push(listed.project || name);
    listed.points.forEach(function (id) { if (points.indexOf(id) === -1) points.push(id); });
    listed.tasks.forEach(function (id) { if (taskIds.indexOf(id) === -1) taskIds.push(id); });
    perProject.push({ name: listed.project || name, ok: true, points: listed.points.length, tasks: listed.tasks.length });
  });
  const stats = taskStats(records, TASKS);
  const best = new Map();
  const attempts = new Map();
  stats.known.forEach(function (row) { best.set(row.taskId, row.best); attempts.set(row.taskId, row.attempts); });
  const taskIndex = new Map(TASKS.map(function (task) { return [task.id, task]; }));
  const rows = taskIds.map(function (id) {
    const task = taskIndex.get(id) || {};
    const score = best.has(id) ? Number(best.get(id)) : 0;
    return {
      id: id,
      // 与 jdplan 的行结构对齐：调用方常写 row.taskId，之前只有 id 会静默拿到 undefined
      //（第 16 轮端到端回归实测踩到：记录写成了 taskId=undefined，被去重后"凭空消失"）
      taskId: id,
      title: task.title || id,
      track: task.track || '',
      level: task.level || '',
      best: best.has(id) ? Number(best.get(id)) : null,
      attempts: attempts.get(id) || 0,
      passed: best.has(id) && Number(best.get(id)) >= PASS_SCORE
    };
  });
  // 排序口径（比"没通过排前面"更实用，且每步都能解释）：
  //   ① 练过但没通过的排最前，按历史最好分升序——差一点就过的先补，见效最快
  //   ② 完全没练过的次之，按难度从易到难（简单 → 中等 → 困难），上手不劝退
  //   ③ 已通过的排最后，按分数升序（刚过的先巩固）
  //   ④ 同档按题号，保证输出稳定
  const rank = function (row) {
    if (row.best === null) return 1;
    return row.passed ? 2 : 0;
  };
  const difficultyRank = function (row) { return levelRank(row.level); };
  rows.sort(function (a, b) {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) {
      const da = difficultyRank(a) - difficultyRank(b);
      if (da !== 0) return da;
    } else {
      const sa = a.best === null ? 0 : a.best;
      const sb = b.best === null ? 0 : b.best;
      if (sa !== sb) return sa - sb;
    }
    return a.id.localeCompare(b.id);
  });
  rows.forEach(function (row) {
    if (row.best === null) row.reason = '还没练过（' + levelLabel(row.level) + '）';
    else if (!row.passed) row.reason = '练过但没过（最高 ' + row.best + ' 分），差一点';
    else row.reason = '已通过（最高 ' + row.best + ' 分）';
  });
  const missing = rows.filter(function (row) { return !row.passed; });
  const byTrack = [];
  rows.forEach(function (row) {
    let bucket = byTrack.filter(function (item) { return item.track === row.track; })[0];
    if (!bucket) { bucket = { track: row.track || '(未标方向)', total: 0, passed: 0 }; byTrack.push(bucket); }
    bucket.total += 1;
    if (row.passed) bucket.passed += 1;
  });
  byTrack.sort(function (a, b) { return b.total - a.total; });
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 12));
  const nextUp = missing.slice(0, limit);
  const plan = {
    projects: names,
    perProject: perProject,
    points: points.length,
    total: rows.length,
    passed: rows.length - missing.length,
    missing: missing.length,
    byTrack: byTrack,
    rows: rows,
    nextUp: nextUp,
    // 直接可复制的开练命令：优先练差额题；没有差额就按清单全练（复习）
    command: 'node src/cli.mjs drill --tasks=' + (missing.length ? missing.map(function (row) { return row.id; }) : rows.map(function (row) { return row.id; })).slice(0, 40).join(',')
  };
  return plan;
}

// 刷新老项目的知识点：知识字典是会长大的（补了 PostgreSQL / 网关 / AI Infra 题包后，
// 老项目里存的还是收录那天的知识点），不刷新的话"补了题包但项目页仍然看不到"。
//
// 做法：重读每条来源的原文 → 用当前字典重新分析 → 更新 points 与 knowledge 计数 → 重建索引。
// 没有原文的旧来源如实计入 skipped（不猜），并给出去向提示。
export function refreshProjectPoints(name, options) {
  const meta = readProject(name, options);
  if (!meta) return { ok: false, error: '没有这个项目：' + name };
  const sources = (meta.sources || []).slice();
  const updated = [];
  const skipped = [];
  sources.forEach(function (row, index) {
    if (!row.textFile) { skipped.push({ index: index + 1, source: row.source, reason: '没有原文（旧数据）' }); return; }
    const back = readSourceText(name, index + 1, options);
    if (!back.ok || !back.text) { skipped.push({ index: index + 1, source: row.source, reason: back.error || '读不到原文' }); return; }
    const before = (row.points || []).slice();
    const report = analyzeText(back.text, {});
    const points = (report.points || []).map(function (item) { return item.id || item; });
    const gained = points.filter(function (id) { return before.indexOf(id) === -1; });
    sources[index] = Object.assign({}, row, { points: points, knowledge: points.length });
    if (gained.length) updated.push({ index: index + 1, source: row.source, before: before.length, after: points.length, gained: gained });
  });
  const next = Object.assign({}, meta, { sources: sources });
  writeFileSync(projectMetaPath(name, options), JSON.stringify(next, null, 2) + '\n');
  const index = buildProjectIndex(name, options);
  return {
    ok: true,
    project: next.name || name,
    sources: sources.length,
    changed: updated.length,
    updated: updated,
    skipped: skipped,
    points: (index.points || []).length,
    tasks: (index.tasks || []).length
  };
}
