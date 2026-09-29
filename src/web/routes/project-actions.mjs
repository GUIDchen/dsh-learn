// 项目域的动作实现：每个 action 一个函数（从 handleProjectRoute 的 if 链整块搬出，内容原样）。
//
// 为什么单独成文件：动作表的价值是「加接口只加一行」，但十几个动作实现留在原文件里会把
// project.mjs 重新撑到 400 行预算线上。搬出来以后：
//   project.mjs          → 路由分发（GET 调 handleProjectGet、POST 查 ACTIONS 表）
//   project-actions.mjs  → 每个动作的实现 + ACTIONS 表
import { describeExtraction } from '../../core/describe.mjs';
import { fetchText } from '../../core/ingest.mjs';
import { buildJdPlan } from '../../core/jdplan.mjs';
import { ocrImage, saveDataUrl } from '../../core/ocr.mjs';
import { backfillAll, backfillSourceText, buildProjectIndex, createProject, importTree, ingestIntoProject, listProjects, loadProjectTasks, missingTextSources, projectDir, projectDrillPlan, projectSearchHit, projectTaskList, readProject, readSourceText, refreshProjectPoints, renameProject, safeBaseName, slug, writeProjectFile } from '../../core/project.mjs';
import { analyzeRepo, normalizeRepoInput, parseGitRewrites, repoCommandText, repoDigest, resolveRepoDir } from '../../core/repo-learn.mjs';
import { load } from '../../store.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// 动作 delete（从 handleProjectRoute 的 if 链里整块搬出来，缩进与内容原样）
async function actionDelete(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
        if (body.confirm !== true) { sendJson(res, 400, { error: '删除项目需要 confirm: true' }); return; }
        const dir = projectDir(name);
        if (!existsSync(dir)) { sendJson(res, 404, { error: '没有这个项目：' + name }); return; }
        rmSync(dir, { recursive: true, force: true });
        sendJson(res, 200, { deleted: true, name: name, dir: dir });
        return;
}

// 动作 tasks（从 handleProjectRoute 的 if 链里整块搬出来，缩进与内容原样）
async function actionTasks(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
        const listed = projectTaskList(name);
        if (!listed) { sendJson(res, 404, { error: '没有这个项目：' + name }); return; }
        sendJson(res, 200, listed);
        return;
}

// 动作 index（从 handleProjectRoute 的 if 链里整块搬出来，缩进与内容原样）
async function actionIndex(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
        // 项目索引原样给出（知识点带名字、可练题、草案含"是否已入总题库"）：
        // 项目管理页要显示的就是这份东西，不该再在前端拼一遍
        const index = loadProjectTasks(name);
        if (!index) { sendJson(res, 404, { error: '没有这个项目：' + name }); return; }
        sendJson(res, 200, index);
        return;
}

// 动作 refresh（从 handleProjectRoute 的 if 链里整块搬出来，缩进与内容原样）
async function actionRefresh(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
        // 刷新知识点：补了题包后让老项目也能用上（重读原文 → 重算知识点 → 重建索引）
        const result = refreshProjectPoints(name);
        if (!result.ok) { sendJson(res, 400, { error: result.error }); return; }
        sendJson(res, 200, result);
        return;
}

// 动作 jdplan（从 handleProjectRoute 的 if 链里整块搬出来，缩进与内容原样）
async function actionJdplan(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
        // 岗位描述 → 练习清单（计划草案）：写进项目 drafts/ 与 notes/，返回 markdown 供界面直接显示
        const target = name;
        if (!target) { sendJson(res, 400, { error: '缺少项目名' }); return; }
        const meta = readProject(target);
        if (!meta) { sendJson(res, 404, { error: '没有这个项目：' + target }); return; }
        const only = Number(body.source) || 0;
        const picked = [];
        (meta.sources || []).forEach(function (row, index) {
          const no = index + 1;
          if (only && only !== no) return;
          if (!row.textFile) return;
          const back = readSourceText(target, no);
          if (back.ok && back.text) picked.push({ index: no, source: row.source, text: back.text });
        });
        if (!picked.length) { sendJson(res, 400, { error: '这个项目还没有原文可读（先收来源或跑 backfill）' }); return; }
        const plan = buildJdPlan({ name: meta.name || target, sources: picked }, { records: load().records || [], max: Number(body.max) || 10 });
        writeProjectFile(target, 'drafts/jd-plan-' + (meta.name || target) + '.json', JSON.stringify(plan, null, 2) + '\n');
        writeProjectFile(target, 'notes/JD-练习清单.md', plan.markdown);
        // 项目页的草案列表来自索引（tasks.json），新写入的草案必须重建索引才会出现
        buildProjectIndex(target);
        sendJson(res, 200, { ok: true, plan: plan, markdown: plan.markdown });
        return;
}

// 动作 drill（从 handleProjectRoute 的 if 链里整块搬出来，缩进与内容原样）
async function actionDrill(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
        // 开练清单：单个项目或一批（prefix），与练习记录对照后给出"先练哪几道"
        const one = String(body.project || body.name || '').trim();
        const prefix = String(body.prefix || '').trim();
        let targets = one ? [one] : [];
        if (!one && prefix) targets = listProjects().filter(function (row) { return String(row.name).indexOf(prefix) === 0; }).map(function (row) { return row.name; });
        if (!targets.length) { sendJson(res, 400, { error: '要给 project 或 prefix' }); return; }
        sendJson(res, 200, { ok: true, plan: projectDrillPlan(targets, { records: load().records || [], limit: Number(body.limit) || 12 }) });
        return;
}

// 动作 backfill（从 handleProjectRoute 的 if 链里整块搬出来，缩进与内容原样）
async function actionBackfill(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
        // 旧数据补原文：来源名常是「分类/文件名」，--dir 指到语料根目录（没给名字就全部项目都试）
        const dir = String(body.dir || '').trim();
        const only = String(body.project || '').trim();
        const result = only ? backfillSourceText(only, dir) : backfillAll(dir);
        if (!result.ok) { sendJson(res, 400, { error: result.error }); return; }
        sendJson(res, 200, result);
        return;
}

// 动作 rename（从 handleProjectRoute 的 if 链里整块搬出来，缩进与内容原样）
async function actionRename(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
        const to = String(body.to || '').trim();
        if (!to) { sendJson(res, 400, { error: '缺少新名字 to' }); return; }
        const renamed = renameProject(name, to);
        if (!renamed.ok) { sendJson(res, 400, { error: renamed.error }); return; }
        sendJson(res, 200, { ok: true, name: renamed.name, from: renamed.from });
        return;
}

// 动作 import（从 handleProjectRoute 的 if 链里整块搬出来，缩进与内容原样）
async function actionImport(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
        // 按目录批量导入语料：每个子目录一个项目（前缀可加）。与 CLI project import 共用 core/project.mjs 的 importTree
        const dir = String(body.dir || '').trim();
        if (!dir) { sendJson(res, 400, { error: '缺少 dir（要导入的目录）' }); return; }
        // 这里不能用下面才声明的 limit（import 分支在它之前，会撞 TDZ）
        const importLimit = Math.max(1, Math.min(100, Number(body.limit) || 20));
        const result = importTree(dir, { prefix: String(body.prefix || ''), project: String(body.project || ''), limit: importLimit });
        if (!result.ok) { sendJson(res, 400, { error: result.error }); return; }
        sendJson(res, 200, { ok: true, files: result.files, projects: result.projects, failures: result.failures });
        return;
}

// 动作 init（从 handleProjectRoute 的 if 链里整块搬出来，缩进与内容原样）
async function actionInit(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
        const created = createProject(name);
        // 元数据坏了要如实拒绝：网页版和 CLI 一样不能覆盖，否则来源台账会静默丢掉
        if (!created.ok && created.corrupted) { sendJson(res, 400, { error: created.reason, corrupted: true }); return; }
        // project 与 meta 是同一份数据的两种叫法（GET /api/project?name= 用 meta），都给出来
        sendJson(res, 200, { project: created.meta, meta: created.meta, dir: created.dir, created: created.ok });
        return;
}

// 默认动作（收来源）：原来 if 链走完没命中就落到这段，现在显式命名成 add，行为不变
async function actionAddSource(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;

      const limit = Math.max(1, Math.min(60, Number(body.limit) || 20));
      try {
        if (body.kind === 'repo' || body.repoUrl || body.repoPath) {
          // 仓库：本地路径直接用；链接走浅克隆。**与 CLI 共用 resolveRepoDir()**——
          // 简写 / 镜像链 / 复用上次克隆 / 本机 git 改写诊断在两边是一份代码，不会再各自演化。
          const target = String(body.repoUrl || body.repoPath || '').trim();
          if (!target) { sendJson(res, 400, { error: '缺少仓库地址或本地路径' }); return; }
          const input = normalizeRepoInput(target);
          const isRemote = input.kind === 'remote';
          const rewrites = parseGitRewrites(spawnSync('git', ['config', '--get-regexp', '^url\\.'], { encoding: 'utf8' }).stdout);
          const resolved = resolveRepoDir(input, {
            baseDir: join(projectDir(name), 'repo'),
            localTarget: target,
            dispatch: false,
            rewrites: rewrites,
            timeoutMs: 120000
          });
          if (!resolved.ok) {
            if (resolved.kind === 'local') { sendJson(res, 400, { error: resolved.error }); return; }
            sendJson(res, 502, {
              error: '克隆失败：' + resolved.failure.map(function (row) { return row.via + '（' + row.reason + '）'; }).join('；'),
              hint: '网页请求会一直等到克隆结束；大仓库建议先在终端 git clone，再用本地路径。也可以设 DSH_LEARN_GIT_MIRROR 固定走某个镜像。'
            });
            return;
          }
          const dir = resolved.dir;
          const result = analyzeRepo(dir, { limit: limit, source: isRemote ? input.url : dir.split('/').pop() });
          if (!result) { sendJson(res, 400, { error: '目录不可读：' + dir }); return; }
          const ingested = ingestIntoProject(name, {
            kind: 'repo',
            // 本地路径用目录名当来源标签：包名与文件名才可读（/var/folders/… 那种 slug 没法看）
            source: isRemote ? target : dir.split('/').filter(Boolean).pop(),
            text: repoDigest(dir, result.scan, {}) + '\n' + repoCommandText(dir, result.scan, {}),
            // 知识点读全文（画像 + 命令），但抽草案只看命令部分：
            // 否则清单文件的指令（go.mod 里的 go 1.22）会被当成命令，生成废题
            commandText: repoCommandText(dir, result.scan, {})
          }, { limit: limit });
          if (ingested && ingested.ok === false) { sendJson(res, 400, { error: ingested.error, corrupted: Boolean(ingested.corrupted) }); return; }
          sendJson(res, 200, {
            project: ingested.project.name,
            dir: ingested.dir,
            via: resolved.via,           // local / reuse / direct / mirror:host / direct→本机 git 改写→host
            source: isRemote ? input.url : dir,
            signals: result.scan.signals.map(function (s) { return { id: s.id, note: s.note, files: s.files }; }),
            files: result.scan.files.length,
            knowledge: { matched: ingested.knowledge.matched, modules: ingested.knowledge.modules.map(function (m) { return { name: m.name, points: m.points.map(function (p) { return p.name; }) }; }) },
            tasks: ingested.draft.stats.tasks,
            artifacts: ingested.artifacts
          });
          return;
        }

        // 截图 / 文字 / 链接：都归一成 text 再走同一份 ingest
        let text = '';
        let source = '';
        let kind = 'text';
        if (typeof body.dataUrl === 'string' && body.dataUrl) {
          const saved = saveDataUrl(body.dataUrl, {});
          if (!saved.ok) { sendJson(res, 400, { error: '截图保存失败：' + saved.reason }); return; }
          const ocr = await ocrImage(saved.path, {});
          if (!ocr.ok) { sendJson(res, 400, { error: '截图识别失败：' + ocr.reason }); return; }
          kind = 'screenshot';
          // 来源名要给人看：浏览器上传时带上原文件名就用它，否则用一句人话。
          // 之前写的是 OCR 临时文件名（dsh-learn-ocr-1790486590），既看不懂又会写进用户的笔记标题里。
          const shotName = typeof body.fileName === 'string' ? safeBaseName(body.fileName, '') : '';
          source = shotName || ('浏览器上传的截图-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, ''));
          text = ocr.text;
        } else if (typeof body.url === 'string' && body.url) {
          const fetched = await fetchText(body.url, { wantHtml: true, maxBytes: 4 * 1024 * 1024, timeout: 20000 });
          if (!fetched.ok) { sendJson(res, 502, { error: '抓取失败：' + fetched.reason }); return; }
          kind = 'link';
          source = body.url;
          text = fetched.html || fetched.text;
        } else if (typeof body.text === 'string' && body.text.trim()) {
          text = body.text;
          source = text.slice(0, 40) + (text.length > 40 ? '…' : '');
        } else {
          sendJson(res, 400, { error: '要给出一种输入：截图 / 文字 / 链接 / 仓库' });
          return;
        }

        const ingested = ingestIntoProject(name, { kind: kind, source: source, text: text }, { limit: limit });
        if (ingested && ingested.ok === false) { sendJson(res, 400, { error: ingested.error, corrupted: Boolean(ingested.corrupted) }); return; }
        sendJson(res, 200, {
          project: ingested.project.name,
          dir: ingested.dir,
          kind: kind,
          knowledge: { matched: ingested.knowledge.matched, modules: ingested.knowledge.modules.map(function (m) { return { name: m.name, points: m.points.map(function (p) { return p.name; }) }; }) },
          tasks: ingested.draft.stats.tasks,
          artifacts: ingested.artifacts
        });
      } catch (err) {
        sendJson(res, 500, { error: '处理失败：' + String(err && err.message || err) });
      }
      return;
}

// 动作表：加接口从「在 300 行 if 链里找位置」变成「加一行」。
const ACTIONS = {
  delete: actionDelete,
  tasks: actionTasks,
  index: actionIndex,
  refresh: actionRefresh,
  jdplan: actionJdplan,
  drill: actionDrill,
  backfill: actionBackfill,
  rename: actionRename,
  import: actionImport,
  init: actionInit,
  add: actionAddSource
};

// GET 分支（项目详情 / 单条来源 / 列表）：从 handleProjectRoute 整块搬出，缩进与内容原样
async function handleProjectGet(ctx) {
  const { sendJson, req, res, url, body, name } = ctx;
  // 原来是外层 if 把关（只有 GET 进得来）；提取成函数后必须自带这道判断，
  // 否则 POST 请求也会被 GET 逻辑吃掉（实测：POST /api/project 直接没了响应）。
  if (req.method !== 'GET') return;
      const wanted = url.searchParams.get('name') || '';
      const sourceIndex = url.searchParams.get('source') || '';
      if (wanted && sourceIndex) {
        // 项目页点一条来源 → 看它的完整原文（岗位描述/文档原封不动）
        const row = readSourceText(wanted, sourceIndex);
        if (!row.ok) { sendJson(res, 404, { ok: false, error: row.error, source: row.source }); return; }
        // 结构化描述：界面不再直接扔原始文本（旧文件头部写着"公司：（未取到）"，那是抓取当时的事实，
        // 不应该当作解析结果展示）；这里按当前解析器现算，并如实标注是否只有列表卡片。
        // readSourceText 返回的 source 是**元数据对象**（带 source/textFile/points...），
        // 直接塞进响应会让界面显示 [object Object]；这里拆成文件名 + 元数据两份。
        const sourceMeta = (row.source && typeof row.source === 'object') ? row.source : null;
        const sourceLabel = sourceMeta ? String(sourceMeta.source || '') : String(row.source || '');
        let description = null;
        try { description = describeExtraction(row.text, { source: sourceLabel }); } catch (err) { description = null; }
        sendJson(res, 200, {
          ok: true, index: row.index, source: sourceLabel, sourceMeta: sourceMeta, text: row.text, file: row.file,
          cardOnly: String(row.text).indexOf('列表卡片原文') > -1,
          description: description
        });
        return;
      }
      if (wanted) {
        const meta = readProject(wanted);
        if (!meta) { sendJson(res, 404, { error: '没有这个项目：' + wanted }); return; }
        sendJson(res, 200, {
          meta: meta,
          dir: projectDir(wanted),
          sources: (meta.sources || []).map(function (row, index) {
            // 每条来源顺手给一份「结构化摘要」：列表要显示公司/城市/学历/经验，详情要显示完整描述。
            // 解析走同一份 core（understand/describe），与 CLI、原生端一致；readSourceText 按时长指纹缓存，重复调用不重读。
            let summary = null;
            let cardOnly = false;
            let chars = row.textChars || 0;
            try {
              const back2 = readSourceText(wanted, index + 1, {});
              if (back2.ok && back2.text) {
                chars = back2.text.length;
                cardOnly = back2.text.indexOf('列表卡片原文') > -1;
                const d = describeExtraction(back2.text, { source: row.source });
                summary = {
                  company: d.company || '', city: d.location || '', education: d.education || '',
                  experience: d.seniority || '', salary: (d.salary && d.salary.text) || '',
                  position: d.position || '', points: (d.report && d.report.matched) ? d.report.matched : 0
                };
              }
            } catch (err) { summary = null; }
            return {
              kind: row.kind,
              source: row.source,
              at: row.at,
              knowledge: row.knowledge || 0,
              tasks: row.tasks || 0,
              artifacts: row.artifacts || [],
              textFile: row.textFile || '',
              chars: chars,
              cardOnly: cardOnly,
              summary: summary
            };
          })
        });
        return;
      }
      // 列表支持筛选与检索（口径在 core/project.mjs#filterProjects，CLI/网页/原生共用）
      const query = url.searchParams.get('q') || url.searchParams.get('query') || '';
      const missingText = ['1', 'true', 'yes'].indexOf(String(url.searchParams.get('missingText') || '').toLowerCase()) > -1;
      const sort = url.searchParams.get('sort') || 'updated';
      const total = listProjects({}).length;
      const rows = listProjects({ query: query, missingText: missingText, sort: sort });
      sendJson(res, 200, {
        total: total,
        filtered: rows.length,
        filters: { query: query, missingText: missingText, sort: sort },
        projects: rows.map(function (row) {
          const missing = missingTextSources(row, {}).length;
          return {
            name: row.name,
            displayName: row.displayName,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            sources: (row.sources || []).length,
            knowledge: (row.sources || []).reduce(function (sum, item) { return sum + (item.knowledge || 0); }, 0),
            tasks: (row.sources || []).reduce(function (sum, item) { return sum + (item.tasks || 0); }, 0),
            missingText: missing,
            // 命中说明："为什么它出现在结果里"
            match: query ? projectSearchHit(row, query).fields : []
          };
        })
      });
      return;
}

export { ACTIONS, handleProjectGet };
