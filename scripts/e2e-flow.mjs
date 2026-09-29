// 端到端闭环回归：把整个求职学习闭环在**临时环境**里跑一遍，每一步都断言产出。
//
// 为什么需要：单点用例再多，也证明不了"这一串还接得上"——第 12 轮就出现过"能力都在、但原生那个按钮从没发出过请求"。
// 这条脚本按用户真实顺序走一遍：
//   收岗位 → 分析 JD → 建项目收 JD → 出练习清单 → 练 → 生成简历 → 投递 → 跟进 → 检索/调研/体检
// 任何一步没产出就立刻失败，并打印带序号的轨迹（人类可读）与退出码（机器可判）。
//
// 环境：DSH_LEARN_HOME 指向临时目录（**绝不碰真实数据**），必须在 import core 之前设置。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-e2e-'));
process.env.DSH_LEARN_HOME = home;

const ROOT = new URL('..', import.meta.url).pathname;
const project = await import(ROOT + 'src/core/project.mjs');
const { analyzeJd, mergeJob, jobFollowUps } = await import(ROOT + 'src/core/jobs.mjs');
const { buildResume } = await import(ROOT + 'src/core/resume.mjs');
const { recommendJobs } = await import(ROOT + 'src/core/flow.mjs');
const { searchCorpus } = await import(ROOT + 'src/core/corpus.mjs');
const { surveyGroups } = await import(ROOT + 'src/core/survey.mjs');
const { runDoctor } = await import(ROOT + 'src/core/doctor.mjs');
const { TASKS } = await import(ROOT + 'src/core/tasks.mjs');
const store = await import(ROOT + 'src/store.mjs');

const trace = [];
let step = 0;
function check(label, condition, detail) {
  step += 1;
  const ok = Boolean(condition);
  trace.push((ok ? 'PASS  ' : 'FAIL  ') + String(step).padStart(2, '0') + '. ' + label + (ok ? '' : ('　← ' + detail)));
  if (!ok) {
    console.log(trace.join(String.fromCharCode(10)));
    console.log('端到端闭环失败：' + label + '（' + detail + '）');
    // 失败时保留临时目录：调试工具就该留下现场（成功才清理）
    console.log('临时目录保留在：' + home + '（删掉它：rm -rf ' + home + '）');
    process.exit(1);
  }
  return ok;
}

const JD = [
  '岗位职责：负责数据平台与算法服务的开发',
  '任职要求：熟悉 PostgreSQL 索引优化，熟悉 Kubernetes 与 Docker',
  '加分项：有 YOLO 训练或 vllm 推理服务经验'
].join(String.fromCharCode(10));

try {
  // 1) 收岗位 + 分析 JD
  const analysis = analyzeJd(JD, { tasks: TASKS });
  check('分析 JD：命中知识点与可练题', (analysis.points || []).length > 0 && (analysis.tasks || []).length > 0,
    '知识点 ' + (analysis.points || []).length + ' / 题 ' + (analysis.tasks || []).length);
  let jobs = store.readJobs();
  const saved = mergeJob(jobs, { company: '端到端公司', position: '平台工程师', status: 'todo', jd: JD, analysis: analysis }, {});
  check('存下投递记录（待投）', saved.ok && saved.job && saved.job.status === 'todo', JSON.stringify(saved.errors || []));
  jobs = saved.jobs;
  store.writeJobs(jobs);

  // 2) 建项目并收 JD（同一份文本，走项目链路）
  const ingested = project.ingestIntoProject('e2e-project', { kind: 'text', source: 'e2e/jd.txt', text: JD });
  check('建项目并收 JD', ingested && ingested.project, JSON.stringify(ingested).slice(0, 120));
  const meta = project.readProject('e2e-project');
  check('来源记账（有知识点）', (meta.sources || []).length > 0 && (meta.sources[0].points || []).length > 0,
    '来源 ' + (meta.sources || []).length + ' / 知识点 ' + ((meta.sources[0] || {}).points || []).length);
  check('原文已另存（可回看/可检索）', Boolean(meta.sources[0].textFile), JSON.stringify(meta.sources[0]).slice(0, 120));

  // 3) 出练习清单
  const plan = project.projectDrillPlan(['e2e-project'], { records: [] });
  check('开练清单有可练题', plan.total > 0 && plan.nextUp.length > 0, '共 ' + plan.total + ' 道');
  const jdPlan = (await import(ROOT + 'src/core/jdplan.mjs')).buildJdPlan({
    name: 'e2e-project',
    sources: [{ index: 1, source: 'e2e/jd.txt', text: JD }]
  }, { max: 5 });
  check('JD → 练习清单可用', jdPlan.total > 0 && jdPlan.markdown.indexOf('练习清单') > -1, '共 ' + jdPlan.total + ' 道');

  // 4) 练（把清单第一题练过）
  // 题行的字段名两种函数历史上不一致（drill 用 id、jdplan 用 taskId）：core 已对齐，这里也显式兼容
  const firstTask = plan.nextUp[0].taskId || plan.nextUp[0].id;
  check('开练清单的行能取到题号（id/taskId 至少有一个）', Boolean(firstTask), JSON.stringify(plan.nextUp[0]));
  store.record({ client: 'e2e', taskId: firstTask, score: 100, verdict: '通过', platform: 'darwin' });
  const records = store.load().records;
  check('练习记录已写', records.some(function (row) { return row.taskId === firstTask && row.score === 100; }), '记录数 ' + records.length);

  // 5) 生成简历
  const resume = buildResume(records, TASKS, {});
  const resumeText = typeof resume === 'string' ? resume : (resume.markdown || resume.text || '');
  check('按真实练习生成简历要点', resumeText.length > 0 && resumeText.indexOf('通过') > -1, '长度 ' + resumeText.length);

  // 6) 投递 + 跟进
  const applied = mergeJob(jobs, Object.assign({}, saved.job, { status: 'applied' }), {});
  jobs = applied.jobs;
  check('投出去（状态 → 已投）', applied.ok && applied.job.status === 'applied', JSON.stringify(applied.errors || []));
  check('状态时间线留痕', (applied.job.history || []).length >= 2, '历史 ' + (applied.job.history || []).length + ' 条');
  const follow = jobFollowUps(jobs, { staleDays: 5, now: '2099-01-01' });
  check('跟进视图能算出待跟进', follow.waiting.length >= 1 && follow.followUps.length >= 1, JSON.stringify(follow.stats || follow.now));
  store.writeJobs(jobs);

  // 7) 岗位推荐
  const recommend = recommendJobs(jobs, TASKS, records, {});
  check('岗位推荐能给出结果（数组，含匹配度）', Array.isArray(recommend) && recommend.length >= 1 && typeof recommend[0].match === 'number',
    '返回 ' + (Array.isArray(recommend) ? recommend.length + ' 条' : typeof recommend));

  // 8) 检索 / 分方向调研 / 体检
  const hit = searchCorpus('PostgreSQL', {});
  check('语料检索能命中刚收的 JD', hit.total >= 1, '命中 ' + hit.total + ' 行');
  const groups = surveyGroups([
    { name: '数据', items: [{ name: 'a', text: '任职要求：熟悉 PostgreSQL' }] },
    { name: '算法', items: [{ name: 'b', text: '任职要求：熟悉 YOLO' }] }
  ], { tasks: TASKS });
  check('分方向调研给出矩阵', groups.stats.groups === 2 && groups.matrix.length > 0, JSON.stringify(groups.stats));
  const doctor = runDoctor({});
  check('数据体检能跑（新环境应无错误项）', doctor.ok && doctor.stats.errors === 0, JSON.stringify(doctor.stats));

  console.log(trace.join(String.fromCharCode(10)));
  console.log('端到端闭环通过：' + step + ' 步全部有产出（临时目录 ' + home + '）');
  rmSync(home, { recursive: true, force: true });
  process.exit(0);
} catch (err) {
  console.log(trace.join(String.fromCharCode(10)));
  console.log('端到端闭环抛错：' + (err && err.stack ? err.stack : err));
  rmSync(home, { recursive: true, force: true });
  process.exit(1);
}
