// Web API：所有 /api/* 的实现在这里，HTTP 外壳只负责解析与分发。
import { listTasks, findTask, TASKS, listTracks, BUILTIN_PACK_DIR, EXTRA_PACK_DIR } from '../core/tasks.mjs';
import { resolveTask, judge, platformBlocker, PASS_SCORE, PARTIAL_SCORE } from '../core/judge.mjs';
import { detectPlatform, getProfile, listPlatforms } from '../core/platform.mjs';
import { runReadonlyCommand, assessAnswer } from '../core/exec.mjs';
import { verifyWith, listRunners } from '../core/runners.mjs';
import { analyzeText, summarizeAnalysis, MODULES, POINTS } from '../core/knowledge.mjs';
import { fetchText } from '../core/ingest.mjs';
import { APP_VERSION } from './static.mjs';
import { handleProjectRoute } from './routes/project.mjs';
import { handleJobsRoute } from './routes/jobs.mjs';
import { handleFlowRoute } from './routes/flow.mjs';
import { handleResearchRoute } from './routes/research.mjs';
import { handleLearnRoute } from './routes/learn.mjs';
import { handleOpsRoute } from './routes/ops.mjs';
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

// 其他平台的参考答案：给页面显示"同一条命令换个平台怎么写"
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

export async function handleApi(c) {
  const { req, res, url, sendJson, readBody, serverPlatform, pathname } = c;
  // 需要收图片的路由用它拿 8MB 上限；其余路由仍走 64KB 的小请求体
  const readLargeBody = c.readLargeBody || readBody;
  // 运维域（存储 schema / 整机备份恢复 / 运行指标 / 首次运行引导）已拆到 routes/ops.mjs
  if (['/api/storage', '/api/backup', '/api/metrics', '/api/onboarding', '/api/commands', '/api/prefs', '/api/i18n', '/api/scorecard', '/api/reminder'].indexOf(pathname) > -1) {
    if (await handleOpsRoute(c)) return true;
  }

  // 学习核心域（bootstrap/drill/history/board/progress/daily/report/plan/import/export/check/verify/runners）已拆到 routes/learn.mjs
  const LEARN_PATHS = ['/api/bootstrap', '/api/drill', '/api/history', '/api/board', '/api/progress', '/api/daily', '/api/report', '/api/plan', '/api/import', '/api/export', '/api/check', '/api/verify', '/api/runners'];
  if (LEARN_PATHS.indexOf(pathname) > -1) { if (await handleLearnRoute(c)) return true; }
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

  // 岗位/文档分析：文本、链接（服务端抓取去标签）、截图（本机 OCR）




  // 七步闭环：状态 / 简历 / 推荐 / 搜集 / 投递。口径在 core/flow.mjs 与 core/resume.mjs（CLI flow 用同一份）。
  // 流程域（七步闭环）已拆到 routes/flow.mjs
  if (pathname === '/api/flow') { if (await handleFlowRoute(c)) return true; }
  // 调研 / 理解域（survey/describe/ocr/understand/search/research）已拆到 routes/research.mjs
  if (['/api/survey', '/api/describe', '/api/ocr', '/api/understand', '/api/search', '/api/research'].indexOf(pathname) > -1) {
    if (await handleResearchRoute(c)) return true;
  }
  if (pathname === '/api/jobs' || pathname === '/api/analyze') { if (await handleJobsRoute(c)) return true; }
  if (req.method === 'GET' && pathname === '/api/knowledge') {
    sendJson(res, 200, {
      modules: MODULES,
      points: POINTS.map(function (point) {
        return { id: point.id, module: point.module, name: point.name, level: point.level, tasks: point.tasks };
      })
    });
    return;
  }

  // 项目目录与仓库解析：网页版与 CLI 走同一份 core（core/project.mjs 的 ingestIntoProject）
  // 数据体检：项目元数据 / 索引 / 原文 / 草案 / 记录是否自洽（网页版与原生端共用）
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

  // 题包：深度校验（口径 + 参考答案自测）与模板生成；都只算不落盘（落盘是 CLI 的事）
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

  // 知识点掌握度（网页版与原生端共用；口径在 core/mastery.mjs）
  if (pathname === '/api/mastery' && req.method === 'GET') {
    const report = masteryReport(load().records || [], TASKS, {
      limit: Number(url.searchParams.get('limit')) || 5,
      now: url.searchParams.get('now') || undefined
    });
    sendJson(res, 200, { ok: true, report: report, markdown: report.markdown });
    return;
  }

  // 语料全文检索：跨项目在来源原文里找关键词（网页版与原生端共用）
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

  // 项目域（GET 列表/详情/来源；POST init/import/backfill/index/drill/jdplan/…）已拆到 routes/project.mjs。
  // 没命中方法时不回响应、继续往下走，最终由本函数的 return false 交给上层 404。
  if (pathname === '/api/project') { if (await handleProjectRoute(c)) return true; }
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
  if (req.method === 'POST' && pathname === '/api/probe') {
    const body = await readBody(req);
    sendJson(res, 200, { probe: await probeServer(serverPlatform, Boolean(body.run)) });
    return;
  }

  return false;
}

// 七步闭环用到的装载函数：状态与简历都要「进度 + 项目 + 岗位」这三份数据