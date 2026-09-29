// project / learn-repo：把"一个项目里能学到什么"变成可复核的记录与草案。
//
//   node src/cli.mjs project init my-service
//   node src/cli.mjs project add my-service --file 架构截图.png
//   node src/cli.mjs project add my-service --text "JD 或需求描述"
//   node src/cli.mjs project add my-service --url https://example.com/docs
//   node src/cli.mjs learn-repo https://github.com/owner/repo --project=my-service
//   node src/cli.mjs project show my-service
//
// 产物一律落在项目目录（默认 ~/.dsh-learn/projects/<名字>/）：notes/ 放原始输入与摘要，drafts/ 放草案包。
// 草案不自动进题库——它必须人工改写题面并跑一次 pack validate 与 audit。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeText, summarizeAnalysis } from '../../core/knowledge.mjs';
import { buildDraftPack, renderDraft, readSourceFile } from '../../core/site-learn.mjs';
import { fetchText } from '../../core/ingest.mjs';
import { load } from '../../store.mjs';
import { buildJdPlan } from '../../core/jdplan.mjs';
import { promoteDraft } from './packs.mjs';
import { userPackDir } from '../../core/packs.mjs';
import { validatePack } from '../../core/schema.mjs';
import { isAllowed } from '../../core/exec.mjs';
import { resolve } from 'node:path';
import { ocrImage } from '../../core/ocr.mjs';
import { analyzeRepo, normalizeRepoInput, parseGitRewrites, resolveRepoDir } from '../../core/repo-learn.mjs';
import { backfillAll, backfillSourceText, importTree, levelLabel, projectDrillPlan, readProject, readSourceText, renameProject, writeProjectFile, createProject, listProjects, projectDir, projectState, recordSource, projectArtifactName, ingestIntoProject, renderKnowledgeNote, projectTaskList, pointIdsFromReport, buildProjectIndex, loadProjectTasks, slug, withinDir, refreshProjectPoints, missingTextSources, projectSearchHit } from '../../core/project.mjs';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|heic)$/i;

function ensureProject(name, options) {
  const meta = readProject(name, options);
  if (meta) return { ok: true, meta: meta, created: false };
  const state = projectState(name, options);
  if (state.state === 'corrupted') {
    // 元数据坏了：不覆盖、不重建，让用户自己决定
    console.error(state.file + ' 不是合法 JSON，不敢覆盖。');
    console.error('先备份或修好它，或者换一个项目名再试（旧文件的来源台账还在里面）。');
    return { ok: false, corrupted: true, reason: state.file + ' 损坏' };
  }
  return Object.assign({ created: true }, createProject(name, options));
}

function draftFile(name, prefix, label, options) {
  return 'drafts/' + projectArtifactName(prefix, label) + '.json';
}

function writeDraftInto(name, result, prefix, options, label) {
  const rel = draftFile(name, prefix, label, options);
  writeProjectFile(name, rel, JSON.stringify(result.pack, null, 2) + '\n', options);
  const reviewRel = rel.replace(/\.json$/, '.md');
  writeProjectFile(name, reviewRel, renderDraft(result) + '\n', options);
  return { pack: rel, review: reviewRel };
}

function knowledgeSection(report) {
  const lines = [];
  lines.push('## 知识点（按字典匹配，与 JD 分析同一套）');
  lines.push('');
  lines.push('识别出 ' + report.matched + ' 个知识点，覆盖 ' + report.modules.length + ' 个模块：');
  lines.push('');
  report.modules.forEach(function (mod) {
    lines.push('- ' + mod.name + '：' + mod.points.map(function (p) { return p.name; }).join('、'));
  });
  if (report.unmatched && report.unmatched.length) {
    lines.push('');
    lines.push('字典没覆盖到的行（可以考虑补知识点）：');
    report.unmatched.slice(0, 10).forEach(function (line) { lines.push('  - ' + line); });
  }
  return lines.join('\n') + '\n';
}

export async function project(ctx) {
  const { args, asJson, out } = ctx;
  const sub = String(args._[1] || 'list');
  const name = String(args._[2] || args.name || '').trim();

  if (sub === 'init') {
    if (!name) { console.error('用法：node src/cli.mjs project init <名字>'); return 2; }
    const created = createProject(name, { note: typeof args.note === 'string' ? args.note : '' });
    if (!created.ok && created.corrupted) {
      console.error(created.reason);
      return 3;
    }
    if (asJson) { out(created); return created.ok ? 0 : 1; }
    if (!created.ok) { console.log('项目已存在：' + created.dir); return 0; }
    console.log('项目已建立：' + created.dir);
    console.log('  下一步：project add 收截图 / 文字 / 链接，或直接 learn-repo 拉一个仓库来解析。');
    return 0;
  }

  if (sub === 'list') {
    const query = typeof args.query === 'string' ? args.query : (typeof args.q === 'string' ? args.q : '');
    const missingText = Boolean(args['missing-text']);
    const sort = typeof args.sort === 'string' ? args.sort : 'updated';
    const total = listProjects({}).length;
    const all = listProjects({ query: query, missingText: missingText, sort: sort });
    if (asJson) { out({ total: total, filtered: all.length, query: query, missingText: missingText, sort: sort, projects: all }); return 0; }
    if (!total) { console.log('还没有项目。先跑：node src/cli.mjs project init <名字>'); return 0; }
    const filterNote = [] ;
    if (query) filterNote.push('关键词「' + query + '」');
    if (missingText) filterNote.push('只看缺原文');
    if (sort !== 'updated') filterNote.push('按 ' + sort + ' 排序');
    console.log(filterNote.length
      ? ('命中 ' + all.length + ' / ' + total + ' 个项目（' + filterNote.join('、') + '）')
      : ('共 ' + all.length + ' 个项目'));
    if (!all.length) { console.log('换个关键词，或去掉筛选条件。'); return 0; }
    all.forEach(function (row) {
      const hit = query ? projectSearchHit(row, query) : { fields: [] };
      const missing = missingTextSources(row, {}).length;
      console.log('[' + row.name + '] ' + (row.sources || []).length + ' 个来源　知识点 '
        + (row.sources || []).reduce(function (sum, item) { return sum + (item.knowledge || 0); }, 0)
        + '　缺原文 ' + missing + ' 条　更新于 ' + String(row.updatedAt || '').slice(0, 19)
        + (hit.fields.length ? ('　命中：' + Array.from(new Set(hit.fields)).join('/')) : ''));
    });
    return 0;
  }

  if (sub === 'show') {
    if (!name) { console.error('用法：node src/cli.mjs project show <名字>'); return 2; }
    const meta = readProject(name, {});
    if (!meta) { console.error('没有这个项目：' + name); return 3; }
    const showIndex = loadProjectTasks(name, {});
    if (asJson) { out({ meta: meta, dir: projectDir(name, {}), index: showIndex }); return 0; }
    console.log('项目：' + (meta.displayName || meta.name) + '　目录：' + projectDir(name, {}));
    console.log('建立于 ' + String(meta.createdAt || '').slice(0, 19) + '　更新于 ' + String(meta.updatedAt || '').slice(0, 19));
    if (!(meta.sources || []).length) { console.log('还没有来源：用 project add 或 learn-repo 添加。'); return 0; }
    console.log('');
    console.log('来源：');
    // 索引里的题目与草案：这是"在项目目录下加载题目及知识点"的入口，
    // 不用重新分析一遍就能看到当前能练什么、哪些草案还没入总题库。
    if (showIndex) {
      console.log('');
      console.log('知识点 ' + showIndex.points.length + ' 个 → 可练题 ' + showIndex.tasks.length + ' 道'
        + (showIndex.points.length ? '（' + showIndex.points.slice(0, 6).map(function (p) { return p.name; }).join('、') + (showIndex.points.length > 6 ? ' 等' : '') + '）' : ''));
      if (showIndex.drafts.length) {
        showIndex.drafts.forEach(function (row) {
          console.log('  草案 ' + row.file + '：' + ((row.tasks || []).length) + ' 道' + (row.inCatalog ? '　已在总题库' : '　未入总题库'));
        });
      }
    }
    (meta.sources || []).forEach(function (row) {
      console.log('  [' + row.kind + '] ' + String(row.at).slice(0, 19) + '　' + row.source
        + '　知识点 ' + (row.knowledge || 0) + '　草案题 ' + (row.tasks || 0));
      (row.artifacts || []).forEach(function (file) { console.log('      → ' + file); });
    });
    return 0;
  }

  if (sub === 'promote') {
    // 草案 → 总题库（默认）或项目的 promoted/（--project-only）。
    // 区别只有一个：写到哪里。总题库是仓库里的 packs/，写进去所有客户端下次启动就能练；
    // promoted/ 只是项目自己的暂存区，方便先攒着再一起入库。
    const draftRel = String(args._[3] || '').trim();
    if (!name || !draftRel) { console.error('用法：node src/cli.mjs project promote <名字> <草案文件> [--project-only] [--force] [--dry-run]'); return 2; }
    const dir = projectDir(name, {});
    const draftPath = resolve(dir, draftRel);
    if (!withinDir(dir, draftPath)) { console.error('草案文件必须在项目目录里，收到的是：' + draftRel); return 2; }
    if (!existsSync(draftPath)) { console.error('找不到草案文件：' + draftPath); return 3; }
    let draft = null;
    try { draft = JSON.parse(readFileSync(draftPath, 'utf8')); } catch (err) { console.error('草案不是合法 JSON：' + err.message); return 3; }
    const projectOnly = Boolean(args['project-only']);
    const catalogTarget = join(userPackDir({}), slug(draft.id || 'draft-pack') + '.json');
    const result = promoteDraft(draft, {
      // 默认进"总题库"= 用户题库目录（<home>/packs/），与随工具发布的 packs/ 分开：
      // 升级工具不会覆盖它，也不会把用户内容混进随工具发布的那份题库
      into: projectOnly ? join('promoted', slug(draft.id || 'draft-pack') + '.json') : catalogTarget,
      baseDir: projectOnly ? dir : undefined,
      dryRun: Boolean(args['dry-run']),
      force: Boolean(args.force),
      validate: function (pack) { return validatePack(pack, { isAllowedCommand: isAllowed }); }
    });
    if (asJson) { out(result); return result.errors.length ? 1 : 0; }
    if (result.errors.length) {
      result.errors.forEach(function (msg) { console.error('错误：' + msg); });
      return 1;
    }
    result.warnings.forEach(function (msg) { console.log('提醒：' + msg); });
    if (result.dryRun) { console.log('预览（没有写文件）：' + result.target + '　' + result.taskCount + ' 道题'); return 0; }
    const index = buildProjectIndex(name, {});
    if (projectOnly) {
      console.log('已写入项目暂存区：' + result.target + '（' + result.taskCount + ' 道题）');
      console.log('  想让它进总题库：node src/cli.mjs project promote ' + name + ' promoted/' + slug(draft.id || 'draft-pack') + '.json');
    } else {
      console.log('已加入总题库：' + result.target + '（' + result.taskCount + ' 道题，包 id ' + result.packId + '）');
      console.log('  客户端下次启动即可练到这些题（题库里会多出这个包；包 id 也出现在 list 的包清单里）。');
      console.log('  不合适就删掉这个文件，题库立刻恢复：rm ' + result.target);
    }
    return 0;
  }

  if (sub === 'refresh') {
    // 刷新知识点：知识字典长大后，让老项目用上新的知识点/题（不改原文）
    const one = String(name || '').trim();
    const prefix = String(args.prefix || '').trim();
    let targets = one ? [one] : [];
    if (!one && prefix) {
      targets = listProjects().filter(function (row) { return String(row.name).indexOf(prefix) === 0; }).map(function (row) { return row.name; });
    }
    if (!targets.length) { console.error('用法：node src/cli.mjs project refresh <名字> | --prefix=boss- [--json]'); return 2; }
    const results = targets.map(function (row) { return refreshProjectPoints(row); });
    if (asJson) { out(one ? results[0] : { projects: results }); return 0; }
    results.forEach(function (result) {
      if (!result.ok) { console.log('  ' + result.error); return; }
      console.log('  ' + result.project + '：' + result.sources + ' 条来源，' + result.changed + ' 条补到了新知识点（跳过 ' + result.skipped.length + ' 条）→ 知识点 ' + result.points + ' 个 / 可练题 ' + result.tasks + ' 道');
      result.updated.slice(0, 3).forEach(function (row) {
        console.log('    第 ' + row.index + ' 条：知识点 ' + row.before + ' → ' + row.after + '（新增 ' + row.gained.join('、') + '）');
      });
      result.skipped.slice(0, 2).forEach(function (row) { console.log('    跳过第 ' + row.index + ' 条：' + row.reason); });
    });
    return 0;
  }

  if (sub === 'jdplan') {
    // 岗位描述 → 练习清单：把 JD 的技术点映射到题库已有的题，并把原文依据一起给出
    const one = String(name || '').trim();
    if (!one) { console.error('用法：node src/cli.mjs project jdplan <名字> [--source=N] [--max=10] [--json]'); return 2; }
    const meta = readProject(one);
    if (!meta) { console.error('没有这个项目：' + one); return 3; }
    const only = Number(args.source) || 0;
    const picked = [];
    (meta.sources || []).forEach(function (row, index) {
      const no = index + 1;
      if (only && only !== no) return;
      if (!row.textFile) return;
      const back = readSourceText(one, no);
      if (back.ok && back.text) picked.push({ index: no, source: row.source, text: back.text });
    });
    if (!picked.length) { console.error('这个项目还没有原文可读（先收来源，或跑 project backfill 补原文）。'); return 3; }
    const plan = buildJdPlan({ name: meta.name || one, sources: picked }, { records: load().records || [], max: Number(args.max) || 10 });
    const file = 'drafts/jd-plan-' + (meta.name || one) + '.json';
    writeProjectFile(one, file, JSON.stringify(plan, null, 2) + '\n');
    writeProjectFile(one, 'notes/JD-练习清单.md', plan.markdown);
    buildProjectIndex(one); // 索引决定项目页能看到哪些草案
    if (asJson) { out(plan); return 0; }
    if (typeof args.out === 'string' && args.out.trim()) { console.log(plan.markdown); writeProjectFile(one, 'notes/JD-练习清单.md', plan.markdown); }
    else { console.log(plan.markdown); }
    console.log('已写入项目文件：' + file + ' 与 notes/JD-练习清单.md');
    return 0;
  }

  if (sub === 'drill') {
    // 开练清单：项目（或一批项目）的知识点 → 题 → 与练习记录对照，给出"先练哪几道"
    const one = String(name || '').trim();
    const prefix = String(args.prefix || '').trim();
    let targets = one ? [one] : [];
    if (!one && prefix) {
      targets = listProjects().filter(function (row) { return String(row.name).indexOf(prefix) === 0; }).map(function (row) { return row.name; });
    }
    if (!targets.length) { console.error('用法：node src/cli.mjs project drill <名字> [--limit=12]　或　project drill --prefix=boss- [--limit=12]'); return 2; }
    const plan = projectDrillPlan(targets, { records: load().records || [], limit: Number(args.limit) || 12 });
    if (asJson) { out(plan); return 0; }
    if (args.csv) { console.log(plan.nextUp.map(function (row) { return row.id; }).join(',')); return 0; }
    console.log('开练清单：' + plan.projects.join('、'));
    console.log('共 ' + plan.total + ' 道（已通过 ' + plan.passed + '，待练 ' + plan.missing + '）　涉及 ' + plan.points + ' 个知识点');
    plan.byTrack.forEach(function (row) { console.log('  ' + row.track + '：' + row.passed + '/' + row.total); });
    console.log('');
    console.log('先练这 ' + plan.nextUp.length + ' 道：');
    plan.nextUp.forEach(function (row, index) {
      console.log('  ' + (index + 1) + '. ' + row.id + '　[' + row.track + '/' + levelLabel(row.level) + ']　' + row.title + '　— ' + row.reason);
    });
    console.log('');
    console.log('直接开练：' + plan.command);
    return 0;
  }

  if (sub === 'tasks') {
    // 项目里的知识点 → 可练题号。JSON 给脚本用，--csv 直接接 drill --tasks，
    // 默认打印人看的清单（含知识点与题数）。
    if (!name) { console.error('用法：node src/cli.mjs project tasks <名字> [--json|--csv]'); return 2; }
    const listed = projectTaskList(name);
    if (!listed) { console.error('没有这个项目：' + name); return 3; }
    if (asJson) { out(listed); return 0; }
    if (args.csv) { console.log(listed.tasks.join(',')); return 0; }
    if (!listed.tasks.length) {
      console.log(listed.points.length
        ? ('命中了 ' + listed.points.length + ' 个知识点，但它们还没挂题（可在 src/core/knowledge.mjs 里补挂）。')
        : '这个项目还没记下知识点：重新收一次来源（更早的记录里没有知识点 id）。');
      return 0;
    }
    console.log('项目 ' + name + '：' + listed.points.length + ' 个知识点 → ' + listed.tasks.length + ' 道可练题');
    if (listed.sourcesWithoutPoints) {
      console.log('注意：有 ' + listed.sourcesWithoutPoints + ' 条来源没有知识点 id（更早的记录），重新收一次即可纳入。');
    }
    console.log('');
    listed.tasks.forEach(function (id, index) { console.log('  ' + (index + 1) + '. ' + id); });
    console.log('');
    console.log('直接开练：node src/cli.mjs drill --tasks=' + listed.tasks.join(','));
    return 0;
  }

  if (sub === 'backfill') {
    // 旧数据补原文：来源名是「分类/文件名」时，用 --dir 指到语料根目录
    const dir = String(args.dir || '').trim();
    const one = String(args.project || '').trim();
    const result = one ? backfillSourceText(one, dir) : backfillAll(dir);
    if (!result.ok) throw new CliError(result.error, 3);
    if (asJson) { out(result); return 0; }
    if (one) {
      console.log(result.name + '：补回原文 ' + result.filled + ' 条，没找到原文 ' + result.missed.length + ' 条（共 ' + result.total + ' 条来源）');
      result.missed.slice(0, 5).forEach(function (row) { console.log('  第 ' + row.index + ' 条：' + row.source); });
    } else {
      result.projects.forEach(function (row) {
        console.log('  ' + row.name + '：补回 ' + row.filled + ' 条，缺原文 ' + row.missed + ' 条（共 ' + row.total + ' 条）' + (row.error ? '　' + row.error : ''));
      });
    }
    return 0;
  }

  if (sub === 'rename') {
    const from = String(args._[2] || '').trim();
    const to = String(args._[3] || '').trim();
    if (!from || !to) throw new CliError('用法：node src/cli.mjs project rename <旧名字> <新名字>');
    const result = renameProject(from, to);
    if (!result.ok) throw new CliError(result.error, 3);
    if (asJson) { out(result); return 0; }
    console.log(result.unchanged ? ('名字没变：' + result.name) : ('已重命名：' + result.from + ' → ' + result.name));
    return 0;
  }

  if (sub === 'import') {
    // 按目录批量导入：--dir 下的每个子目录变成一个项目（前缀可加），或用一个项目收整个目录
    const baseDir = String(args.dir || '').trim();
    if (!baseDir) throw new CliError('用法：node src/cli.mjs project import --dir=<目录> [--prefix=boss-] [--project=<单个项目名>] [--limit=20]');
    const result = importTree(baseDir, {
      prefix: typeof args.prefix === 'string' ? args.prefix : '',
      project: typeof args.project === 'string' ? args.project : '',
      limit: Number(args.limit) || 20
    });
    if (!result.ok) throw new CliError(result.error, 3);
    if (asJson) { out(result); return 0; }
    console.log('从 ' + baseDir + ' 导入 ' + result.files + ' 份，落到 ' + result.projects.length + ' 个项目：');
    result.projects.forEach(function (row) {
      console.log('  ' + row.name + '：来源 ' + row.files + ' 份，命中 ' + row.knowledge + ' 次知识点（去重 ' + row.points.length + ' 个），草案题 ' + row.tasks + ' 道');
    });
    if (result.failures.length) {
      console.log('失败 ' + result.failures.length + ' 份：');
      result.failures.slice(0, 5).forEach(function (row) { console.log('  ' + row.file + '：' + row.error); });
    }
    console.log('');
    console.log('看项目：node src/cli.mjs project show ' + (result.projects[0] ? result.projects[0].name : '<名字>'));
    return 0;
  }

  if (sub === 'add') {
    if (!name) { console.error('用法：node src/cli.mjs project add <名字> [--file 图片/文本 | --text "..." | --url 链接 | --repo 路径或链接]'); return 2; }
    const ensured = ensureProject(name, {});
    if (!ensured.ok) return 3;
    const input = { kind: null, source: '', text: '' };

    if (typeof args.file === 'string') {
      const file = args.file;
      if (IMAGE_EXT.test(file)) {
        input.kind = 'screenshot';
        input.source = file;
        const ocr = await ocrImage(file, {});
        if (!ocr.ok) { console.error('截图识别失败：' + ocr.reason); return 3; }
        input.text = ocr.text;
      } else {
        input.kind = 'file';
        input.source = file;
        const read = readSourceFile(file);
        if (!read.ok) { console.error(read.reason); return 2; }
        input.text = read.text;
      }
    } else if (typeof args.text === 'string') {
      input.kind = 'text';
      input.source = (args.text.slice(0, 40) + (args.text.length > 40 ? '…' : ''));
      input.text = args.text;
    } else if (typeof args.url === 'string') {
      input.kind = 'link';
      input.source = args.url;
      const fetched = await fetchText(args.url, { wantHtml: true, maxBytes: 4 * 1024 * 1024, timeout: 20000 });
      if (!fetched.ok) { console.error('抓取失败：' + fetched.reason); return 3; }
      input.text = fetched.html || fetched.text;
    } else {
      console.error('要给出一种输入：--file / --text / --url / --repo');
      return 2;
    }

    const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
    const ingested = ingestIntoProject(name, { kind: input.kind, source: input.source, text: input.text }, { limit: limit });
    const artifacts = ingested.artifacts;
    const meta = ingested.project;
    const report = ingested.knowledge;
    const draft = ingested.draft;
    const draftFiles = ingested.draftFiles;
    if (asJson) { out({ project: meta.name, kind: input.kind, knowledge: report.matched, tasks: draft.stats.tasks, artifacts: artifacts, report: report }); return 0; }
    console.log('已加入项目 ' + meta.name + '（' + (ensured.created ? '新建' : '已存在') + '）：' + input.kind + '　' + input.source);
    console.log(summarizeAnalysis(report));
    console.log('摘要：' + ingested.dir + '/' + artifacts[0]);
    if (draftFiles) {
      console.log('草案：' + ingested.dir + '/' + draftFiles.pack + '（' + draft.stats.tasks + ' 道，含复核清单 ' + draftFiles.review + '）');
      console.log('入库前请：1) 改写题面　2) node src/cli.mjs pack promote <草案文件>　3) node src/cli.mjs audit');
    } else {
      console.log('这次没有抽到可直接成题的命令：截图/文字里有命令行示例（如 docker run -d …）时会自动出草案，'
      + '只有成段散文时以知识点为主；想从整页文档抽命令可以用 --url，从代码仓库抽用 learn-repo。');
    }
    return 0;
  }

  console.error('未知子命令：project ' + sub + '（可用：init / list / show / add）');
  return 2;
}

export async function learnRepo(ctx) {
  const { args, asJson, out } = ctx;
  const target = String(args._[1] || args.repo || '').trim();
  if (!target) {
    console.error('用法：node src/cli.mjs learn-repo <本地目录 | owner/repo | git 链接> [--project=名字] [--limit=20] [--branch=名字] [--refresh]');
    return 2;
  }
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
  const projectName = typeof args.project === 'string' && args.project ? args.project : null;
  const input = normalizeRepoInput(target);
  if (input.kind === 'empty') { console.error('用法：node src/cli.mjs learn-repo <本地目录 | owner/repo | git 链接>'); return 2; }
  const isRemote = input.kind === 'remote';
  const branch = typeof args.branch === 'string' && args.branch ? args.branch : '';
  const refresh = Boolean(args.refresh);

  // 本机的 url.<base>.insteadOf 改写会让"直连"其实也走了镜像，先读出来，输出里就能自己解释清楚
  const rewrites = parseGitRewrites(spawnSync('git', ['config', '--get-regexp', '^url\\.'], { encoding: 'utf8' }).stdout);
  const resolved = resolveRepoDir(input, {
    baseDir: projectName ? join(projectDir(projectName, {}), 'repo') : join(process.env.TMPDIR || '/tmp', 'dsh-learn-repo'),
    localTarget: target,
    branch: branch,
    refresh: refresh,
    rewrites: rewrites,
    reuseHint: true,
    note: function (kind, text, dir) {
      if (kind === 'reuse') console.log(text);
      else if (kind === 'rewrite') console.log('注意：' + text);
      else if (kind === 'try') console.log(text);
      else if (kind === 'done') {
        console.log(dir ? (text === 'direct' ? ('已浅克隆到：' + dir)
          : (String(text).indexOf('mirror:') === 0 ? ('直连不通，改走镜像 ' + String(text).slice('mirror:'.length) + '：' + dir)
            : ('已克隆（' + text + '）：' + dir))) : '');
      }
    }
  });
  if (!resolved.ok) {
    if (resolved.kind === 'local') {
      console.error(resolved.error + (input.label && input.label !== target ? '（想按 owner/repo 当远程仓库解析吗？）' : ''));
      return 3;
    }
    console.error('克隆失败（' + resolved.url + '）：');
    resolved.failure.forEach(function (row) { console.error('  · ' + row.via + '（' + row.effective + '）：' + row.reason); });
    console.error('提示：先确认网络与仓库权限（私有仓库配好 ssh key 或 token）；');
    if (process.env.DSH_LEARN_GIT_MIRROR) {
      console.error('     当前设了 DSH_LEARN_GIT_MIRROR=' + process.env.DSH_LEARN_GIT_MIRROR + '，只会走它；想回到默认候选链就取消这个环境变量。');
    } else {
      console.error('     想固定走某个镜像可以设 DSH_LEARN_GIT_MIRROR=https://你的镜像前缀 再跑一次；');
    }
    console.error('     也可以先自己 git clone 一份，把本地目录交给 learn-repo —— 本地目录不走克隆。');
    return 3;
  }
  const dir = resolved.dir;
  const cloned = resolved.cloned;
  const via = resolved.via;

  const result = analyzeRepo(dir, { limit: limit, source: isRemote ? input.url : dir.split('/').pop() });
  if (!result) { console.error('扫描失败：目录不可读'); return 3; }

  const summary = {
    dir: dir,
    cloned: cloned,
    via: via,          // direct / mirror:host / reuse / local —— 复核时能看出这份结果是怎么来的
    source: isRemote ? input.url : dir,
    files: result.scan.files.length,
    truncated: result.scan.truncated,
    signals: result.scan.signals.map(function (s) { return { id: s.id, track: s.track, note: s.note, files: s.files }; }),
    knowledge: { matched: result.knowledge.matched, modules: result.knowledge.modules.map(function (m) { return { name: m.name, points: m.points.map(function (p) { return p.name; }) }; }) },
    draft: { tasks: result.draft.stats.tasks, tracks: result.draft.stats.tracks }
  };

  const artifacts = [];
  if (projectName) {
    ensureProject(projectName, {});
    const noteRel = 'notes/' + projectArtifactName('repo', summary.dir.split('/').pop()) + '.md';
    const lines = ['# 仓库：' + (isRemote ? input.url : target), '',
      '来源方式：' + (via === 'local' ? '本地目录' : via === 'reuse' ? '复用上次克隆' : via === 'direct' ? '直连 GitHub 克隆' : '镜像克隆（' + via + '）'),
      '扫描文件 ' + summary.files + ' 个' + (summary.truncated ? '（已达上限，只扫了前一批）' : ''), '',
      '## 技术信号', ''];
    summary.signals.forEach(function (s) { lines.push('- ' + s.id + '（' + s.note + '）：' + s.files.join('、')); });
    lines.push('');
    lines.push(knowledgeSection(result.knowledge));
    writeProjectFile(projectName, noteRel, lines.join('\n') + '\n', {});
    artifacts.push(noteRel);
    if (summary.draft.tasks) {
      const files = writeDraftInto(projectName, result.draft, 'repo', {}, target);
      artifacts.push(files.pack, files.review);
    }
    recordSource(projectName, {
      kind: 'repo',
      source: isRemote ? input.url : target,
      knowledge: result.knowledge.matched,
      tasks: summary.draft.tasks,
      // learn-repo 也要记知识点 id，否则这条来源在"开练清单"里是隐形的
      points: pointIdsFromReport(result.knowledge),
      artifacts: artifacts
    }, {});
    summary.artifacts = artifacts.map(function (rel) { return join(projectDir(projectName, {}), rel); });
  }

  if (asJson) { out(summary); return 0; }
  console.log('扫描目录：' + summary.dir + '（' + summary.files + ' 个文件' + (summary.truncated ? '，已达上限' : '') + '）');
  console.log('');
  console.log('技术信号：');
  summary.signals.forEach(function (s) { console.log('  · ' + s.id + '（' + s.note + '）：' + s.files.slice(0, 3).join('、')); });
  console.log('');
  console.log(summarizeAnalysis(result.knowledge));
  console.log('');
  if (summary.draft.tasks) {
    console.log(renderDraft(result.draft));
  } else {
    console.log('没抽到命令示例：这个仓库可能没有 README 命令块或脚本。');
  }
  if (projectName) {
    console.log('');
    console.log('已写入项目 ' + projectName + '：');
    summary.artifacts.forEach(function (file) { console.log('  → ' + file); });
    console.log('入库前请：1) 改写题面　2) node src/cli.mjs pack promote <草案文件>　3) node src/cli.mjs audit');
  }
  return 0;
}
