// 调研 / 理解域路由：多岗位调研（survey）、描述提取（describe）、识图（ocr）、
// 文字理解（understand）、搜索（search）、搜+抓+解析（research）。
//
// 与其它 routes 同一套约定：整域移交，返回值表示「是否已回过响应」。
import { describeExtraction } from '../../core/describe.mjs';
import { fetchText } from '../../core/ingest.mjs';
import { PASS_SCORE } from '../../core/judge.mjs';
import { ocrCapabilities, ocrImage, saveDataUrl } from '../../core/ocr.mjs';
import { taskStats } from '../../core/progress.mjs';
import { ingestIntoProject, loadProjectTasks } from '../../core/project.mjs';
import { research as researchWeb, searchWeb } from '../../core/search.mjs';
import { surveyGroups, surveyJds } from '../../core/survey.mjs';
import { TASKS } from '../../core/tasks.mjs';
import { summarizeUnderstanding, understandText } from '../../core/understand.mjs';
import { load } from '../../store.mjs';

export async function handleResearchRoute(c) {
  const { req, res, url, pathname } = c;
  let sent = false;
  const sendJson = function (response, code, payload) { sent = true; return c.sendJson(response, code, payload); };
  const readBody = c.readBody;
  const readLargeBody = c.readLargeBody || c.readBody;
  const run = async function () {
    if (req.method === 'POST' && pathname === '/api/survey') {
      const body = await readLargeBody(req);
      // 两种输入：texts（一锅端）或 groups（按方向/分类分别画像）
      const groups = Array.isArray(body.groups) ? body.groups.filter(function (row) { return row && Array.isArray(row.texts) && row.texts.length; }) : [];
      if (groups.length) {
        const shaped = groups.map(function (row) {
          return {
            name: String(row.name || '方向').trim() || '方向',
            items: row.texts.map(String).filter(function (t) { return t.trim(); }).map(function (text, index) {
              return { name: String(row.name || '方向') + ' #' + (index + 1), source: '界面粘贴', text: text };
            })
          };
        });
        const grouped = surveyGroups(shaped, { tasks: TASKS });
        sendJson(res, 200, { ok: true, markdown: grouped.markdown, stats: grouped.stats, matrix: grouped.matrix, groups: grouped.groups.map(function (row) { return { name: row.name, jobs: row.survey.jobs }; }) });
        return;
      }
      const texts = Array.isArray(body.texts) ? body.texts.map(String).filter(function (row) { return row.trim(); }) : [];
      if (!texts.length) { sendJson(res, 400, { ok: false, error: '要给 texts（多份岗位文本）或 groups（按方向的 {name, texts} 数组）' }); return; }
      const survey = surveyJds(texts.map(function (text, index) { return { name: '岗位 ' + (index + 1), source: '界面粘贴', text: text }; }), { tasks: TASKS });
      sendJson(res, 200, { ok: true, survey: survey, markdown: survey.markdown, stats: survey.stats });
      return;
    }

    // 描述与提取：把岗位要求/文档/截图/链接"描述清楚"，再抽全技术栈与知识点（CLI describe 用同一份 core/describe.mjs）
    if (req.method === 'POST' && pathname === '/api/describe') {
      const body = await readLargeBody(req);
      let text = String(body.text || '');
      let source = '文本';
      if (!text && String(body.image || '')) {
        const saved = saveDataUrl(String(body.image));
        if (!saved.ok) { sendJson(res, 400, { ok: false, error: '截图保存失败：' + saved.reason }); return; }
        const shot = await ocrImage(saved.path, {});
        if (!shot.ok) { sendJson(res, 400, { ok: false, error: '识图失败：' + shot.reason, capabilities: ocrCapabilities({}) }); return; }
        text = shot.text;
        source = '截图（本机 OCR）';
      }
      if (!text && String(body.url || '')) {
        const page = await fetchText(String(body.url), { maxBytes: 2 * 1024 * 1024, timeout: 20000 });
        if (!page.ok) { sendJson(res, 502, { ok: false, error: '抓取失败：' + page.reason, hint: '招聘站点多半要登录：设 DSH_LEARN_COOKIE 或改用截图 / 粘正文' }); return; }
        text = page.text;
        source = '链接 ' + body.url;
      }
      if (!String(text).trim()) { sendJson(res, 400, { ok: false, error: '要给 text / image / url 三者之一' }); return; }
      const stats = taskStats(load().records || [], TASKS);
      const passedIds = new Set(stats.known.filter(function (row) { return row.best >= PASS_SCORE; }).map(function (row) { return row.taskId; }));
      const description = describeExtraction(text, { source: source, tasks: TASKS, passedIds: passedIds });
      sendJson(res, 200, { ok: true, description: description, markdown: description.markdown, stats: description.report.stats });
      return;
    }

    // 识图能力矩阵：界面上的「这台机器能不能识图」就是它（三端同一份）
    if (req.method === 'GET' && pathname === '/api/ocr') {
      sendJson(res, 200, ocrCapabilities({}));
      return;
    }

    // 识图：POST { image: dataUrl } → 文字；POST { text } → 结构化理解（两者都能直接给 /api/understand）。
    // 合在一起是为了让"截图 → 文字 → 结构化"这条链在界面上一次点击走完。
    if (req.method === 'POST' && pathname === '/api/understand') {
      const body = await readLargeBody(req);
      let text = String(body.text || '');
      let via = 'text';
      if (!text.trim() && typeof body.image === 'string' && body.image.trim()) {
        const saved = saveDataUrl(body.image);
        if (!saved.ok) { sendJson(res, 400, { ok: false, error: '截图保存失败：' + saved.reason }); return; }
        const done = await ocrImage(saved.path, {});
        if (!done.ok) { sendJson(res, 400, { ok: false, error: '识图失败：' + done.reason, capabilities: ocrCapabilities({}) }); return; }
        text = done.text;
        via = 'image';
      }
      if (!text.trim()) { sendJson(res, 400, { ok: false, error: '要给出 text 或 image' }); return; }
      const understood = understandText(text, { limit: Math.max(1, Math.min(60, Number(body.limit) || 20)) });
      sendJson(res, 200, Object.assign({ ok: true, via: via, summary: summarizeUnderstanding(understood), textLength: text.length }, understood));
      return;
    }

    // 搜索与资料收集：先搜（多引擎依次回退），再把命中页面解析成知识点与草案题。
    // 口径在 core/search.mjs（CLI 的 search/research 用同一份），这里只是转成 HTTP。
    if (req.method === 'POST' && pathname === '/api/search') {
      const body = await readBody(req);
      const query = String(body.query || '').trim();
      if (!query) { sendJson(res, 400, { ok: false, error: '缺少搜索词 query' }); return; }
      const result = await searchWeb(query, { engine: body.engine, limit: Math.max(1, Math.min(20, Number(body.limit) || 8)) });
      // 失败时同时给 error 字段：网页版与原生端读的就是 error（与 /api/jobs 一致）
      sendJson(res, result.ok ? 200 : 502, result.ok ? result : Object.assign({}, result, { error: result.reason }));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/research') {
      const body = await readBody(req);
      const query = String(body.query || '').trim();
      if (!query) { sendJson(res, 400, { ok: false, error: '缺少搜索词 query' }); return; }
      const project = String(body.project || '').trim();
      const result = await researchWeb(query, {
        engine: body.engine,
        limit: Math.max(1, Math.min(20, Number(body.limit) || 5)),
        keepText: Boolean(project)
      });
      if (result.ok && project) {
        // 收进项目：与 CLI 同一份 ingestIntoProject（笔记 + 草案 + 索引一起刷新）
        const artifacts = [];
        let ingested = 0;
        result.results.forEach(function (row) {
          if (!row.ok || !row.text) return;
          const one = ingestIntoProject(project, { kind: 'link', source: row.url, text: row.text }, { limit: 20 });
          if (one && one.ok !== false) {
            ingested += 1;
            (one.artifacts || []).forEach(function (file) { artifacts.push(file); });
          }
        });
        result.project = project;
        result.ingested = ingested;
        result.artifacts = artifacts;
        result.index = loadProjectTasks(project);
        // 原文不入回执：几 MB 的页面塞进 JSON 会把界面拖死
        result.results.forEach(function (row) { delete row.text; });
      }
      result.results.forEach(function (row) { delete row.text; });
      // 失败时同时给 error 字段：网页版与原生端读的就是 error（与 /api/jobs 一致）
      sendJson(res, result.ok ? 200 : 502, result.ok ? result : Object.assign({}, result, { error: result.reason }));
      return;
    }

    // 简历投递：列表 / 增改删 / 分析 JD。口径都在 core/jobs.mjs，网页版只是转成 HTTP。
    // 投递域（GET/POST /api/jobs、POST /api/analyze）已拆到 routes/jobs.mjs
  };
  await run();
  return sent;
}
