// 接口层端到端：与 scripts/e2e-flow.mjs 同样的闭环，但**经 HTTP 接口**跑。
//
// 为什么要两条：core 直连证明"逻辑对"，接口层证明"客户端真能走通"——第 12 轮那个 bug
//（Engine 把查询串拼进路径）就属于"core 没问题、接口层从没发出去"这一类。
//
// 做法：起一个真实的 web 服务（临时 home + 随机端口），用 HTTP 打完 17 步，最后收尾清理。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const home = mkdtempSync(join(tmpdir(), 'dsh-e2e-api-'));
const { TASKS } = await import(ROOT + 'src/core/tasks.mjs');

const trace = [];
let step = 0;
function check(label, ok, detail) {
  step += 1;
  trace.push((ok ? 'PASS  ' : 'FAIL  ') + String(step).padStart(2, '0') + '. ' + label + (ok ? '' : ('　← ' + detail)));
  if (!ok) {
    console.log(trace.join(String.fromCharCode(10)));
    console.log('接口层闭环失败：' + label + '（' + detail + '）');
    console.log('临时目录保留在：' + home + '；服务日志：' + logFile);
    server.kill();
    process.exit(1);
  }
}

const logFile = join(home, 'server.log');
const server = spawn(process.execPath, [join(ROOT, 'src/web/server.mjs'), '--host', '127.0.0.1', '--port', '0'], {
  env: Object.assign({}, process.env, { DSH_LEARN_HOME: home }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let buffered = '';
const ready = new Promise(function (resolve, reject) {
  const timer = setTimeout(function () { reject(new Error('服务 10 秒内没打印地址')); }, 10000);
  server.stdout.on('data', function (chunk) {
    buffered += String(chunk);
    const hit = buffered.match(/DSH_LEARN_URL=(\S+)/);
    if (hit) { clearTimeout(timer); resolve(hit[1]); }
  });
  server.stderr.on('data', function (chunk) { buffered += String(chunk); });
});

const base = await ready;
async function api(path, options) {
  const res = await fetch(base + path, options);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (err) { /* 非 JSON */ }
  return { status: res.status, ok: res.ok, json: json, text: text };
}
function post(path, body) {
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const JD = [
  '岗位职责：负责数据平台与算法服务的开发',
  '任职要求：熟悉 PostgreSQL 索引优化，熟悉 Kubernetes 与 Docker'
].join(String.fromCharCode(10));

try {
  check('服务起来了（打印了可解析地址）', Boolean(base), base);
  const boot = await api('/api/bootstrap');
  check('GET /api/bootstrap 有题目与平台', boot.ok && (boot.json.tasks || []).length > 100, JSON.stringify({ status: boot.status, tasks: (boot.json.tasks || []).length }));

  const created = await post('/api/jobs', { action: 'save', job: { company: '接口公司', position: '平台工程师', status: 'todo', jd: JD } });
  check('POST /api/jobs 存岗位（返回这一行）', created.ok && created.json.job && created.json.job.id, JSON.stringify(created.json).slice(0, 120));
  const jobId = created.json.job.id;
  const analyzed = await post('/api/jobs', { action: 'analyze', id: jobId });
  check('POST /api/jobs action=analyze 命中知识点', analyzed.ok && ((analyzed.json.analysis || {}).tasks || []).length > 0,
    JSON.stringify(analyzed.json).slice(0, 140));

  const project = 'api-' + String(Date.now());
  const init = await post('/api/project', { action: 'init', name: project, displayName: '接口闭环' });
  // 注意：action=init 返回 { project }，而 GET /api/project?name= 返回 { meta }——同一份数据的两种包装，断言两种都接受
  check('POST /api/project action=init 建项目', init.ok && Boolean(init.json.project || init.json.meta), JSON.stringify(init.json).slice(0, 120));
  const ingested = await post('/api/project', { action: 'add', name: project, kind: 'text', text: JD });
  check('action=add 收来源（有知识点）', ingested.ok && (ingested.json.knowledge || {}).matched > 0, JSON.stringify(ingested.json).slice(0, 140));
  const index = await post('/api/project', { action: 'index', name: project });
  check('action=index 有索引与可练题', index.ok && (index.json.tasks || []).length > 0, JSON.stringify({ status: index.status, tasks: ((index.json || {}).tasks || []).length }));
  const drilled = await post('/api/project', { action: 'drill', project: project, limit: 5 });
  const planTotal = ((drilled.json || {}).plan || {}).total || 0;
  check('action=drill 给出开练清单', drilled.ok && planTotal > 0, JSON.stringify({ status: drilled.status, total: planTotal }));
  const jdPlan = await post('/api/project', { action: 'jdplan', project: project, max: 5 });
  check('action=jdplan 给出练习清单', jdPlan.ok && (jdPlan.json.markdown || '').indexOf('练习清单') > -1, JSON.stringify(jdPlan.json).slice(0, 120));

  // 练：走真实的判定接口（客户端用的就是它），用题目自带的参考答案应当满分
  const firstTask = ((((drilled.json || {}).plan || {}).nextUp) || [])[0] || {};
  const taskId = firstTask.taskId || firstTask.id;
  const task = TASKS.filter(function (row) { return row.id === taskId; })[0] || {};
  const answer = task.sample || 'docker ps';
  const judged = await post('/api/check', { taskId: taskId, answer: answer, client: 'e2e-api', platform: 'darwin' });
  check('POST /api/check 判定并记录（用参考答案应当通过）', judged.ok && ((judged.json.result || {}).score >= 60),
    JSON.stringify({ taskId: taskId, status: judged.status, score: (judged.json.result || {}).score, error: judged.json.error }).slice(0, 160));

  const resume = await post('/api/flow', { action: 'resume' });
  check('POST /api/flow action=resume 给出简历要点', resume.ok && Boolean(resume.json.highlights), JSON.stringify(resume.json).slice(0, 120));
  const applied = await post('/api/flow', { action: 'apply', id: jobId });
  check('action=apply 投出去', applied.ok && (applied.json.job || {}).status === 'applied', JSON.stringify(applied.json).slice(0, 120));
  const jobs = await api('/api/jobs');
  const follow = (jobs.json || {}).follow || {};
  check('GET /api/jobs 带跟进视图', jobs.ok && Array.isArray(follow.rows), JSON.stringify(Object.keys(follow)));
  const recommended = await post('/api/flow', { action: 'recommend' });
  // 接口把 core 的数组包成 { ok, jobs }（core 直接返回数组）——两种形状都接受，但要求至少有一条
  const recommendedRows = recommended.json.jobs || recommended.json.matches || [];
  check('action=recommend 给出推荐', recommended.ok && recommendedRows.length >= 1 && typeof recommendedRows[0].match === 'number',
    JSON.stringify({ keys: Object.keys(recommended.json || {}), rows: recommendedRows.length }).slice(0, 140));

  const corpus = await api('/api/corpus?q=PostgreSQL&limit=5');
  check('GET /api/corpus 命中刚收的 JD', corpus.ok && (corpus.json.total || 0) > 0, JSON.stringify({ status: corpus.status, total: (corpus.json || {}).total }));
  const grouped = await post('/api/survey', { groups: [
    { name: '数据', texts: ['任职要求：熟悉 PostgreSQL'] },
    { name: '算法', texts: ['任职要求：熟悉 YOLO'] }
  ] });
  check('POST /api/survey groups 给出矩阵', grouped.ok && ((grouped.json.stats || {}).groups === 2), JSON.stringify(grouped.json.stats || {}).slice(0, 120));
  const doctor = await api('/api/doctor');
  check('GET /api/doctor 体检可跑', doctor.ok && Boolean(doctor.json.stats), JSON.stringify(doctor.json).slice(0, 120));

  const cleanup = await post('/api/project', { action: 'delete', name: project, confirm: true });
  check('action=delete 收尾清理', cleanup.ok, JSON.stringify(cleanup.json).slice(0, 120));

  console.log(trace.join(String.fromCharCode(10)));
  console.log('接口层闭环通过：' + step + ' 步（服务 ' + base + '，临时目录 ' + home + '）');
  server.kill();
  rmSync(home, { recursive: true, force: true });
  process.exit(0);
} catch (err) {
  console.log(trace.join(String.fromCharCode(10)));
  console.log('接口层闭环抛错：' + (err && err.stack ? err.stack : err));
  console.log('服务输出片段：' + buffered.slice(-400));
  server.kill();
  process.exit(1);
}
