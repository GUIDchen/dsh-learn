// 投递域路由：求职记录（jobs）的增改删查 + JD 分析（analyze）。
//
// 与 routes/project.mjs 同一套约定：调用方按 pathname 整域移交，返回值表示「是否已回过响应」。
import { fetchText } from '../../core/ingest.mjs';
import { JOB_STATUSES, JOB_STATUS_LABELS, analyzeJd, jobFollowUps, jobStats, listJobs, mergeJob, removeJob } from '../../core/jobs.mjs';
import { MODULES, analyzeText, summarizeAnalysis } from '../../core/knowledge.mjs';
import { ocrImage, saveDataUrl } from '../../core/ocr.mjs';
import { deleteJobRecord, jobsPath, readJobs, writeJobs } from '../../store.mjs';

export async function handleJobsRoute(c) {
  const { req, res, url, pathname } = c;
  let sent = false;
  const sendJson = function (response, code, payload) { sent = true; return c.sendJson(response, code, payload); };
  const readBody = c.readBody;
  // /api/analyze 会收 base64 截图，必须用 8MB 上限的那个读取器（与 api.mjs 里 readLargeBody 的语义一致）
  const readLargeBody = c.readLargeBody || c.readBody;
  const run = async function () {
    if (pathname === '/api/jobs' && req.method === 'GET') {
      const jobs = readJobs();
      const follow = jobFollowUps(jobs, { staleDays: Number(url.searchParams.get('staleDays')) || 5 });
      sendJson(res, 200, {
        jobs: listJobs(jobs, { status: url.searchParams.get('status') || 'all', query: url.searchParams.get('q') || '' }),
        stats: jobStats(jobs),
        statuses: JOB_STATUSES.map(function (key) { return { id: key, label: JOB_STATUS_LABELS[key] }; }),
        // 跟进视图与列表一起给：界面一次请求就能渲染"待跟进"徽标与时间线
        follow: { now: follow.now, staleDays: follow.staleDays, waiting: follow.waiting.length, followUps: follow.followUps, rows: follow.rows },
        path: jobsPath()
      });
      return;
    }

    if (pathname === '/api/jobs' && req.method === 'POST') {
      const body = await readBody(req);
      const action = String(body.action || 'save');
      const jobs = readJobs();
      if (action === 'delete') {
        const removed = removeJob(jobs, String(body.id || ''));
        if (!removed.removed) { sendJson(res, 404, { ok: false, error: '没有这条记录：' + body.id }); return; }
        // 删除必须走显式操作：writeJobs 现在是"只增改"，用"写一份不含它的数组"表达删除会丢并发记录
        const next = deleteJobRecord(String(body.id || ''));
        sendJson(res, 200, { ok: true, deleted: true, jobs: listJobs(next, {}), stats: jobStats(next) });
        return;
      }
      if (action === 'analyze') {
        // 分析 JD：把"涉及哪些知识点、能练哪些题"存回记录，列表上就能直接显示
        const row = jobs.filter(function (job) { return job.id === String(body.id || ''); })[0];
        if (!row) { sendJson(res, 404, { ok: false, error: '没有这条记录：' + body.id }); return; }
        if (!String(row.jd || '').trim()) { sendJson(res, 400, { ok: false, error: '这条记录没存 JD：先把岗位描述粘进"JD"里再分析' }); return; }
        const analysis = analyzeJd(row.jd, { limit: 20 });
        const merged = mergeJob(jobs, Object.assign({}, row, { analysis: analysis }), {});
        if (!merged.ok) { sendJson(res, 400, { ok: false, error: merged.errors.join("；"), errors: merged.errors }); return; }
        const next = writeJobs(merged.jobs);
        sendJson(res, 200, { ok: true, job: merged.job, analysis: analysis, jobs: listJobs(next, {}), stats: jobStats(next) });
        return;
      }
      const merged = mergeJob(jobs, body.job || body, {});
      if (!merged.ok) { sendJson(res, 400, { ok: false, error: merged.errors.join("；"), errors: merged.errors }); return; }
      const next = writeJobs(merged.jobs);
      sendJson(res, 200, { ok: true, job: merged.job, created: merged.created, jobs: listJobs(next, {}), stats: jobStats(next) });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/analyze') {
      // 截图走 base64，用更大的上限；文本/链接请求仍然很小
      const body = await readLargeBody(req);
      const limit = Math.max(1, Math.min(50, Number(body.limit) || 20));
      let text = '';
      let source = 'text';
      let note = '';

      if (typeof body.text === 'string' && body.text.trim()) {
        text = body.text;
      } else if (typeof body.url === 'string' && body.url.trim()) {
        const fetched = await fetchText(body.url, { cookie: typeof body.cookie === 'string' ? body.cookie : undefined });
        if (!fetched.ok) {
          sendJson(res, 200, { ok: false, source: 'url', reason: fetched.reason });
          return;
        }
        text = fetched.text;
        source = 'url';
        note = '已抓取网页正文并去掉标签。';
      } else if (typeof body.image === 'string' && body.image.trim()) {
        const saved = saveDataUrl(body.image);
        if (!saved.ok) {
          sendJson(res, 200, { ok: false, source: 'image', reason: saved.reason });
          return;
        }
        const done = ocrImage(saved.path);
        if (!done.ok) {
          sendJson(res, 200, { ok: false, source: 'image', reason: done.reason });
          return;
        }
        text = done.text;
        source = 'ocr';
        note = '截图已用系统 OCR 在本机识别（' + done.lines + ' 行文字），没有上传到任何服务器。';
      } else {
        sendJson(res, 400, { error: '请提供 text / url / image 之一' });
        return;
      }

      const report = analyzeText(text, { limit: limit });
      sendJson(res, 200, {
        ok: true,
        source: source,
        note: note,
        summaryText: summarizeAnalysis(report),
        textPreview: text.slice(0, 1200),
        report: report,
        modules: MODULES
      });
      return;
    }

    // 知识点字典本身（离线可查：页面里可以列出"还没题的"知识点）
  };
  await run();
  return sent;
}
