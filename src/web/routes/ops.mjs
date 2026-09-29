// 运维域路由：存储 schema（状态/迁移）、整机备份/恢复、运行指标。
//
// 这三个都是「工程能力」，与业务域（项目/流程/投递/调研/学习）分开；从 api.mjs 拆出来的第五个域，
// 起因是 api.mjs 涨到 408 行超过了自己的 400 行预算——按既定规矩：拆，而不是抬预算。
import { backupStatus, createBackup, planBackup, restoreBackup } from '../../core/backup.mjs';
import { logStatus, readEvents, summarizeEvents } from '../../core/log.mjs';
import { COMMANDS, shortcutRows } from '../../core/commands.mjs';
import { LANGS, dictionary } from '../../core/i18n.mjs';
import { scorecard, scorecardMarkdown } from '../../core/trend.mjs';
import { reminder } from '../../core/reminder.mjs';
import { onboardingState } from '../../core/onboarding.mjs';
import { listProjects } from '../../core/project.mjs';
import { TASKS } from '../../core/tasks.mjs';
import { APP_VERSION } from '../static.mjs';
import { homeDir, load, migrateStorage, readGoals, readJobs, readNotes, readPrefs, storageStatus, writePrefs } from '../../store.mjs';

export async function handleOpsRoute(c) {
  const { req, res, url, pathname } = c;
  let sent = false;
  const sendJson = function (response, code2, payload) { sent = true; return c.sendJson(response, code2, payload); };
  const readBody = c.readBody;
  const serverPlatform = c.serverPlatform;
  const run = async function () {
    // 存储 schema：状态只读；迁移显式（POST），支持 dryRun。
    if (pathname === '/api/storage') {
      if (req.method === 'GET') { sendJson(res, 200, storageStatus()); return; }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const action = String(body.action || 'migrate');
        if (action !== 'migrate') { sendJson(res, 400, { error: '未知的 action：' + action + '（可用：migrate）' }); return; }
        sendJson(res, 200, migrateStorage({ dryRun: Boolean(body.dryRun) }));
        return;
      }
    }

    // 整机备份 / 恢复：GET 出计划；POST 显式执行（create / restore），都支持 dryRun。
    if (pathname === '/api/backup') {
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, plan: planBackup(homeDir()), status: backupStatus(homeDir()) });
        return;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const action = String(body.action || 'create');
        if (action === 'create') {
          sendJson(res, 200, createBackup(homeDir(), { out: body.out, dryRun: Boolean(body.dryRun) }));
          return;
        }
        if (action === 'restore') {
          if (!body.file) { sendJson(res, 400, { error: '恢复需要 file（备份包路径）' }); return; }
          sendJson(res, 200, restoreBackup(String(body.file), { home: homeDir(), dryRun: Boolean(body.dryRun) }));
          return;
        }
        sendJson(res, 400, { error: '未知的 action：' + action + '（可用：create / restore）' });
        return;
      }
    }

    // 运行指标：把结构化日志聚合成「请求量 / 延迟 / 错误率 / 事件分布」，外加本地数据量。
    if (pathname === '/api/metrics' && req.method === 'GET') {
      const home = homeDir();
      const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get('limit')) || 200));
      const read = readEvents({ home: home, limit: limit });
      const status = logStatus(home);
      sendJson(res, 200, {
        ok: true,
        version: APP_VERSION,
        uptimeSec: Math.round(process.uptime()),
        home: home,
        counts: {
          records: load().records.length,
          jobs: readJobs().length,
          projects: listProjects({}).length,
          notes: Object.keys(readNotes()).length,
          tasks: TASKS.length
        },
        logs: { file: status.file, sizeBytes: status.sizeBytes || 0, brokenLines: read.broken, events: read.events.length },
        summary: summarizeEvents(read.events)
      });
      return;
    }

    // 界面偏好（目前是外观主题）：三端共用一份，CLI 能设、网页与原生端读。
    if (pathname === '/api/prefs') {
      if (req.method === 'GET') { sendJson(res, 200, { ok: true, prefs: readPrefs() }); return; }
      if (req.method === 'POST') {
        const body = await readBody(req);
        try {
          const patch = {};
          if (body.theme !== undefined) patch.theme = body.theme;
          if (body.lang !== undefined) patch.lang = body.lang;
          sendJson(res, 200, { ok: true, prefs: writePrefs(patch) });
        } catch (err) {
          sendJson(res, 400, { error: err.message });
        }
        return;
      }
    }

    // 界面文案表：网页版从这儿取（core/i18n.mjs 是唯一事实源），断网时页面保持默认中文。
    if (pathname === '/api/i18n' && req.method === 'GET') {
      const wanted = url.searchParams.get('lang');
      const lang = LANGS.indexOf(wanted) > -1 ? wanted : 'zh-CN';
      sendJson(res, 200, { ok: true, langs: LANGS, lang: lang, messages: dictionary(lang) });
      return;
    }

    // 命令面板的命令表：网页版、原生端、CLI 都从这一份来，避免各写一份走样。
    if (pathname === '/api/commands' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, commands: COMMANDS, shortcuts: shortcutRows() });
      return;
    }

    // 目标提醒：今天的练习量 vs 每日目标（三端同一份 core/reminder.mjs）。
    if (pathname === '/api/reminder' && req.method === 'GET') {
      const nowParam = url.searchParams.get('now');
      sendJson(res, 200, { ok: true, reminder: reminder(load().records, readGoals(), nowParam ? { now: nowParam } : {}) });
      return;
    }

    // 进度趋势与成绩单：网页版画柱状图，原生端读数字，CLI 有同一份 core/trend.mjs。
    if (pathname === '/api/scorecard' && req.method === 'GET') {
      const days = Math.max(1, Math.min(180, Number(url.searchParams.get('days')) || 14));
      const card = scorecard(load().records, { days: days });
      if (url.searchParams.get('format') === 'markdown') {
        sendJson(res, 200, { ok: true, file: '成绩单.md', markdown: scorecardMarkdown(card) });
        return;
      }
      sendJson(res, 200, card);
      return;
    }

    // 首次运行引导：三端看同一份状态（只读本地事实，离线可用）。
    if (pathname === '/api/onboarding' && req.method === 'GET') {
      const projects = listProjects({});
      sendJson(res, 200, {
        ok: true,
        state: onboardingState({
          platform: serverPlatform,
          records: load().records.length,
          projects: projects.length,
          projectsWithSources: projects.filter(function (row) { return (row.sources || []).length > 0; }).length,
          dailyTasks: readGoals().dailyTasks,
          backupExists: backupStatus(homeDir()).exists
        })
      });
      return;
    }
  };
  await run();
  return sent;
}
