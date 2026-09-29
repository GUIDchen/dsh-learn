// 流程域（七步闭环）路由：状态 / 简历 / 推荐 / 搜集 / 投递 / 题包 / 建计划。
//
// 与 routes/project.mjs 同一套约定：整域移交，返回值表示「是否已回过响应」。
// 底部三个装载函数只被本域使用，所以一起搬过来（状态与简历都要「进度 + 项目 + 岗位」三份数据）。
import { applicationPack, recommendJobs, renderStudyPlan, studyPlan } from '../../core/flow.mjs';
import { fetchText } from '../../core/ingest.mjs';
import { analyzeJd, jobStats, mergeJob } from '../../core/jobs.mjs';
import { ocrCapabilities, ocrImage, saveDataUrl } from '../../core/ocr.mjs';
import { ingestIntoProject, projectDir, slug, writeProjectFile } from '../../core/project.mjs';
import { SCAFFOLD_FILES, buildScaffold } from '../../core/scaffold.mjs';
import { TASKS } from '../../core/tasks.mjs';
import { summarizeUnderstanding, understandText } from '../../core/understand.mjs';
import { load, readJobs, writeJobs } from '../../store.mjs';
import { flowStatus, summarizeFlow } from '../../core/flow.mjs';
import { listProjects } from '../../core/project.mjs';
import { buildResume } from '../../core/resume.mjs';
import { readNotes } from '../../store.mjs';

export async function handleFlowRoute(c) {
  const { req, res, url, pathname } = c;
  let sent = false;
  const sendJson = function (response, code, payload) { sent = true; return c.sendJson(response, code, payload); };
  const readBody = c.readBody;
  const readLargeBody = c.readLargeBody || c.readBody;
  const run = async function () {
    if (req.method === 'GET' && pathname === '/api/flow') {
      sendJson(res, 200, flowPayload());
      return;
    }

    if (req.method === 'POST' && pathname === '/api/flow') {
      const body = await readLargeBody(req);
      const action = String(body.action || 'status');
      if (action === 'resume') { sendJson(res, 200, resumePayload()); return; }
      if (action === 'recommend') {
        const jobs = readJobs();
        const recommended = recommendJobs(jobs, TASKS, load().records || [], {
            limit: Math.max(1, Math.min(20, Number(body.limit) || 5)),
            location: String(body.location || ''),
            minSalary: Number(body.minSalary) || 0,
            salaryMin: Number(body.salaryMin) || 0,
            salaryMax: Number(body.salaryMax) || 0,
            remoteOnly: Boolean(body.remoteOnly),
            freshFirst: body.freshFirst !== false
        });
        // jobs 与 matches 是同一份结果的两种叫法：core 直接返回数组（matches），接口历史上包成 jobs
        sendJson(res, 200, { ok: true, jobs: recommended, matches: recommended });
        return;
      }
      if (action === 'pack') {
        // 投递材料（与 CLI flow pack 同一份 applicationPack）
        const jobs = readJobs();
        const job = jobs.filter(function (row) { return row.id === String(body.id || ''); })[0];
        if (!job) { sendJson(res, 404, { ok: false, error: '没有这条岗位记录：' + body.id }); return; }
        const pack = applicationPack(job, TASKS, load().records || [], {});
        sendJson(res, 200, Object.assign({ ok: true }, pack));
        return;
      }
      if (action === 'build') {
        // 按岗位要求生成「项目 + 学习计划」：与 CLI flow build 同一份 studyPlan
        const jobs = readJobs();
        const job = jobs.filter(function (row) { return row.id === String(body.id || ''); })[0];
        if (!job) { sendJson(res, 404, { ok: false, error: '没有这条岗位记录：' + body.id }); return; }
        const plan = studyPlan(job, TASKS, load().records || [], {});
        if (String(body.project || '').trim()) plan.projectName = slug(String(body.project).trim());
        if (!plan.mustHave || !plan.mustHave.length) {
          const understood = understandText(String(job.jd || ''), { limit: 20 });
          plan.mustHave = understood.mustHave;
          plan.niceToHave = understood.niceToHave;
        }
        plan.markdown = renderStudyPlan(plan, {});
        const ingested = ingestIntoProject(plan.projectName, {
          kind: 'text',
          source: '岗位 JD：' + job.company + ' · ' + job.position + (job.url ? '（' + job.url + '）' : ''),
          text: String(job.jd || '') || (job.company + ' ' + job.position)
        }, { limit: 20 });
        if (ingested && ingested.ok === false) { sendJson(res, 400, { ok: false, error: ingested.error }); return; }
        writeProjectFile(plan.projectName, 'notes/岗位学习计划.md', plan.markdown, {});
        // 与 CLI flow build 同一份 scaffold：项目书 / 验收清单 / 命令清单
        const scaffold = buildScaffold(job, TASKS, load().records || [], { project: plan.projectName });
        writeProjectFile(plan.projectName, '项目书.md', scaffold.book, {});
        writeProjectFile(plan.projectName, 'checklist.md', scaffold.checklist, {});
        writeProjectFile(plan.projectName, 'notes/命令清单.md', scaffold.commandSheet, {});
        sendJson(res, 200, { ok: true, plan: plan, scaffold: scaffold, files: SCAFFOLD_FILES.concat(['notes/岗位学习计划.md']), project: plan.projectName, dir: projectDir(plan.projectName), index: ingested.index });
        return;
      }
      if (action === 'collect') {
        // 两条路：粘正文 / 传截图（招聘站点反爬时的正路）：与 CLI flow collect --file/--ocr 同一份逻辑
        let text = String(body.text || '').trim();
        const image = String(body.image || '');
        if (!text && image) {
          const saved = saveDataUrl(image);
          if (!saved.ok) { sendJson(res, 400, { ok: false, error: '截图保存失败：' + saved.reason }); return; }
          const shot = await ocrImage(saved.path, {});
          if (!shot.ok) { sendJson(res, 400, { ok: false, error: '识图失败：' + shot.reason, capabilities: ocrCapabilities({}) }); return; }
          text = shot.text;
        }
        const oneUrl = String(body.url || '').trim();
        if (!text && oneUrl) {
          // 按链接抓 JD：登录站点靠 DSH_LEARN_COOKIE / DSH_LEARN_COOKIE_FILE（三端共用，不用各自加输入框）
          const page = await fetchText(oneUrl, { maxBytes: 2 * 1024 * 1024, timeout: 20000 });
          if (!page.ok) { sendJson(res, 502, { ok: false, error: '抓取失败：' + page.reason, hint: '招聘站点多半要登录：设 DSH_LEARN_COOKIE 或改用截图 / 粘正文' }); return; }
          text = page.text;
        }
        if (!text) { sendJson(res, 400, { ok: false, error: '要给 text（JD 正文）或 image（截图）或 url（链接）；批量搜请用搜索面板' }); return; }
        const understood = understandText(text, { limit: 20 });
        const merged = mergeJob(readJobs(), {
          company: understood.company || '未知公司',
          position: understood.position || '未标注岗位',
          url: String(body.url || ''),
          status: 'todo',
          jd: text.slice(0, 20000),
          note: '界面粘贴（识别为 ' + understood.kind + '）'
        }, {});
        if (!merged.ok) { sendJson(res, 400, { ok: false, error: merged.errors.join('；'), errors: merged.errors }); return; }
        const withAnalysis = mergeJob(merged.jobs, Object.assign({}, merged.job, { analysis: analyzeJd(merged.job.jd) }), {});
        const next = writeJobs(withAnalysis.jobs);
        sendJson(res, 200, { ok: true, job: withAnalysis.job, understood: understood, summary: summarizeUnderstanding(understood), stats: jobStats(next) });
        return;
      }
      if (action === 'apply') {
        const jobs = readJobs();
        const job = jobs.filter(function (row) { return row.id === String(body.id || ''); })[0];
        if (!job) { sendJson(res, 404, { ok: false, error: '没有这条岗位记录：' + body.id }); return; }
        const merged = mergeJob(jobs, Object.assign({}, job, { status: job.status === 'todo' ? 'applied' : job.status }), {});
        if (!merged.ok) { sendJson(res, 400, { ok: false, error: merged.errors.join('；') }); return; }
        writeJobs(merged.jobs);
        sendJson(res, 200, { ok: true, job: merged.job, highlights: resumePayload().highlights });
        return;
      }
      sendJson(res, 400, { ok: false, error: '不认识的 action：' + action + '（status / resume / recommend / collect / apply）' });
      return;
    }

    // 多岗位调研：把多份岗位要求聚合成"市场需要什么 + 我们缺什么"（CLI survey 用同一份 core/survey.mjs）
  };
  await run();
  return sent;
}

function projectRowsForFlow() {
  return listProjects({}).map(function (row) {
    return {
      name: row.name,
      sources: (row.sources || []).length,
      knowledge: (row.sources || []).reduce(function (sum, item) { return sum + (item.knowledge || 0); }, 0),
      tasks: (row.sources || []).reduce(function (sum, item) { return sum + (item.tasks || 0); }, 0)
    };
  });
}

function resumePayload() {
  const all = readNotes();
  const notes = Object.keys(all).map(function (id) { return { taskId: id, text: String((all[id] || {}).text || '').slice(0, 80) }; });
  return buildResume(load().records || [], TASKS, { projects: projectRowsForFlow(), notes: notes });
}

function flowPayload() {
  const records = load().records || [];
  const projects = projectRowsForFlow();
  const jobs = readJobs();
  const resume = resumePayload();
  const status = flowStatus({ records: records, tasks: TASKS, projects: projects, jobs: jobs, resume: resume });
  status.summary = summarizeFlow(status);
  return status;
}

