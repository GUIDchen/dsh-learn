// Web API：所有 /api/* 的实现在这里，HTTP 外壳只负责解析与分发。
//
// 结构：一张**保序路由表**。域移交（整域一个模块）在前，小路由（api-routes.mjs）在后，
// 顺序与改造前逐条一致——顺序有意义，例如 /api/analyze 由投递域处理、/api/flow 先于其它。

import { handleProjectRoute } from './routes/project.mjs';
import { handleJobsRoute } from './routes/jobs.mjs';
import { handleFlowRoute } from './routes/flow.mjs';
import { handleResearchRoute } from './routes/research.mjs';
import { handleLearnRoute } from './routes/learn.mjs';
import { handleOpsRoute } from './routes/ops.mjs';
import { corpusRoute, ctxOf, doctorRoute, draftRoute, goalRoute, knowledgeRoute, masteryRoute, noteRoute, packRoute, probeRoute, reviewRoute } from './api-routes.mjs';

const OPS_PATHS = ['/api/storage', '/api/backup', '/api/metrics', '/api/onboarding', '/api/commands', '/api/prefs', '/api/i18n', '/api/scorecard', '/api/reminder'];
const LEARN_PATHS = ['/api/bootstrap', '/api/drill', '/api/history', '/api/board', '/api/progress', '/api/daily', '/api/report', '/api/plan', '/api/import', '/api/export', '/api/check', '/api/verify', '/api/runners'];
const RESEARCH_PATHS = ['/api/survey', '/api/describe', '/api/ocr', '/api/understand', '/api/search', '/api/research'];

// 保序：域移交条目用 paths（列表），小路由条目用 method + path（method 省略表示任意方法）
const ROUTES = [
  { paths: OPS_PATHS, handler: handleOpsRoute },
  { paths: LEARN_PATHS, handler: handleLearnRoute },
  { method: 'GET', path: '/api/review', handler: reviewRoute },
  { path: '/api/goal', handler: goalRoute },
  { path: '/api/note', handler: noteRoute },
  { paths: ['/api/flow'], handler: handleFlowRoute },
  { paths: RESEARCH_PATHS, handler: handleResearchRoute },
  { paths: ['/api/jobs', '/api/analyze'], handler: handleJobsRoute },
  { method: 'GET', path: '/api/knowledge', handler: knowledgeRoute },
  { path: '/api/doctor', handler: doctorRoute },
  { method: 'POST', path: '/api/pack', handler: packRoute },
  { method: 'GET', path: '/api/mastery', handler: masteryRoute },
  { method: 'GET', path: '/api/corpus', handler: corpusRoute },
  { paths: ['/api/project'], handler: handleProjectRoute },
  { path: '/api/draft', handler: draftRoute },
  { method: 'POST', path: '/api/probe', handler: probeRoute }
];

export async function handleApi(c) {
  const { req, pathname } = c;
  const ctx = ctxOf(c);   // 需要收图片的路由用 readLargeBody（8MB），其余仍走 64KB 小请求体
  for (const route of ROUTES) {
    if (route.paths) {
      if (route.paths.indexOf(pathname) === -1) continue;
    } else {
      if (route.path !== pathname) continue;
      if (route.method && route.method !== req.method) continue;
    }
    await route.handler(c);
    return true;
  }
  return false;
}
