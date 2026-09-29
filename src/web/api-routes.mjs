// 小路由实现：每个 /api/* 一小段（从 api.mjs 整块搬出，内容与缩进原样）。
//
// 拆出理由与 routes/* 同一套：api.mjs 此前 332 行里混着「域移交」与「十几个小路由」两件事。
// 现在 api.mjs 只留保序路由表（域移交在前、小路由在后，顺序与改造前逐条一致），实现都在这里。
//
// 注意：这些函数被调用即代表「已处理」（原来每段都以 return; 结束，语义相同）。
export function ctxOf(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody } = c;
  return { req: req, res: res, url: url, pathname: pathname, serverPlatform: serverPlatform, sendJson: sendJson, readBody: readBody, readLargeBody: c.readLargeBody || readBody };
}

import { listTasks, findTask, TASKS, listTracks, BUILTIN_PACK_DIR, EXTRA_PACK_DIR } from '../core/tasks.mjs';
import { resolveTask, judge, platformBlocker, PASS_SCORE, PARTIAL_SCORE } from '../core/judge.mjs';
import { detectPlatform, getProfile, listPlatforms } from '../core/platform.mjs';
import { runReadonlyCommand, assessAnswer } from '../core/exec.mjs';
import { verifyWith, listRunners } from '../core/runners.mjs';
import { analyzeText, summarizeAnalysis, MODULES, POINTS } from '../core/knowledge.mjs';
import { fetchText } from '../core/ingest.mjs';
import { APP_VERSION } from './static.mjs';
import { ocrCapabilities, ocrImage, saveDataUrl } from '../core/ocr.mjs';
import { summarizeUnderstanding, understandText } from '../core/understand.mjs';
import { applicationPack, flowStatus, recommendJobs, matchJobs, studyPlan, renderStudyPlan, summarizeFlow } from '../core/flow.mjs';
import { buildScaffold, SCAFFOLD_FILES } from '../core/scaffold.mjs';
import { describeExtraction } from '../core/describe.mjs';
import { surveyGroups, surveyJds } from '../core/survey.mjs';
import { buildResume } from '../core/resume.mjs';
import { summarize, pickPractice, taskStats, streakDays, dailyPick, renderReport, reviewQueue, goalProgress } from '../core/progress.mjs';
import { backfillAll, backfillSourceText, createProject, importTree, ingestIntoProject, levelLabel, projectDrillPlan, readProject, readSourceText, renameProject, writeProjectFile, listProjects, missingTextSources, projectSearchHit, projectDir, projectTaskList, safeBaseName, slug, buildProjectIndex, loadProjectTasks, refreshProjectPoints } from '../core/project.mjs';
import { userPackDir } from '../core/packs.mjs';
import { research as researchWeb, searchWeb } from '../core/search.mjs';
import { JOB_STATUSES, JOB_STATUS_LABELS, analyzeJd, jobStats, listJobs, mergeJob, removeJob, jobFollowUps } from '../core/jobs.mjs';
import { analyzeRepo, repoDigest, repoCommandText, normalizeRepoInput, parseGitRewrites, resolveRepoDir } from '../core/repo-learn.mjs';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { promoteDraft } from '../cli/commands/packs.mjs';
import { validatePack } from '../core/schema.mjs';
import { isAllowed } from '../core/exec.mjs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPlan } from '../core/plan.mjs';
import { record, board, load, importProgress, exportProgress, storageHealth, readGoals, writeGoals, readNote, readNotes, writeNote, goalsPath, notesPath, readJobs, writeJobs, deleteJobRecord, jobsPath, homeDir } from '../store.mjs';
import { buildJdPlan } from '../core/jdplan.mjs';
import { searchCorpus } from '../core/corpus.mjs';
import { fixDoctor, runDoctor } from '../core/doctor.mjs';
import { LEVEL_LABELS } from '../core/text.mjs';
import { masteryReport } from '../core/mastery.mjs';
import { locateMissing } from '../core/feedback.mjs';
import { packTemplate, deepValidate } from '../core/packfile.mjs';

// probe：几个只读命令 + 诊断结论（内部使用）
async function probeServer(serverPlatform, run) {
  const list = [];
  async function step(cmd, label) {
    list.push(Object.assign({ label: label }, await runReadonlyCommand(cmd, { run: run })));
  }
  await step('uname -s', '系统类型');
  if (serverPlatform === 'darwin') await step('sw_vers -productVersion', 'macOS 版本');
  await step('docker version', 'Docker 版本');
  await step('docker context ls', 'Docker 上下文');
  const docker = list.filter(function (item) { return item.cmd === 'docker version'; })[0];
  return {
    platform: serverPlatform,
    profile: getProfile(serverPlatform),
    daemonDown: Boolean(docker && docker.ran && !docker.ok),
    probes: list
  };
}

// review（从 handleApi 整块搬出，内容与缩进原样）
export async function reviewRoute(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody, readLargeBody } = ctxOf(c);
  if (req.method === 'GET' && pathname === '/api/review') {
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 10));
    const track = url.searchParams.get('track') || 'all';
    const queue = reviewQueue(load().records, TASKS, { limit: limit, track: track });
    sendJson(res, 200, {
      due: queue.due.map(function (row) { return Object.assign({}, row, { goal: resolveTask(findTask(row.taskId), serverPlatform).goal }); }),
      upcoming: queue.upcoming.slice(0, 10),
      track: track
    });
    return;
  }
}


// goal（从 handleApi 整块搬出，内容与缩进原样）
export async function goalRoute(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody, readLargeBody } = ctxOf(c);
  if (pathname === '/api/goal') {
    if (req.method === 'GET') {
      const goal = readGoals();
      sendJson(res, 200, { goal: goal, progress: goalProgress(load().records, TASKS, goal), path: goalsPath() });
      return;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const goal = writeGoals({ dailyTasks: body.dailyTasks, dailyMinutes: body.dailyMinutes });
      sendJson(res, 200, { goal: goal, progress: goalProgress(load().records, TASKS, goal) });
      return;
    }
  }
}


// note（从 handleApi 整块搬出，内容与缩进原样）
export async function noteRoute(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody, readLargeBody } = ctxOf(c);
  if (pathname === '/api/note') {
    if (req.method === 'GET') {
      const taskId = url.searchParams.get('taskId');
      if (!taskId) {
        sendJson(res, 200, { notes: readNotes(), path: notesPath() });
        return;
      }
      sendJson(res, 200, { taskId: taskId, note: readNote(taskId) });
      return;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body.taskId || !findTask(body.taskId)) {
        sendJson(res, 404, { error: '未找到任务 ' + (body.taskId || '(空)') });
        return;
      }
      const saved = writeNote(body.taskId, body.text);
      sendJson(res, 200, { taskId: body.taskId, note: saved.deleted ? null : saved.note, deleted: Boolean(saved.deleted) });
      return;
    }
  }
}


// knowledge（从 handleApi 整块搬出，内容与缩进原样）
export async function knowledgeRoute(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody, readLargeBody } = ctxOf(c);
  if (req.method === 'GET' && pathname === '/api/knowledge') {
    sendJson(res, 200, {
      modules: MODULES,
      points: POINTS.map(function (point) {
        return { id: point.id, module: point.module, name: point.name, level: point.level, tasks: point.tasks };
      })
    });
    return;
  }
}


// doctor（从 handleApi 整块搬出，内容与缩进原样）
export async function doctorRoute(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody, readLargeBody } = ctxOf(c);
  if (pathname === '/api/doctor' && req.method === 'GET') {
    const result = runDoctor({});
    sendJson(res, 200, result);
    return;
  }
  if (pathname === '/api/doctor' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.fix !== true) { sendJson(res, 400, { ok: false, error: '要显式给 { fix: true } 才动手修' }); return; }
    const result = fixDoctor({});
    sendJson(res, 200, result);
    return;
  }
}


// pack（从 handleApi 整块搬出，内容与缩进原样）
export async function packRoute(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody, readLargeBody } = ctxOf(c);
  if (pathname === '/api/pack' && req.method === 'POST') {
    const body = await readBody(req);
    const action = String(body.action || 'validate');
    if (action === 'new') {
      try {
        const pack = packTemplate({
          id: String(body.id || ''),
          name: body.name, track: body.track, title: body.title, sample: body.sample, verifyCmd: body.verifyCmd
        });
        sendJson(res, 200, { ok: true, action: 'new', pack: pack, check: deepValidate(pack) });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return;
    }
    if (action === 'validate') {
      const pack = body.pack;
      if (!pack || typeof pack !== 'object') { sendJson(res, 400, { error: '缺少 pack（要校验的题包对象或 JSON 字符串）' }); return; }
      const parsed = typeof pack === 'string' ? JSON.parse(pack) : pack;
      sendJson(res, 200, { ok: true, action: 'validate', check: deepValidate(parsed) });
      return;
    }
    if (action === 'validate-all') {
      // 全库体检：把 packs/ 下每个包都过一遍深度校验（与 CLI pack validate --deep 同一套口径）
      const dirs = [BUILTIN_PACK_DIR, EXTRA_PACK_DIR].filter(function (dir) { return dir && existsSync(dir); });
      const files = [];
      dirs.forEach(function (dir) {
        readdirSync(dir).filter(function (name) { return name.endsWith('.json'); }).forEach(function (name) {
          files.push(join(dir, name));
        });
      });
      const rows = files.map(function (file) {
        try {
          const check = deepValidate(JSON.parse(readFileSync(file, 'utf8')));
          return { file: file, packId: check.packId, ok: check.ok, tasks: check.taskCount, errors: check.errors, warnings: check.warnings };
        } catch (err) {
          return { file: file, packId: '', ok: false, tasks: 0, errors: ['读取或解析失败：' + err.message], warnings: [] };
        }
      });
      const bad = rows.filter(function (row) { return !row.ok; });
      sendJson(res, 200, {
        ok: true,
        action: 'validate-all',
        packs: rows.length,
        tasks: rows.reduce(function (sum, row) { return sum + row.tasks; }, 0),
        bad: bad.length,
        warnings: rows.reduce(function (sum, row) { return sum + row.warnings.length; }, 0),
        rows: rows
      });
      return;
    }

    sendJson(res, 400, { error: '未知的 action：' + action + '（可用：new / validate）' });
    return;
  }
}


// mastery（从 handleApi 整块搬出，内容与缩进原样）
export async function masteryRoute(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody, readLargeBody } = ctxOf(c);
  if (pathname === '/api/mastery' && req.method === 'GET') {
    const report = masteryReport(load().records || [], TASKS, {
      limit: Number(url.searchParams.get('limit')) || 5,
      now: url.searchParams.get('now') || undefined
    });
    sendJson(res, 200, { ok: true, report: report, markdown: report.markdown });
    return;
  }
}


// corpus（从 handleApi 整块搬出，内容与缩进原样）
export async function corpusRoute(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody, readLargeBody } = ctxOf(c);
  if (pathname === '/api/corpus' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (!q.trim()) { sendJson(res, 400, { ok: false, error: '缺少关键词 q' }); return; }
    const projects = String(url.searchParams.get('project') || '').split(',').map(function (row) { return row.trim(); }).filter(Boolean);
    const result = searchCorpus(q, {
      limit: Number(url.searchParams.get('limit')) || 20,
      mode: url.searchParams.get('any') ? 'any' : 'all',
      projects: projects
    });
    sendJson(res, 200, Object.assign({ ok: true }, result));
    return;
  }
}


// draft（从 handleApi 整块搬出，内容与缩进原样）
export async function draftRoute(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody, readLargeBody } = ctxOf(c);
  if (pathname === '/api/draft' && req.method === 'GET') {
    const name = url.searchParams.get('project') || '';
    if (!name) { sendJson(res, 400, { error: '缺少 project 参数' }); return; }
    const dir = join(projectDir(name), 'drafts');
    const rows = existsSync(dir) ? readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).sort() : [];
    // 顺带把"是否已入总题库"带出来（从项目索引里查）：列表上直接显示状态，
    // 否则用户会反复点"加入总题库"，而他早就加过了
    const index = loadProjectTasks(name) || { drafts: [] };
    const catalogState = {};
    (index.drafts || []).forEach(function (row) { if (row.packId) catalogState[row.packId] = Boolean(row.inCatalog); });
    sendJson(res, 200, {
      project: name,
      drafts: rows.map(function (file) {
        let taskCount = 0;
        let packId = file.replace(/\.json$/, '');
        let kind = 'pack';
        let planTasks = [];
        try {
          const pack = JSON.parse(readFileSync(join(dir, file), 'utf8'));
          // 计划草案（kind: plan）没有新题定义，只有一个练习清单——界面据此隐藏"加入总题库"
          kind = pack.kind === 'plan' ? 'plan' : 'pack';
          taskCount = kind === 'plan' ? (pack.rows || []).length : (pack.tasks || []).length;
          planTasks = kind === 'plan' ? (pack.nextUp || pack.rows || []).map(function (row) { return row.taskId; }).filter(Boolean) : [];
          packId = pack.id || packId;
        } catch (err) { /* 坏文件也列出来，让用户看见 */ }
        return { file: file, packId: packId, tasks: taskCount, kind: kind, planTasks: planTasks, inCatalog: Boolean(catalogState[packId]) };
      })
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/draft') {
    const body = await readBody(req);
    const name = String(body.project || '').trim();
    const file = String(body.file || '').trim();
    if (!name || !file) { sendJson(res, 400, { error: '需要 project 与 file' }); return; }
    const safeFile = safeBaseName(file);
    if (!safeFile) { sendJson(res, 400, { error: '草案文件名不合法（只允许文件名，不允许路径）' }); return; }
    const draftPath = join(projectDir(name), 'drafts', safeFile);
    if (!existsSync(draftPath)) { sendJson(res, 404, { error: '找不到草案：' + file }); return; }
    let draft;
    try { draft = JSON.parse(readFileSync(draftPath, 'utf8')); } catch (err) { sendJson(res, 400, { error: '草案不是合法 JSON：' + err.message }); return; }
    const dryRun = body.dryRun !== false; // 默认只预览
    // 两个去处：
    //   project（默认）→ 项目目录的 promoted/ 暂存区，攒着不入库
    //   catalog → 总题库 = 用户题库目录（~/.dsh-learn/packs/），写完所有客户端下次启动就能练
    // 目标路径都由服务端自己拼（草案 id 先过 slug），用户给不了路径，所以 catalog 这一路不需要 baseDir 守卫
    const scope = body.scope === 'catalog' ? 'catalog' : 'project';
    const target = scope === 'catalog'
      ? join(userPackDir(), slug(draft.id || 'draft-pack') + '.json')
      : join(projectDir(name), 'promoted', slug(draft.id || 'draft-pack') + '.json');
    const result = promoteDraft(draft, {
      dryRun: dryRun,
      into: target,
      baseDir: scope === 'catalog' ? undefined : projectDir(name),
      force: Boolean(body.force),
      validate: function (candidate) { return validatePack(candidate, { isAllowedCommand: isAllowed }); }
    });
    // 预览时把补齐 level 后的包也给回去：网页上可以直接下载这份正式包
    const promoted = dryRun ? null : (existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null);
    // 真的写进总题库之后刷新项目索引：界面上的「已在总题库」要立刻反映出来
    const index = (dryRun || scope !== 'catalog') ? null : buildProjectIndex(name);
    sendJson(res, 200, {
      project: name,
      file: file,
      scope: scope,
      dryRun: dryRun,
      inCatalog: Boolean(index && (index.drafts || []).some(function (row) { return row.packId === result.packId && row.inCatalog; })),
      packId: result.packId,
      taskCount: result.taskCount,
      levelsAdded: result.levelsAdded,
      warnings: result.warnings,
      errors: result.errors,
      target: result.target,
      pack: promoted
    });
    return;
  }
}


// probe（从 handleApi 整块搬出，内容与缩进原样）
export async function probeRoute(c) {
  const { req, res, url, pathname, serverPlatform, sendJson, readBody, readLargeBody } = ctxOf(c);
  if (req.method === 'POST' && pathname === '/api/probe') {
    const body = await readBody(req);
    sendJson(res, 200, { probe: await probeServer(serverPlatform, Boolean(body.run)) });
    return;
  }
}
