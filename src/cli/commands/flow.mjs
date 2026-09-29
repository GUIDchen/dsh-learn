// flow：把七步闭环串起来。每一步都从真实数据推状态，命令只负责执行"下一步"。
//   status    现在在哪一步、每步进度
//   resume    按练习记录生成简历要点（只写真实做过的事）
//   collect   自动搜集招聘信息（搜索 → 抓取 → 结构化理解 → 入投递记录）
//   recommend 按匹配度推荐岗位（并给出"差的题"清单）
//   apply     按岗位链接投递：记状态 + 打印可粘贴的要点
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { CliError } from '../context.mjs';
import { applicationPack, flowStatus, matchJobs, recommendJobs, studyPlan, summarizeFlow, renderStudyPlan as require_renderPlan } from '../../core/flow.mjs';
import { ocrImage } from '../../core/ocr.mjs';
import { ingestIntoProject, projectDir, writeProjectFile } from '../../core/project.mjs';
import { buildScaffold, SCAFFOLD_FILES } from '../../core/scaffold.mjs';
import { buildResume } from '../../core/resume.mjs';
import { TASKS } from '../../core/tasks.mjs';
import { understandText, summarizeUnderstanding } from '../../core/understand.mjs';
import { searchWeb } from '../../core/search.mjs';
import { fetchText } from '../../core/ingest.mjs';
import { analyzeJd, jobStats, listJobs, mergeJob } from '../../core/jobs.mjs';
import { listProjects } from '../../core/project.mjs';
import { load, readNotes, readJobs, writeJobs } from '../../store.mjs';

function records() {
  const data = load();
  return data.records || [];
}

function projects() {
  return listProjects({}).map(function (row) {
    return {
      name: row.name,
      sources: (row.sources || []).length,
      knowledge: (row.sources || []).reduce(function (sum, item) { return sum + (item.knowledge || 0); }, 0),
      tasks: (row.sources || []).reduce(function (sum, item) { return sum + (item.tasks || 0); }, 0)
    };
  });
}

function notes() {
  const all = readNotes();
  return Object.keys(all).map(function (id) { return { taskId: id, text: String((all[id] || {}).text || '').slice(0, 80) }; });
}

function resumeFor() {
  return buildResume(records(), TASKS, { projects: projects(), notes: notes() });
}

function printStageRow(row) {
  const mark = row.status === 'done' ? '✓' : (row.status === 'doing' ? '…' : '·');
  console.log('  ' + mark + ' ' + row.name + '（' + row.status + '）：' + row.progress);
  if (row.status !== 'done') console.log('      → ' + row.action.label + '：' + row.action.cli);
}

export async function flow(ctx) {
  const { args, asJson, out } = ctx;
  const sub = String(args._[1] || 'status');

  if (sub === 'status' || sub === 'next') {
    const resume = resumeFor();
    const status = flowStatus({ records: records(), tasks: TASKS, projects: projects(), jobs: readJobs(), resume: resume });
    if (asJson) { out(status); return 0; }
    console.log(summarizeFlow(status));
    console.log('');
    status.stages.forEach(printStageRow);
    console.log('');
    console.log('下一步：' + status.nextAction.label + '　' + status.nextAction.cli);
    return 0;
  }

  if (sub === 'resume') {
    const resume = resumeFor();
    if (asJson) { out(resume); return 0; }
    if (typeof args.out === 'string' && args.out.trim()) {
      writeFileSync(args.out, resume.markdown);
      console.log('已写入 ' + args.out + '（' + resume.markdown.length + ' 字）');
      console.log('摘要：' + resume.headline);
      return 0;
    }
    if (args.md) { console.log(resume.markdown); return 0; }
    console.log(resume.headline);
    console.log('亮点：');
    resume.highlights.forEach(function (row) { console.log('  - ' + row.text + '——' + row.evidence); });
    if (resume.skills.length) {
      console.log('技能：' + resume.skills.slice(0, 6).map(function (row) { return row.track + ' ' + row.level + '(' + row.percent + '%)'; }).join('、'));
    }
    console.log('');
    console.log('写文件：flow resume --out=resume.md　看全文：flow resume --md');
    return 0;
  }

  if (sub === 'collect') {
    // 自动搜集招聘信息：搜索 → 抓取 → 结构化理解 → 存进投递记录（按链接去重）
    // 两条路：批量搜（--query）与粘正文（--file / --text）。
    // BOSS 这类站点抓不到正文，粘正文是正路——这条路径与搜索入的是同一份记录。
    const filePath = typeof args.file === 'string' ? args.file.trim() : '';
    const ocrPath = typeof args.ocr === 'string' ? args.ocr.trim() : '';
    const inlineText = typeof args.text === 'string' ? args.text.trim() : '';
    const oneUrl = typeof args.url === 'string' ? args.url.trim() : '';
    if (filePath || inlineText || ocrPath || oneUrl) {
      let body = inlineText;
      let viaLabel = '手动粘贴';
      if (filePath) {
        try { body = readFileSync(filePath, 'utf8'); } catch (err) { throw new CliError('读 JD 文件失败：' + err.message, 3); }
        viaLabel = '文件：' + filePath;
      }
      if (ocrPath) {
        // 截图 → 识图 → 入库：招聘站点反爬时的另一条正路（与 understand --ocr 同一份 OCR）
        const shot = ocrImage(ocrPath, {});
        if (!shot.ok) { console.error('识图失败：' + shot.reason + '（先看 node src/cli.mjs ocr --capabilities）'); return 3; }
        body = shot.text;
        viaLabel = '截图识图：' + ocrPath;
      }
      if (oneUrl && !body) {
        // 按链接抓 JD：登录站点（BOSS/拉勾）需要 Cookie——环境变量 DSH_LEARN_COOKIE / DSH_LEARN_COOKIE_FILE
        const page = await fetchText(oneUrl, { maxBytes: 2 * 1024 * 1024, timeout: 20000 });
        if (!page.ok) {
          console.error('抓取失败：' + page.reason);
          console.error('招聘站点多半要登录：export DSH_LEARN_COOKIE=\'从开发者工具复制的 Cookie\' 再试；或改用截图（--ocr）与粘正文（--file）。');
          return 3;
        }
        body = page.text;
        viaLabel = '链接抓取：' + oneUrl + (page.withCookie ? '（带 Cookie）' : '');
      }
      const understood = understandText(body, { limit: 20 });
      const merged = mergeJob(readJobs(), {
        company: understood.company || '未知公司',
        position: understood.position || '未标注岗位',
        url: oneUrl,
        status: 'todo',
        jd: body.slice(0, 20000),
        note: viaLabel + '（识别为 ' + understood.kind + '）'
      }, {});
      if (!merged.ok) { merged.errors.forEach(function (msg) { console.error('错误：' + msg); }); return 2; }
      const withAnalysis = mergeJob(merged.jobs, Object.assign({}, merged.job, { analysis: analyzeJd(merged.job.jd) }), {});
      writeJobs(withAnalysis.jobs);
      if (asJson) { out({ job: withAnalysis.job, understood: understood, stats: jobStats(readJobs()) }); return 0; }
      console.log('已入库：' + merged.job.company + ' · ' + merged.job.position + '　（' + summarizeUnderstanding(understood) + '）');
      console.log('岗位记录 id：' + merged.job.id);
      if (understood.kind !== 'jd') {
        // 明确按链接/文件存进来的，不替用户丢；但要提醒它不是岗位描述（批量搜那一路是直接跳过）
        console.log('提醒：这段内容识别为「' + understood.kind + '」，不是岗位描述。确实想留就留着，不想要：node src/cli.mjs jobs delete ' + merged.job.id);
      }
      return 0;
    }
    const query = (typeof args.query === 'string' && args.query.trim()) || args._.slice(2).join(' ').trim();
    if (!query) throw new CliError('用法：node src/cli.mjs flow collect --query="运维 招聘" | --file jd.txt | --text 「JD 正文」 [--limit=5] [--engine=…]');
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
    const found = await searchWeb(query, { engine: args.engine, limit: limit });
    if (!found.ok) { console.error('搜索失败：' + found.reason); return 3; }
    const existing = readJobs();
    const seen = new Set(existing.map(function (job) { return job.url; }));
    let saved = 0;
    let skipped = 0;
    const rows = [];
    for (const hit of found.results) {
      if (seen.has(hit.url)) { skipped += 1; continue; }
      const page = await fetchText(hit.url, { maxBytes: 2 * 1024 * 1024, timeout: 20000 });
      if (!page.ok) { rows.push({ url: hit.url, ok: false, reason: page.reason }); continue; }
      const understood = understandText(page.text, { limit: 20 });
      // 搜出来的很多是文档页而不是岗位描述：不是 JD 就跳过（除非 --all），
      // 否则投递记录里会混进一堆技术文档，推荐的匹配度也没意义。
      if (understood.kind !== 'jd' && !args.all) {
        rows.push({ url: hit.url, ok: false, reason: '不是岗位描述（识别为「' + understood.kind + '」）：跳过；确实是 JD 就用 jobs add 粘正文' });
        continue;
      }
      const merged = mergeJob(readJobs(), {
        company: understood.company || (hit.title || '').slice(0, 30) || '未知公司',
        position: understood.position || (understood.title || '').slice(0, 40) || '未标注岗位',
        url: hit.url,
        status: 'todo',
        jd: page.text.slice(0, 20000),
        note: '自动搜集（' + found.engine + '）：' + (understood.stack || []).slice(0, 5).join('/')
      }, {});
      if (!merged.ok) { rows.push({ url: hit.url, ok: false, reason: merged.errors.join('；') }); continue; }
      const withAnalysis = mergeJob(merged.jobs, Object.assign({}, merged.job, { analysis: analyzeJd(merged.job.jd) }), {});
      writeJobs(withAnalysis.jobs);
      seen.add(hit.url);
      saved += 1;
      rows.push({ url: hit.url, ok: true, company: merged.job.company, position: merged.job.position, must: understood.mustHave.length, tasks: (withAnalysis.job.analysis || {}).tasks ? withAnalysis.job.analysis.tasks.length : 0 });
    }
    if (asJson) { out({ query: query, engine: found.engine, saved: saved, skipped: skipped, rows: rows, stats: jobStats(readJobs()) }); return 0; }
    console.log('搜集：' + query + '（引擎 ' + found.engine + '，搜到 ' + found.total + ' 条）');
    rows.forEach(function (row) {
      console.log(row.ok
        ? ('  ✓ 入库 ' + row.company + ' · ' + row.position + '　硬要求 ' + row.must + ' 条 / 可练题 ' + row.tasks + ' 道　' + row.url)
        : ('  ✗ ' + row.url + '：' + row.reason));
    });
    console.log('新增 ' + saved + ' 条，跳过重复 ' + skipped + ' 条');
    if (!saved) {
      // 实测：搜到的多半是文档页，招聘站点又普遍反爬。别让用户以为"什么都没发生"。
      console.log('');
      console.log('没有入库：搜到的都不是岗位描述，或站点抓不到正文（BOSS/拉勾/知乎都反爬）。三条可行路径：');
      console.log('  ① 把 JD 正文粘进来：node src/cli.mjs flow collect --file jd.txt');
      console.log('  ② 截图识别：node src/cli.mjs understand --ocr jd截图.png（先 ocr --capabilities 看能不能识图）');
      console.log('  ③ 用能抓的站点（公司官网 / 招聘聚合页）直接 --file 下载下来的正文');
    }
    console.log('');
    console.log('下一步：node src/cli.mjs flow recommend --limit=5（按匹配度挑岗位）');
    return 0;
  }

  if (sub === 'recommend') {
    const rows = recommendJobs(readJobs(), TASKS, records(), { limit: Number(args.limit) || 5, threshold: Number(args.threshold) || 0 });
    if (asJson) { out({ jobs: rows }); return 0; }
    if (!rows.length) {
      console.log('还没有可比对的岗位：先跑 node src/cli.mjs flow collect --query="运维 招聘"');
      return 0;
    }
    console.log('按匹配度（这道 JD 的可练题里已通过多少）排序：');
    rows.forEach(function (row) {
      console.log('  ' + String(row.match) + '%　' + row.company + ' · ' + row.position + '　（' + row.covered + '/' + row.total + ' 题）');
      row.why.forEach(function (line) { console.log('      · ' + line); });
      if (row.gapTracks.length) console.log('      要补的方向：' + row.gapTracks.join('、') + '　下一步：node src/cli.mjs drill --tasks=' + row.missing.slice(0, 8).join(','));
    });
    return 0;
  }

  if (sub === 'pack') {
    // 投递材料：逐条对硬要求 + 可粘贴要点 + 差异自陈（都来自练习记录）
    const id = String(args._[2] || '').trim();
    if (!id) throw new CliError('用法：node src/cli.mjs flow pack <岗位记录 id> [--out=投递材料.md] [--json]');
    const job = readJobs().filter(function (row) { return row.id === id; })[0];
    if (!job) throw new CliError('没有这条岗位记录：' + id + '（用 jobs list 看 id）', 3);
    const pack = applicationPack(job, TASKS, records(), {});
    if (asJson) { out(pack); return 0; }
    if (typeof args.out === 'string' && args.out.trim()) {
      writeFileSync(args.out, pack.markdown);
      console.log('已写入 ' + args.out + '（' + pack.markdown.length + ' 字）');
      console.log('匹配度 ' + pack.match + '%　硬要求 ' + pack.mustRows.length + ' 条（已覆盖 ' + pack.mustRows.filter(function (row) { return row.status === '已覆盖'; }).length + '）');
      return 0;
    }
    console.log(pack.markdown);
    return 0;
  }

  if (sub === 'build') {
    // 按岗位要求生成"项目 + 学习计划"：项目里存 JD 与知识点索引，计划文件写清要补什么、先练哪些题
    const id = String(args._[2] || '').trim();
    if (!id) throw new CliError('用法：node src/cli.mjs flow build <岗位记录 id> [--project=名字] [--json]');
    const job = readJobs().filter(function (row) { return row.id === id; })[0];
    if (!job) throw new CliError('没有这条岗位记录：' + id + '（用 jobs list 看 id）', 3);
    const plan = studyPlan(job, TASKS, records(), {});
    if (typeof args.project === 'string' && args.project.trim()) plan.projectName = args.project.trim();
    plan.mustHave = ((job.analysis && job.analysis.mustHave) || []);
    // 硬要求/加分项存在岗位记录里吗？没有就现读 JD 理解一遍（保证计划文件里有"要求 → 知识点"这条链）
    if (!plan.mustHave.length && String(job.jd || '').trim()) {
      const understood = understandText(job.jd, { limit: 20 });
      plan.mustHave = understood.mustHave;
      plan.niceToHave = understood.niceToHave;
    }
    plan.markdown = require_renderPlan(plan);
    const ingested = ingestIntoProject(plan.projectName, {
      kind: 'text',
      source: '岗位 JD：' + job.company + ' · ' + job.position + (job.url ? '（' + job.url + '）' : ''),
      text: String(job.jd || '') || (job.company + ' ' + job.position)
    }, { limit: 20 });
    if (ingested && ingested.ok === false) { console.error('建项目失败：' + ingested.error); return 3; }
    writeProjectFile(plan.projectName, 'notes/岗位学习计划.md', plan.markdown, {});
    // 可交付的项目书 / 验收清单 / 命令清单：把"按岗位要求生成项目"落成项目目录里真能照着做的文件
    const scaffold = buildScaffold(job, TASKS, records(), { project: plan.projectName });
    writeProjectFile(plan.projectName, '项目书.md', scaffold.book, {});
    writeProjectFile(plan.projectName, 'checklist.md', scaffold.checklist, {});
    writeProjectFile(plan.projectName, 'notes/命令清单.md', scaffold.commandSheet, {});
    if (asJson) { out({ plan: plan, scaffold: scaffold, files: SCAFFOLD_FILES.concat(['notes/岗位学习计划.md']), project: plan.projectName, dir: projectDir(plan.projectName, {}), index: ingested.index }); return 0; }
    console.log('已建项目：' + plan.projectName + '　目录：' + projectDir(plan.projectName, {}));
    console.log('学习计划：notes/岗位学习计划.md（' + plan.markdown.length + ' 字）');
    console.log('项目书：项目书.md（' + scaffold.deliverables.length + ' 条硬要求 → 交付标准、' + scaffold.commands.length + ' 条命令）');
    console.log('验收清单：checklist.md（' + (scaffold.deliverables.length * 4 + scaffold.milestones.length + 2) + ' 项可勾选）　命令清单：notes/命令清单.md');
    console.log('匹配度 ' + plan.match + '%　待练 ' + plan.missingTasks.length + ' 道　方向：' + (plan.tracks.join('、') || '-'));
    if (plan.missingTasks.length) console.log('开练：node src/cli.mjs drill --tasks=' + plan.missingTasks.slice(0, 12).join(',') + (plan.missingTasks.length > 12 ? '…' : ''));
    console.log('看项目索引：node src/cli.mjs project show ' + plan.projectName);
    return 0;
  }

  if (sub === 'apply') {
    const id = String(args._[2] || '').trim();
    if (!id) throw new CliError('用法：node src/cli.mjs flow apply <岗位记录 id> [--open]');
    const jobs = readJobs();
    const job = jobs.filter(function (row) { return row.id === id; })[0];
    if (!job) throw new CliError('没有这条岗位记录：' + id + '（用 node src/cli.mjs jobs list 看 id）', 3);
    const merged = mergeJob(jobs, Object.assign({}, job, { status: job.status === 'todo' ? 'applied' : job.status }), {});
    if (!merged.ok) { merged.errors.forEach(function (msg) { console.error('错误：' + msg); }); return 2; }
    writeJobs(merged.jobs);
    const resume = resumeFor();
    if (asJson) { out({ job: merged.job, resume: resume }); return 0; }
    console.log('已记投递：' + merged.job.company + ' · ' + merged.job.position + '　状态 ' + merged.job.status
      + (merged.job.appliedAt ? '（' + merged.job.appliedAt + '）' : ''));
    if (merged.job.url) {
      console.log('岗位链接：' + merged.job.url);
      if (args.open) {
        // 只在这里、且用户明确要求时才打开浏览器；默认只打印，不做意外动作
        const opener = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open');
        spawnSync(opener, [merged.job.url], { stdio: 'ignore' });
        console.log('（已尝试用 ' + opener + ' 打开）');
      } else {
        console.log('（加 --open 可直接在浏览器打开）');
      }
    }
    console.log('');
    console.log('投递时可直接粘贴的要点（都来自你的练习记录）：');
    resume.highlights.slice(0, 4).forEach(function (row) { console.log('  - ' + row.text + '（' + row.evidence + '）'); });
    return 0;
  }

  throw new CliError('flow 的子命令：status / resume / collect / recommend / apply', 2);
}
