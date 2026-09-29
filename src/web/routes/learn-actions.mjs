// 学习核心域的动作实现：每个「方法 + 路径」一个函数（从 handleLearnRoute 的 if 链整块搬出，内容原样）。
//
// 拆出理由与 project 域同一套：if 链让「加一条接口」= 在 273 行里找位置；改成 ROUTES 表后是加一行。
// learn.mjs 只留分发器（约 25 行）；本文件含 13 个动作 + 变体题 helper。


import { assessAnswer } from '../../core/exec.mjs';
import { locateMissing } from '../../core/feedback.mjs';
import { PARTIAL_SCORE, PASS_SCORE, judge, platformBlocker, resolveTask } from '../../core/judge.mjs';
import { buildPlan } from '../../core/plan.mjs';
import { detectPlatform, getProfile, listPlatforms } from '../../core/platform.mjs';
import { dailyPick, goalProgress, pickPractice, renderReport, streakDays, summarize, taskStats } from '../../core/progress.mjs';
import { listRunners, verifyWith } from '../../core/runners.mjs';
import { TASKS, findTask, listTasks, listTracks } from '../../core/tasks.mjs';
import { LEVEL_LABELS } from '../../core/text.mjs';
import { logEvent } from '../../core/log.mjs';
import { board, exportProgress, importProgress, load, readGoals, record, storageHealth } from '../../store.mjs';
import { APP_VERSION } from '../static.mjs';  // 同级路径要升一层：本文件在 routes/ 下

// GET /api/bootstrap（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnBootstrap(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        const platform = detectPlatform(url.searchParams.get('platform') || undefined);
        sendJson(res, 200, {
          platforms: listPlatforms(),
          tracks: listTracks(),
          levels: ['easy', 'medium', 'hard'],
          levelLabels: LEVEL_LABELS,
          serverPlatform: serverPlatform,
          platform: platform,
          // 版本号也下发：页面显示出来，老页面配新服务端一眼可见，报 bug 时也能说清版本
          appVersion: APP_VERSION,
          profile: getProfile(platform),
          tasks: listTasks().map(function (task) {
            const resolved = resolveTask(task, platform);
            return {
              id: resolved.id,
              track: resolved.track,
              level: resolved.level || null,
              title: resolved.title,
              goal: resolved.goal,
              hint: resolved.hint,
              sample: resolved.sample,
              require: resolved.require.map(function (rule) { return rule.tip; }),
              // 完整规则也一起下发：断网时浏览器可以本地判定（判定内核本身就是纯函数）
              rules: {
                require: resolved.require.map(function (rule) { return { p: rule.p, tip: rule.tip }; }),
                forbid: (resolved.forbid || []).map(function (rule) { return { p: rule.p, tip: rule.tip, severity: rule.severity }; })
              },
              verify: resolved.verify ? { cmd: resolved.verify.cmd, expect: resolved.verify.expect, note: resolved.verify.note || '' } : null,
              // 这道题在别的平台怎么写：只带平台名与参考答案（46 道变体题，体积可忽略），
              // 页面因此能直接告诉学员"同一条命令在 linux 上是另一个写法"
              others: otherPlatformSamples(task, resolved.platform),
              // 题目声明了 platforms 时（5 道：launchctl、pkgutil/dpkg、bash 版本差异），
              // 页面要能说出"这道题不覆盖当前平台，判定走兜底规则"
              supported: resolved.supported,
              taskPlatforms: resolved.taskPlatforms
            };
          })
        });
        return;
}


// GET /api/drill（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnDrill(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        const mode = url.searchParams.get('mode') || 'weak';
        const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 5));
        const track = url.searchParams.get('track') || 'all';
        const wanted = (url.searchParams.get('tasks') || '').split(',').map(function (id) { return id.trim(); }).filter(Boolean);

        // 指定题号：来自"岗位/文档分析"的训练清单，按给定顺序返回，不再按权重重排
        if (wanted.length) {
          const rows = wanted.filter(function (id) { return findTask(id); }).slice(0, limit).map(function (id) {
            const task = resolveTask(findTask(id), detectPlatform(url.searchParams.get('platform') || undefined));
            return {
              taskId: task.id,
              track: task.track,
              title: task.title,
              reason: '来自分析清单',
              weight: 100,
              goal: task.goal,
              hint: task.hint,
              requireCount: task.require.length,
              hasVerify: Boolean(task.verify)
            };
          });
          sendJson(res, 200, { mode: 'analyze', total: rows.length, practice: rows });
          return;
        }

        let usedMode = mode;
        let practice = pickPractice(load().records, TASKS, { mode: mode, limit: limit, track: track });
        if (mode === 'weak' && !practice.length) {
          usedMode = 'new';
          practice = pickPractice(load().records, TASKS, { mode: 'new', limit: limit, track: track });
        }
        sendJson(res, 200, {
          mode: usedMode,
          total: practice.length,
          practice: practice.map(function (row) {
            const task = resolveTask(findTask(row.taskId), detectPlatform(url.searchParams.get('platform') || undefined));
            return Object.assign({}, row, {
              goal: task.goal,
              hint: task.hint,
              requireCount: task.require.length,
              hasVerify: Boolean(task.verify)
            });
          })
        });
        return;
}


// GET /api/history（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnHistory(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        const taskId = url.searchParams.get('taskId') || '';
        const clientId = url.searchParams.get('clientId') || '';
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 20));
        const all = load().records;
        const rows = all.slice().reverse().filter(function (item) {
          if (taskId && item.taskId !== taskId) return false;
          if (clientId && item.client !== clientId) return false;
          return true;
        }).slice(0, limit).map(function (item) {
          return {
            taskId: item.taskId,
            client: item.client,
            score: item.score,
            verdict: item.verdict,
            platform: item.platform,
            at: item.at,
            answer: item.answer || ''
          };
        });
        sendJson(res, 200, { history: rows, totalRecords: all.length });
        return;
}


// GET /api/board（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnBoard(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        sendJson(res, 200, { board: board() });
        return;
}


// GET /api/progress（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnProgress(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        const records = load().records;
        const stats = taskStats(records, TASKS);
        // 左侧题目列表需要每题的掌握状态，一次请求全给回去，避免页面为每个题各发一次请求
        const byTask = {};
        stats.known.forEach(function (row) {
          byTask[row.taskId] = { best: row.best, attempts: row.attempts, lastVerdict: row.lastVerdict, at: row.at };
        });
        sendJson(res, 200, {
          summary: summarize(records, TASKS),
          byTask: byTask,
          streak: streakDays(records),
          passScore: PASS_SCORE,
          partialScore: PARTIAL_SCORE,
          records: records.length,
          storage: storageHealth(),
          goal: goalProgress(records, TASKS, readGoals())
        });
        return;
}


// GET /api/daily（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnDaily(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        const platform = detectPlatform(url.searchParams.get('platform') || undefined);
        const track = url.searchParams.get('track') || 'all';
        const daily = dailyPick(load().records, TASKS, { track: track, tasks: TASKS });
        sendJson(res, 200, {
          daily: daily ? Object.assign({}, daily, {
            goal: resolveTask(findTask(daily.taskId), platform).goal,
            hint: resolveTask(findTask(daily.taskId), platform).hint
          }) : null,
          track: track
        });
        return;
}


// GET /api/report（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnReport(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        const markdown = renderReport(load().records, TASKS, {});
        res.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-length': Buffer.byteLength(markdown)
        });
        res.end(markdown);
        return;
}


// POST /api/plan（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnPlan(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        const body = await readBody(req);
        const platform = detectPlatform(body.platform || serverPlatform);
        const plan = buildPlan(TASKS, {
          platform: platform,
          hoursPerDay: Number(body.hoursPerDay) || 2,
          track: body.track && body.track !== 'all' ? body.track : undefined
        });
        sendJson(res, 200, { plan: plan });
        return;
}


// POST /api/import（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnImport(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        // 批量数据：一次导入几百上千条记录（备份恢复、离线队列补传）能轻松超过全局 64KB，
        // 用大请求体上限；实测 400 条（73KB）在 64KB 上限下会被 413 顶回来。
        const body = await readLargeBody(req);
        const result = importProgress(body);
        sendJson(res, 200, { import: result, board: board() });
        return;
}


// GET /api/export（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnExport(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        sendJson(res, 200, exportProgress());
        return;
}


// POST /api/check（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnCheck(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        const body = await readBody(req);
        const task = findTask(body.taskId);
        if (!task) return sendJson(res, 404, { error: '未找到任务 ' + body.taskId });
        const platform = detectPlatform(body.platform || serverPlatform);
        // 题目声明了 platforms 且当前平台不在其中：不判分、不记录（判定会用该平台根本不存在的命令兜底）
        const blocker = platformBlocker(resolveTask(task, platform));
        if (blocker) return sendJson(res, 400, { error: blocker, platformUnsupported: true });
        const result = judge(task, body.answer, platform);
        // 执行型判定：body.run === true 才真跑（只读白名单内），并如实回报"没跑"的原因
        let execution = null;
        if (body.run) {
          execution = await assessAnswer(task, body.answer, { run: true, timeout: Number(body.timeout) || undefined });
        }

        // 判定前先取这道题的历史成绩：与 CLI 的 check 输出同一套字段，
        // 网页版不用再靠自己那份（可能过期的）进度快照推算"这次比上次"
        const rows = load().records.filter(function (row) { return row.taskId === task.id; });
        const previousBest = rows.reduce(function (max, row) { return Math.max(max, row.score || 0); }, 0);
        const attempts = rows.length;

        logEvent('info', 'check', { taskId: task.id, client: String(body.clientId || 'web-client'), score: result.score, pass: Boolean(result.pass), platform: platform });
        record({
          client: String(body.clientId || 'web-client'),
          taskId: task.id,
          score: result.score,
          verdict: result.verdict,
          platform: platform,
          answer: result.answer
        });
        sendJson(res, 200, {
          result: result,
          task: resolveTask(task, platform),
          board: board(),
          // 判定反馈定位：缺的要素最可能补在哪一行
          feedback: result.missing && result.missing.length ? locateMissing(task, body.answer, platform) : { located: [], unmatched: [] },
          // 执行型判定：只在 run:true 时给（null 表示没要执行，未运行的原因在 reason 里）
          execution: execution,
          previousBest: attempts ? previousBest : null,
          attempts: attempts + 1,
          delta: attempts ? result.score - previousBest : null
        });
        return;
}


// POST /api/verify（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnVerify(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        const body = await readBody(req);
        const task = findTask(body.taskId);
        if (!task) return sendJson(res, 404, { error: '未找到任务 ' + body.taskId });
        const platform = detectPlatform(body.platform || serverPlatform);
        const result = await verifyWith(resolveTask(task, platform), {
          run: Boolean(body.run),
          runner: body.runner || 'local',
          endpoint: body.endpoint,
          token: body.token,
          image: body.image
        });
        sendJson(res, 200, { verify: result });
        return;
}


// GET /api/runners（从 handleLearnRoute 的 if 链整块搬出，内容与缩进原样）
async function learnRunners(ctx) {
  const { sendJson, req, res, url, pathname, serverPlatform, readBody, readLargeBody } = ctx;
        sendJson(res, 200, {
          runners: listRunners({
            endpoint: url.searchParams.get('endpoint') || undefined,
            timeout: 5000
          })
        });
        return;
}

function otherPlatformSamples(task, current) {
  const variants = (task && task.variants) || null;
  if (!variants) return null;
  const out = {};
  Object.keys(variants).forEach(function (platform) {
    if (platform === current) return;
    const sample = variants[platform] && variants[platform].sample;
    if (sample) out[platform] = sample;
  });
  return Object.keys(out).length ? out : null;
}

// 环境探测：几个只读命令 + 诊断结论

// 路由表：加接口只加一行（键是「方法 + 路径」）。
const ROUTES = {
  'GET /api/bootstrap': learnBootstrap,
  'GET /api/drill': learnDrill,
  'GET /api/history': learnHistory,
  'GET /api/board': learnBoard,
  'GET /api/progress': learnProgress,
  'GET /api/daily': learnDaily,
  'GET /api/report': learnReport,
  'POST /api/plan': learnPlan,
  'POST /api/import': learnImport,
  'GET /api/export': learnExport,
  'POST /api/check': learnCheck,
  'POST /api/verify': learnVerify,
  'GET /api/runners': learnRunners
};
export { ROUTES };
