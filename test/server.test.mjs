// Web 客户端集成测试：在被测进程内启动真实的 HTTP 服务端，用 fetch 打真实请求。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECT } from './expected.mjs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 必须在导入 store 之前设置进度目录，否则会写到真实用户目录。
const HOME = mkdtempSync(join(tmpdir(), 'dsh-learn-web-'));
process.env.DSH_LEARN_HOME = HOME;

const { createAppServer, watchParent } = await import('../src/web/server.mjs');

const server = createAppServer();
await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
const BASE = 'http://127.0.0.1:' + server.address().port;

function get(path) {
  return fetch(BASE + path);
}

function post(path, body, raw) {
  return fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body || {})
  });
}

// 项目 / 仓库接口：网页版与 CLI 共用 core/project.mjs，这里验的是 HTTP 这一层。
test('POST /api/project 能建项目、收文字、解析本地仓库', async function () {
  const repoDir = mkdtempSync(join(tmpdir(), 'dsh-learn-api-repo-'));
  writeFileSync(join(repoDir, 'README.md'), '# demo\n\n    docker build -t api:1.0 .\n    go test ./...\n');
  writeFileSync(join(repoDir, 'go.mod'), 'module example.com/api\n\ngo 1.22\n');

  const init = await (await post('/api/project', { action: 'init', name: 'api-test' })).json();
  assert.equal(init.created, true);
  assert.ok(init.dir.indexOf('projects/api-test') > -1, '项目目录应在 projects/ 下：' + init.dir);

  const text = await (await post('/api/project', { name: 'api-test', text: '熟悉 Docker Compose；会用 kubectl 排查 Pod' })).json();
  assert.ok(text.knowledge.matched > 0, '文字输入应匹配到知识点');
  assert.ok(text.artifacts.some(function (rel) { return rel.indexOf('notes/') === 0; }), '应写入 notes/ 摘要');

  const repo = await (await post('/api/project', { name: 'api-test', kind: 'repo', repoPath: repoDir })).json();
  assert.ok((repo.signals || []).some(function (row) { return row.id === 'go'; }), '应识别出 go 信号');
  assert.ok((repo.signals || []).some(function (row) { return row.id === 'dockerfile' || row.id === 'go'; }));
  assert.ok(repo.tasks > 0, 'README 里的命令应抽成草案');
  assert.ok(repo.artifacts.some(function (rel) { return rel.indexOf('drafts/') === 0; }), '草案应写入 drafts/');

  const list = await (await get('/api/project')).json();
  assert.ok(list.projects.some(function (row) { return row.name === 'api-test' && row.sources >= 2; }), '列表要能看到项目与来源数');

  // 网页版与命令行必须给出同一批草案：仓库画像里的 go.mod 指令（go 1.22）不能被当成命令
  const draftsDir = join(HOME, 'projects', 'api-test', 'drafts');
  const draftFile = readdirSync(draftsDir).filter(function (name) { return name.endsWith('.json'); }).sort().pop();
  const drafted = JSON.parse(readFileSync(join(draftsDir, draftFile), 'utf8'));
  const junk = drafted.tasks.filter(function (task) { return /^go\s+1\./.test(String(task.sample || '')); });
  assert.deepEqual(junk.map(function (task) { return task.sample; }), [], '清单指令不该变成草案题：' + JSON.stringify(drafted.tasks.map(function (task) { return task.sample; })));

  const bad = await post('/api/project', { action: 'add' });
  assert.equal(bad.status, 400, '没有项目名应 400');
  rmSync(repoDir, { recursive: true, force: true });
});

// 「加入总题库」：把项目里的草案写进用户题库目录（~/.dsh-learn/packs/），所有客户端下次启动就能练到。
// 与上一个用例的区别只在去处：一个是项目自己的 promoted/ 暂存区，一个是总题库。
test('草案能直接加入总题库，并被加载出来', async function () {
  const repoDir = mkdtempSync(join(tmpdir(), 'dsh-learn-api-catalog-'));
  writeFileSync(join(repoDir, 'README.md'), '# c' + String.fromCharCode(10) + String.fromCharCode(10) + '    docker build -t c:1.0 .' + String.fromCharCode(10) + '    go test -race ./...' + String.fromCharCode(10));
  writeFileSync(join(repoDir, 'go.mod'), 'module example.com/c' + String.fromCharCode(10));
  await post('/api/project', { action: 'init', name: 'catalog-api' });
  const added = await (await post('/api/project', { name: 'catalog-api', kind: 'repo', repoPath: repoDir })).json();
  assert.ok(added.tasks > 0, '仓库里应抽出命令草案');
  const list = await (await get('/api/draft?project=catalog-api')).json();
  const file = list.drafts[0].file;

  const preview = await (await post('/api/draft', { project: 'catalog-api', file: file, scope: 'catalog' })).json();
  assert.equal(preview.scope, 'catalog');
  assert.equal(preview.dryRun, true, '默认仍然只预览');
  const target = join(process.env.DSH_LEARN_HOME, 'packs', preview.packId + '.json');
  assert.equal(preview.target, target, '总题库的目标路径应在用户题库目录里');
  assert.equal(existsSync(target), false, '预览不写文件');

  const written = await (await post('/api/draft', { project: 'catalog-api', file: file, scope: 'catalog', dryRun: false })).json();
  assert.deepEqual(written.errors, [], '写入不该报错：' + JSON.stringify(written.errors));
  assert.equal(written.inCatalog, true, '返回里要标明已入总题库');
  assert.equal(existsSync(target), true, '确认后要写进用户题库目录');

  // 写进去之后真能加载：这条是"加入总题库"的核心承诺，不能只写文件
  const { loadLocalPacks, userPackDir } = await import('../src/core/packs.mjs');
  const loaded = loadLocalPacks(userPackDir());
  assert.deepEqual(loaded.map(function (pack) { return pack.id; }), [preview.packId]);
  assert.ok(loaded[0].tasks.length > 0);
  // 项目索引也要立刻反映出来（不用重新分析）
  const { loadProjectTasks } = await import('../src/core/project.mjs');
  const index = loadProjectTasks('catalog-api');
  const row = index.drafts.filter(function (d) { return d.packId === preview.packId; })[0];
  assert.equal(row.inCatalog, true, '索引里应标为已入总题库');
  rmSync(repoDir, { recursive: true, force: true });
});

// 网页版也要拦住"元数据损坏被静默覆盖"：与 CLI 一样返回 400，且坏文件一字不改。
test('POST /api/project：元数据损坏时 init / 收来源都 400，不覆盖坏文件', async function () {
  const name = 'broken-api-' + Date.now();
  const file = join(HOME, 'projects', name, 'project.json');
  const init = await post('/api/project', { action: 'init', name: name });
  assert.equal(init.status, 200);
  writeFileSync(file, 'not json at all');

  const added = await post('/api/project', { name: name, text: '熟悉 Docker Compose；会用 kubectl 排查 Pod' });
  assert.equal(added.status, 400, '损坏时收来源要 400，而不是重建空台账');
  const body = await added.json();
  assert.equal(body.corrupted, true);
  assert.match(body.error, /损坏|不敢覆盖/);
  assert.equal(readFileSync(file, 'utf8'), 'not json at all', '坏文件不许被覆盖');

  const reinited = await post('/api/project', { action: 'init', name: name });
  assert.equal(reinited.status, 400, 'init 也要 400');
  assert.equal(readFileSync(file, 'utf8'), 'not json at all');

  rmSync(join(HOME, 'projects', name), { recursive: true, force: true });
});

// 草案 → 正式包：网页上先预览（默认 dry-run），确认后落到项目 promoted/ 并返回可下载的包
test('GET/POST /api/draft 预览与转正式包', async function () {
  const repoDir = mkdtempSync(join(tmpdir(), 'dsh-learn-api-draft-'));
  writeFileSync(join(repoDir, 'README.md'), '# d\n\n    docker build -t d:1.0 .\n    go test -race ./...\n');
  writeFileSync(join(repoDir, 'go.mod'), 'module example.com/d\n');
  await post('/api/project', { action: 'init', name: 'draft-api' });
  const added = await (await post('/api/project', { name: 'draft-api', kind: 'repo', repoPath: repoDir })).json();
  assert.ok(added.tasks > 0, '仓库里应抽出命令草案');

  const list = await (await get('/api/draft?project=draft-api')).json();
  assert.equal(list.drafts.length, 1);
  const file = list.drafts[0].file;
  assert.ok(list.drafts[0].packId.indexOf('repo-') === 0, '仓库草案包名要有 repo- 前缀：' + list.drafts[0].packId);

  const preview = await (await post('/api/draft', { project: 'draft-api', file: file })).json();
  assert.equal(preview.dryRun, true, '默认只预览');
  assert.ok(preview.levelsAdded.length > 0, '预览要给出会补哪些 level');
  assert.ok(preview.warnings.length > 0, '预览要给出复核提醒');
  assert.equal(preview.pack, null, '预览不返回正式包');

  const promoted = await (await post('/api/draft', { project: 'draft-api', file: file, dryRun: false })).json();
  assert.deepEqual(promoted.errors, []);
  assert.ok(promoted.pack && promoted.pack.tasks.length > 0, '转正式包后要能拿到包体');
  assert.ok(promoted.pack.tasks.every(function (task) { return task.level; }), '正式包里每题都要有 level');
  assert.ok(existsSync(join(process.env.DSH_LEARN_HOME, 'projects/draft-api/promoted')), '要落在项目 promoted/ 里');
  rmSync(repoDir, { recursive: true, force: true });
});

// 桌面壳依赖这条：App 被 kill -9 时不会走优雅退出，服务必须自己发现父进程没了
test('父进程看门狗：父进程消失后服务自己退出，没给 pid 时不启用', async function () {
  assert.equal(watchParent(undefined, function () {}), null, '没给 pid 就不该启用');
  assert.equal(watchParent('abc', function () {}), null, '非法 pid 不该启用');
  const alive = watchParent(process.pid, function () { throw new Error('父进程还在，不该触发'); });
  assert.ok(alive, '给了合法 pid 应返回定时器');
  clearInterval(alive);

  await new Promise(function (resolve, reject) {
    // 999999 是一个几乎不可能存在的 pid，看门狗应当在一个轮询周期内发现它不存在
    const timer = watchParent(999999, function () {
      clearInterval(timer);
      resolve();
    });
    setTimeout(function () { reject(new Error('2 秒内看门狗没有发现父进程消失')); }, 5000).unref();
  });
});

test('GET / 返回浏览器客户端页面', async function () {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.indexOf('dsh-learn') > -1);
  assert.ok(html.length > 5000);
});



// 按岗位生成项目 + 学习计划（与 CLI flow build 同一份 studyPlan）
test('POST /api/flow action=build：建项目并落学习计划', async function () {
  const jd = ['某某科技 招聘 高级运维工程师', '岗位职责', '负责 Kubernetes 集群稳定运行', '任职要求', '熟悉 Linux 与 Shell，3 年以上经验', '掌握 Python', '加分项', '了解 Terraform'].join(String.fromCharCode(10));
  const saved = await (await post('/api/flow', { action: 'collect', text: jd })).json();
  assert.equal(saved.ok, true, JSON.stringify(saved).slice(0, 200));
  const built = await (await post('/api/flow', { action: 'build', id: saved.job.id })).json();
  assert.equal(built.ok, true, JSON.stringify(built).slice(0, 200));
  assert.ok(built.project, '要返回项目名');
  assert.ok((built.plan.missingTasks || []).length > 0, '要有待练清单');
  assert.ok((built.plan.points || []).length > 0, '要有知识点行');
  assert.ok(String(built.plan.markdown).indexOf('岗位学习计划') > -1, '要有计划正文');
  const index = await (await post('/api/project', { action: 'index', name: built.project })).json();
  assert.ok(index.tasks.length > 0, '项目索引里要有可练题');
  // 计划文件真的落盘了
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  ['项目书.md', 'checklist.md', 'notes/命令清单.md'].forEach(function (name) {
    assert.equal(existsSync(join(process.env.DSH_LEARN_HOME, 'projects', built.project, name)), true, '要落盘：' + name);
  });
  assert.ok(((built.scaffold || {}).deliverables || []).length > 0, '项目书要有交付项');
  assert.ok(String(((built.scaffold || {}).book) || '').indexOf('项目书') > -1, '要有项目书正文');
  assert.ok((built.files || []).length >= 4, '要返回产物文件清单');

  assert.equal(existsSync(join(process.env.DSH_LEARN_HOME, 'projects', built.project, 'notes', '岗位学习计划.md')), true, '计划文件要写进项目 notes/');
  const missing = await post('/api/flow', { action: 'build', id: 'nope' });
  assert.equal(missing.status, 404, '找不到岗位要 404');
  // 收尾：删掉这条岗位记录，后面的 /api/jobs 用例假定一开始是空的
  await post('/api/jobs', { action: 'delete', id: saved.job.id });
  const after = await (await get('/api/jobs')).json();
  assert.equal(after.jobs.length, 0, '收尾后不该留下记录');
});

// 按链接抓 JD：用本机 fixture 当岗位页（不打外网），并验证非 JD 页面会如实标注
test('POST /api/flow action=collect url=…：抓链接并如实标注分类', async function () {
  const http = await import('node:http');
  const page = ['<html><body>',
    '<h1>某某科技 招聘 高级运维工程师</h1>',
    '<h2>任职要求</h2>',
    '<p>熟悉 Kubernetes 滚动发布与 Prometheus 告警</p>',
    '<p>掌握 Python 或 Go</p>',
    '<h2>加分项</h2>',
    '<p>了解 Terraform</p>',
    '<p>工作地点：深圳　薪资：25-40K</p>',
    '</body></html>'].join('');
  const fixture = http.createServer(function (req, res) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(page);
  });
  await new Promise(function (resolve) { fixture.listen(0, '127.0.0.1', resolve); });
  const url = 'http://127.0.0.1:' + fixture.address().port + '/job/1';
  try {
    const empty = await post('/api/flow', { action: 'collect' });
    assert.equal(empty.status, 400, '三种输入都不给要 400');
    const saved = await (await post('/api/flow', { action: 'collect', url: url })).json();
    assert.equal(saved.ok, true, JSON.stringify(saved).slice(0, 200));
    assert.equal(saved.job.company, '某某科技');
    assert.equal(saved.job.position, '高级运维工程师');
    assert.equal(saved.job.url, url, '链接要存进记录（投递时直接用）');
    assert.ok((saved.job.analysis.tasks || []).length > 0, '要顺手分析出可练题');
    assert.ok((saved.job.analysis.mustHave || []).length >= 2, '分析里要带硬要求（匹配度加权要用）');
    // 匹配度：这条岗位要有依据说明（老记录没硬要求时会写"没存硬要求"）
    const recommend = await (await post('/api/flow', { action: 'recommend', limit: 5 })).json();
    const hit = recommend.jobs.filter(function (row) { return row.jobId === saved.job.id; })[0];
    assert.ok(hit, '刚入库的岗位要出现在推荐里');
    assert.ok((hit.why || []).length >= 2, '推荐要给逐项依据：' + JSON.stringify(hit.why));
    assert.ok(hit.why.join(' ').indexOf('硬要求对应的题') > -1, '存了硬要求就要按加权算：' + JSON.stringify(hit.why));
    await post('/api/jobs', { action: 'delete', id: saved.job.id });
  } finally {
    await new Promise(function (resolve) { fixture.close(resolve); });
  }
});

// 投递材料（与 CLI flow pack 同一份 applicationPack）
test('POST /api/flow action=pack：逐条对硬要求 + 可粘贴材料', async function () {
  const jd = ['某某科技 招聘 高级运维工程师', '工作地点：深圳', '薪资：25-40K', '3 天前发布', '岗位职责', '负责 Kubernetes 集群稳定运行', '任职要求', '熟悉 Kubernetes 滚动发布', '掌握 Python'].join(String.fromCharCode(10));
  const saved = await (await post('/api/flow', { action: 'collect', text: jd })).json();
  assert.equal(saved.ok, true, JSON.stringify(saved).slice(0, 200));
  const pack = await (await post('/api/flow', { action: 'pack', id: saved.job.id })).json();
  assert.equal(pack.ok, true, JSON.stringify(pack).slice(0, 200));
  assert.equal(pack.location, '深圳', '地点要抽出来');
  assert.ok(pack.salary && pack.salary.min === 25, '薪资要抽出来：' + JSON.stringify(pack.salary));
  assert.ok((pack.mustRows || []).length >= 1, '要有硬要求行');
  assert.ok(String(pack.markdown).indexOf('投递材料') > -1);
  assert.ok(String(pack.markdown).indexOf('深圳') > -1, '材料里要带地点');
  const missing = await post('/api/flow', { action: 'pack', id: 'nope' });
  assert.equal(missing.status, 404);
  await post('/api/jobs', { action: 'delete', id: saved.job.id });
});

// 推荐筛选走 HTTP：地点/薪资/远程（界面上的三个输入框就是打这三个参数）
test('POST /api/flow action=recommend 支持地点/薪资区间/只看远程', async function () {
  const http = await import('node:http');
  const page = ['<html><body><h1>某某科技 招聘 高级运维工程师</h1><h2>任职要求</h2>',
    '<p>熟悉 Kubernetes 滚动发布</p><p>工作地点：深圳</p><p>薪资：25-40K</p><p>今天发布</p></body></html>'].join('');
  const fixture = http.createServer(function (req, res) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page); });
  await new Promise(function (resolve) { fixture.listen(0, '127.0.0.1', resolve); });
  const url = 'http://127.0.0.1:' + fixture.address().port + '/job/1';
  try {
    const saved = await (await post('/api/flow', { action: 'collect', url: url })).json();
    assert.equal(saved.ok, true, JSON.stringify(saved).slice(0, 200));
    const hit = await (await post('/api/flow', { action: 'recommend', location: '深圳', salaryMin: 25, salaryMax: 40 })).json();
    assert.ok(hit.jobs.some(function (row) { return row.jobId === saved.job.id; }), '地点+薪资都合适时要在推荐里');
    const miss = await (await post('/api/flow', { action: 'recommend', location: '北京' })).json();
    assert.ok(!miss.jobs.some(function (row) { return row.jobId === saved.job.id; }), '地点不符要被筛掉');
    const low = await (await post('/api/flow', { action: 'recommend', salaryMax: 20 })).json();
    assert.ok(!low.jobs.some(function (row) { return row.jobId === saved.job.id; }), '薪资完全不重叠要被筛掉');
    const attrs = hit.jobs.filter(function (row) { return row.jobId === saved.job.id; })[0];
    assert.equal(attrs.location, '深圳');
    assert.ok(attrs.salary && attrs.salary.min === 25);
    assert.ok(attrs.postedAt, '发布时间要带出来：' + JSON.stringify(attrs.postedAt));
    await post('/api/jobs', { action: 'delete', id: saved.job.id });
  } finally {
    await new Promise(function (resolve) { fixture.close(resolve); });
  }
});

// 批量动作不该被"必须有项目名"挡住（网页上的导入/回填按钮曾经一直被 400 挡掉）
test('POST /api/project：不带项目名的 import / backfill 也要能跑', async function () {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-import-api-'));
  fs.mkdirSync(path.join(dir, 'cat'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cat', '01.txt'), '任职要求：熟悉 Kubernetes 与 Docker');
  const noName = await post('/api/project', { action: 'backfill', dir: dir });
  assert.equal(noName.status, 200, '回填不该要求项目名');
  const imported = await post('/api/project', { action: 'import', dir: dir, prefix: 'apitest-' });
  assert.equal(imported.status, 200, '导入不该要求项目名');
  const payload = await imported.json();
  assert.equal(payload.ok, true, JSON.stringify(payload).slice(0, 200));
  assert.equal(payload.files, 1);
  assert.equal(payload.projects[0].name, 'apitest-cat');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const row of payload.projects) { await post('/api/project', { action: 'delete', name: row.name, confirm: true }); }
});

// 按分类调研的接口：groups 走分方向矩阵；texts 仍是老口径。
test('POST /api/survey：groups 返回分方向矩阵，方向不足时如实报错', async function () {
  const res = await post('/api/survey', { groups: [
    { name: '视觉', texts: ['任职要求：熟悉 YOLO 与 OpenCV'] },
    { name: '运维', texts: ['任职要求：熟悉 Kubernetes 与 Prometheus'] }
  ] });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true, JSON.stringify(payload).slice(0, 160));
  assert.equal(payload.stats.groups, 2);
  assert.ok(Array.isArray(payload.matrix) && payload.matrix.length >= 3, '要返回矩阵：' + JSON.stringify(payload.matrix));
  assert.ok(payload.markdown.indexOf('## 一、技术栈 × 方向 矩阵') > -1);
  const bad = await post('/api/survey', { texts: [] });
  assert.equal(bad.status, 400, '空输入要 400');
});

// 从 JD 生成练习清单（计划草案）：要写进项目并刷新索引，没原文要如实报错
test('POST /api/project：action=jdplan 生成计划草案，无原文时 400', async function () {
  // 注意：不要在这里切换 DSH_LEARN_HOME —— 本文件的服务端共享同一个 home，
  // 中途改环境变量会让后面的用例找不到项目（实测把安全用例写坏了）。用独立项目名即可。
  const created = await post('/api/project', { action: 'init', name: 'jdplan-api', displayName: 'JD 计划' });
  assert.equal(created.status, 200, '建项目');
  const empty = await post('/api/project', { action: 'jdplan', project: 'jdplan-api', max: 5 });
  assert.equal(empty.status, 400, '还没有来源时要 400');
  const ingested = await post('/api/project', { action: 'add', name: 'jdplan-api', kind: 'text', text: '任职要求：熟悉 YOLO 训练与 Python' });
  assert.equal(ingested.status, 200, '先收一条来源');
  const plan = await post('/api/project', { action: 'jdplan', project: 'jdplan-api', max: 5 });
  assert.equal(plan.status, 200);
  const payload = await plan.json();
  assert.equal(payload.ok, true, JSON.stringify(payload).slice(0, 160));
  assert.equal(payload.plan.kind, 'plan');
  assert.ok(payload.markdown.indexOf('练习清单') > -1);
  // 界面读的是 action=index（返回扁平索引），所以这里也走同一条路
  const index = await (await post('/api/project', { action: 'index', name: 'jdplan-api' })).json();
  const rows = (index.drafts || []).filter(function (row) { return row.kind === 'plan'; });
  assert.ok(rows.length >= 1, '索引里要能看到计划草案：' + JSON.stringify(index.drafts));
  assert.ok(rows[0].planTasks.length >= 1, '计划草案要带清单题号');
  await post('/api/project', { action: 'delete', name: 'jdplan-api', confirm: true });
});

// 语料检索接口：给关键词才返回命中；空关键词如实 400
test('GET /api/corpus 检索语料，缺关键词时 400', async function () {
  const created = await post('/api/project', { action: 'init', name: 'corpus-api', displayName: '语料检索' });
  assert.equal(created.status, 200);
  await post('/api/project', { action: 'add', name: 'corpus-api', kind: 'text', text: '任职要求：熟悉 PostgreSQL 与索引优化' });
  const hit = await get('/api/corpus?q=PostgreSQL&limit=5');
  assert.equal(hit.status, 200);
  const payload = await hit.json();
  assert.equal(payload.ok, true, JSON.stringify(payload).slice(0, 160));
  assert.ok(payload.total >= 1, '要能命中：' + JSON.stringify(payload).slice(0, 160));
  assert.ok((payload.hits[0].line || '').indexOf('PostgreSQL') > -1);
  const bad = await get('/api/corpus');
  assert.equal(bad.status, 400, '缺关键词要 400');
  await post('/api/project', { action: 'delete', name: 'corpus-api', confirm: true });
});

// 投递记录接口要把跟进视图一起给出来（界面一次请求即可渲染徽标与时间线）
test('GET /api/jobs 带跟进视图；改状态会写进时间线', async function () {
  const saved = await post('/api/jobs', { action: 'save', job: { company: '时间线公司', position: '测试岗', status: 'applied', appliedAt: '2026-09-20' } });
  assert.equal(saved.status, 200);
  const created = (await saved.json()).job;
  assert.ok(created.history && created.history.length >= 1, '新建要有历史：' + JSON.stringify(created.history));
  const updated = await post('/api/jobs', { action: 'save', job: { id: created.id, company: '时间线公司', position: '测试岗', status: 'interview', appliedAt: '2026-09-20', note: '一面结束' } });
  assert.equal(updated.status, 200);
  const after = (await updated.json()).job;
  assert.equal(after.history.length, 2, '改状态要追加一条：' + JSON.stringify(after.history));
  assert.equal(after.history[1].from, 'applied');
  const list = await (await get('/api/jobs')).json();
  assert.ok(list.follow, '列表要带 follow 视图');
  assert.ok(Array.isArray(list.follow.rows), 'follow.rows 要在');
  assert.ok(list.follow.rows.some(function (row) { return row.id === created.id; }), '新记录要出现在跟进视图里');
  await post('/api/jobs', { action: 'delete', id: created.id });
});

// 执行型判定的接口面：默认不执行，run:true 才跑（只读白名单内）
test('POST /api/check：默认不执行答案；run:true 时真的跑并回报输出', async function () {
  const quiet = await post('/api/check', { taskId: 'git.version-check', answer: 'git --version', client: 'e2e-exec', platform: 'darwin' });
  assert.equal(quiet.status, 200);
  const quietPayload = await quiet.json();
  assert.equal(quietPayload.execution, null, '没要 run 就不该有执行结果：' + JSON.stringify(quietPayload.execution));
  const ran = await post('/api/check', { taskId: 'git.version-check', answer: 'git --version', client: 'e2e-exec', platform: 'darwin', run: true });
  assert.equal(ran.status, 200);
  const payload = await ran.json();
  assert.ok(payload.execution, '要带执行结果');
  assert.equal(payload.execution.ran, true, JSON.stringify(payload.execution));
  assert.equal(payload.execution.exitCode, 0, JSON.stringify(payload.execution));
  assert.ok(String(payload.execution.output || '').indexOf('git version') > -1, '要带回真实输出');
  const refused = await post('/api/check', { taskId: 'git.version-check', answer: 'rm -rf /tmp/x', client: 'e2e-exec', platform: 'darwin', run: true });
  const refusedPayload = await refused.json();
  assert.equal(refusedPayload.execution.allowed, false, JSON.stringify(refusedPayload.execution));
  assert.equal(refusedPayload.execution.ran, false);
});

// 掌握度接口 + 判定反馈定位字段
test('GET /api/mastery 给出最弱知识点与今天先练；check 带 feedback', async function () {
  const mastery = await get('/api/mastery?limit=3');
  assert.equal(mastery.status, 200);
  const payload = await mastery.json();
  assert.equal(payload.ok, true, JSON.stringify(payload).slice(0, 120));
  assert.ok(payload.report, '要返回 report');
  assert.ok(Array.isArray(payload.report.weakest) && payload.report.weakest.length <= 3, '最弱列表受 limit 限制');
  assert.ok(Array.isArray(payload.report.nextUp), '要有今天先练的题');
  assert.ok(String(payload.markdown || '').indexOf('# 知识点掌握度') > -1, '要能直接看 markdown');
  const judged = await post('/api/check', { taskId: 'git.version-check', answer: 'git status', client: 'e2e-mastery', platform: 'darwin' });
  const judgedPayload = await judged.json();
  assert.ok(judgedPayload.feedback, '判定要带 feedback（缺的要素定位）');
  assert.ok(Array.isArray(judgedPayload.feedback.located) && Array.isArray(judgedPayload.feedback.unmatched), JSON.stringify(judgedPayload.feedback));
});

test('网页端每个 import 的本地模块都能被服务端取到（404 会让整页逻辑失效）', async function () {
  const app = await fetch(BASE + '/app.mjs');
  assert.equal(app.status, 200);
  const code = await app.text();
  const imports = [...code.matchAll(/from '\.\/([a-z-]+\.mjs)'/g)].map(function (m) { return m[1]; });
  assert.ok(imports.length > 0, 'app.mjs 应当 import 了本地模块（如 format.mjs）');
  for (const name of imports) {
    const res = await fetch(BASE + '/' + name);
    assert.equal(res.status, 200, '/' + name + ' 取不到（HTTP ' + res.status + '）：整页模块会加载失败');
    assert.ok(String(res.headers.get('content-type') || '').indexOf('javascript') > -1, name + ' 的 content-type 要是 javascript');
  }
});

// 系统性守卫：契约里的每个 action 都真打一遍，断言响应里没有 "X is not defined"。
//
// 为什么要有：本会话我 5 次漏补 import（LEVEL_LABELS / assessAnswer / masteryReport / locateMissing /
// packTemplate+deepValidate），而 node --check 与「代码里出现的标识符」这类静态检查都抓不到——
// 只有真执行到那个分支才会暴露。这个用例把"每个 action 至少被打一次"变成常态。
test('POST /api/understand 与 GET /api/ocr', async function () {
  const caps = await (await get('/api/ocr')).json();
  assert.ok(caps.platform, '要报出平台');
  assert.equal((caps.engines || []).length, 3, '三个识图引擎都要给出来');

  const empty = await post('/api/understand', {});
  assert.equal(empty.status, 400, '没给 text/image 要 400');

  const jd = ['某某科技 招聘 高级运维工程师', '岗位职责', '负责 Kubernetes 集群稳定运行', '任职要求', '熟悉 Linux 与 Shell，5 年以上经验', '掌握 Python 或 Go', '加分项', '了解 Terraform'].join(String.fromCharCode(10));
  const understood = await (await post('/api/understand', { text: jd })).json();
  assert.equal(understood.ok, true);
  assert.equal(understood.via, 'text');
  assert.equal(understood.kind, 'jd');
  assert.equal(understood.company, '某某科技');
  assert.equal(understood.position, '高级运维工程师');
  assert.ok((understood.mustHave || []).length >= 2, '硬要求至少两条：' + JSON.stringify(understood.mustHave));
  (understood.mustHave || []).forEach(function (row) { assert.ok(row.evidence, '每条要求都要给依据'); });
  assert.ok((understood.niceToHave || []).length >= 1);
  assert.ok((understood.stack || []).indexOf('kubernetes') > -1);
  assert.ok((understood.tasks || []).length > 0, '要给出可练题');
  assert.ok(String(understood.summary).indexOf('知识点') > -1, '摘要要说清知识点与可练题');
  assert.ok((understood.why || []).length >= 3, 'why 要能解释判断来源');
});

// 搜索 / 解析的 HTTP 层：用本地 fixture 搜索端点（不打外网），验证多引擎回退与收进项目。
test('POST /api/search 与 /api/research：搜到 → 解析 → 收进项目', async function () {
  const http = await import('node:http');
  const fixture = [
    '<html><body><li class="b_algo"><h2><a href="http://127.0.0.1:FIXTURE_PORT/docs/kubectl">kubectl 参考</a></h2>',
    '<p>kubectl 命令参考</p></li></body></html>'
  ].join('');
  // 本机 fixture：既当搜索端点，也当被搜到的"文档站"
  const fixtureServer = http.createServer(function (req, res) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url.indexOf('/search') === 0) { res.end(fixture.replace('FIXTURE_PORT', String(fixtureServer.address().port))); return; }
    res.end('<html><body><pre>kubectl rollout restart deployment/web' + String.fromCharCode(10) + 'kubectl rollout status deployment/web</pre></body></html>');
  });
  await new Promise(function (resolve) { fixtureServer.listen(0, '127.0.0.1', resolve); });
  const fixturePort = fixtureServer.address().port;
  const previous = process.env.DSH_LEARN_SEARCH_ENDPOINT;
  process.env.DSH_LEARN_SEARCH_ENDPOINT = 'http://127.0.0.1:' + fixturePort + '/search';
  try {
    const noQuery = await post('/api/search', {});
    assert.equal(noQuery.status, 400, '缺搜索词要 400');

    const searched = await (await post('/api/search', { query: 'kubectl', engine: 'custom', limit: 3 })).json();
    assert.equal(searched.ok, true, JSON.stringify(searched).slice(0, 200));
    assert.equal(searched.results.length, 1);
    assert.equal(searched.results[0].title, 'kubectl 参考');
    assert.ok(searched.results[0].url.indexOf('/docs/kubectl') > -1, searched.results[0].url);

    const analyzed = await (await post('/api/research', { query: 'kubectl', engine: 'custom', limit: 1 })).json();
    assert.equal(analyzed.ok, true);
    assert.equal(analyzed.fetched, 1, 'fixture 页面应当抓到');
    assert.ok((analyzed.tasks || []).length > 0, '应当给出可练题');
    assert.equal(analyzed.results[0].text, undefined, '回执里不该带整页原文');

    await post('/api/project', { action: 'init', name: 'search-api' });
    const ingested = await (await post('/api/research', { query: 'kubectl', engine: 'custom', limit: 1, project: 'search-api' })).json();
    assert.equal(ingested.ingested, 1, '要收进项目');
    assert.ok(ingested.index && ingested.index.points.length > 0, '回执里要给项目索引');
    const shown = await (await get('/api/project?name=search-api')).json();
    assert.equal(shown.sources.length, 1, '来源台账要记上一笔');
    assert.ok(shown.sources[0].artifacts.length >= 1, '产物文件名要写进台账');
  } finally {
    if (previous === undefined) delete process.env.DSH_LEARN_SEARCH_ENDPOINT;
    else process.env.DSH_LEARN_SEARCH_ENDPOINT = previous;
    await new Promise(function (resolve) { fixtureServer.close(resolve); });
  }
});

// 简历投递的 HTTP 层：增改删查 + JD 分析，以及校验失败要给人话（不是裸 HTTP 400）
test('GET/POST /api/jobs：增改删查与 JD 分析', async function () {
  const empty = await (await get('/api/jobs')).json();
  assert.equal(empty.jobs.length, 0, '一开始没有记录');
  assert.ok(empty.statuses.length === 5, '五种状态都要给出来：' + empty.statuses.length);

  const bad = await post('/api/jobs', { action: 'save', job: { company: '', position: '' } });
  assert.equal(bad.status, 400);
  const badBody = await bad.json();
  assert.ok(String(badBody.error || '').indexOf('公司名') > -1, '错误要写清哪个字段不对：' + JSON.stringify(badBody));

  const created = await (await post('/api/jobs', { action: 'save', job: {
    company: '某某科技', position: '运维工程师', status: 'applied',
    jd: '熟悉 Kubernetes 滚动发布与 Prometheus 告警'
  } })).json();
  assert.equal(created.ok, true);
  assert.equal(created.created, true);
  assert.equal(created.job.appliedAt.length, 10, '投出去要自动补日期：' + created.job.appliedAt);
  const jobId = created.job.id;

  const listing = await (await get('/api/jobs?status=applied')).json();
  assert.equal(listing.jobs.length, 1);
  assert.equal(listing.stats.byStatus.applied, 1);
  assert.equal(listing.jobs[0].updatedAt !== undefined, true);

  const analyzed = await (await post('/api/jobs', { action: 'analyze', id: jobId })).json();
  assert.equal(analyzed.ok, true);
  assert.ok(analyzed.analysis.points.length > 0, 'JD 应命中知识点');
  assert.ok(analyzed.job.analysis.tasks.length > 0, '分析结果要存进记录');

  const noJd = await post('/api/jobs', { action: 'save', job: { company: 'B', position: 'C' } });
  const noJdBody = await noJd.json();
  const noJdAnalyze = await post('/api/jobs', { action: 'analyze', id: noJdBody.job.id });
  assert.equal(noJdAnalyze.status, 400);
  assert.ok(String((await noJdAnalyze.json()).error).indexOf('没存 JD') > -1, '没 JD 要如实说');

  const updated = await (await post('/api/jobs', { action: 'save', job: { id: jobId, company: '某某科技', position: '高级运维工程师', status: 'interview' } })).json();
  assert.equal(updated.created, false);
  assert.equal(updated.job.status, 'interview');
  assert.equal(updated.stats.byStatus.interview, 1);
  assert.equal(updated.stats.byStatus.applied, 0, '状态改了，旧状态不再计数');

  const removed = await (await post('/api/jobs', { action: 'delete', id: jobId })).json();
  assert.equal(removed.deleted, true);
  assert.equal((await (await get('/api/jobs')).json()).jobs.length, 1, '删掉一条后只剩另一条');
  const missing = await post('/api/jobs', { action: 'delete', id: 'nope' });
  assert.equal(missing.status, 404);
});

test('GET /api/bootstrap 返回平台、轨道与全部题目', async function () {
  const data = await (await get('/api/bootstrap?platform=darwin')).json();
  assert.ok(data.tasks.length >= EXPECT.tasks, 'bootstrap 应返回全部题（含用户题库）：' + data.tasks.length);
  assert.deepEqual(data.tracks, EXPECT.trackList);
  assert.equal(data.platform, 'darwin');
  assert.ok(data.profile.tools);
  assert.ok(data.tasks.every(function (task) { return Array.isArray(task.require); }));
});

test('POST /api/check 判定并写入指定客户端', async function () {
  const data = await (await post('/api/check', {
    taskId: 'docker.run-web',
    answer: 'docker run -d -p 8080:80 --name web nginx:1.25',
    platform: 'darwin',
    clientId: 'web-test'
  })).json();
  assert.equal(data.result.verdict, '通过');
  assert.equal(data.result.score, 100);
  assert.ok(data.board.some(function (row) { return row.client === 'web-test'; }));
});

test('未知任务返回 404，非法 JSON 返回 400，超大请求体被拒绝', async function () {
  assert.equal((await post('/api/check', { taskId: 'nope' })).status, 404);
  assert.equal((await post('/api/check', null, '{not json')).status, 400);
  const huge = JSON.stringify({ taskId: 'nope', answer: 'x'.repeat(70000) });
  const tooBig = await post('/api/check', null, huge);
  assert.equal(tooBig.status, 413, '超大请求体应返回 413 而不是断开连接');
  assert.match((await tooBig.json()).error, /请求体过大/);
  assert.equal((await get('/api/does-not-exist')).status, 404);
});

test('POST /api/verify 默认 dry-run，docker 后端不可用时如实降级', async function () {
  const dry = await (await post('/api/verify', { taskId: 'linux.platform-probe', platform: 'darwin' })).json();
  assert.equal(dry.verify.ran, false);
  assert.equal(dry.verify.dryRun, true);

  const docker = await (await post('/api/verify', {
    taskId: 'docker.context-diagnose',
    platform: 'darwin',
    runner: 'docker',
    run: true
  })).json();
  assert.equal(docker.verify.runner, 'docker');
  if (!docker.verify.ran) assert.match(docker.verify.reason, /守护进程|白名单|镜像/);
});

test('POST /api/plan、GET /api/progress、GET /api/board、GET /api/runners 结构正确', async function () {
  const plan = await (await post('/api/plan', { hoursPerDay: 2, track: 'git', platform: 'darwin' })).json();
  assert.equal(plan.plan.taskCount, EXPECT.byTrack.git);
  assert.ok(plan.plan.days.length >= 1);

  const progress = await (await get('/api/progress')).json();
  // 运行时题库 = 内置 + 用户题库目录里的包，所以是下限而不是等号
  assert.ok(progress.summary.total >= EXPECT.tasks, '进度里的题目总数不应少于内置题库：' + progress.summary.total);
  assert.ok(progress.summary.passed >= 1);
  assert.ok(progress.summary.byTrack.length === EXPECT.tracks, '每条轨道都应出现在分轨道进度里');

  const board = await (await get('/api/board')).json();
  assert.ok(Array.isArray(board.board));

  const runners = await (await get('/api/runners')).json();
  assert.deepEqual(runners.runners.map(function (row) { return row.name; }), ['local', 'docker', 'remote']);
});

test('PWA 资源可访问，图标路径做了防穿越', async function () {
  const manifest = await get('/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.ok(manifest.headers.get('content-type').indexOf('manifest+json') > -1, 'Content-Type 应为 manifest+json');
  const payload = await manifest.json();
  assert.equal(payload.display, 'standalone');
  assert.ok(payload.icons.length >= 2);
  assert.ok(payload.start_url.indexOf('/') === 0, 'start_url 应是站内路径');

  const sw = await get('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  assert.equal(sw.headers.get('service-worker-allowed'), '/');
  const swText = await sw.text();
  assert.ok(swText.indexOf('/api/') > -1, 'Service Worker 必须区分接口与静态外壳');
  assert.ok(swText.indexOf('dsh-learn-shell') > -1);

  const icon = await get('/icons/icon-192.png');
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/png');
  assert.ok((await icon.arrayBuffer()).byteLength > 500, '图标应是真实 PNG');

  assert.equal((await get('/icons/../src/web/server.mjs')).status, 404);
  assert.equal((await get('/icons/evil.png')).status, 404);
  assert.equal((await get('/icons/icon-abc.png')).status, 404);
});

test('首页引用了 PWA 资源，逻辑拆在 /app.mjs', async function () {
  const html = await (await get('/')).text();
  ['/manifest.webmanifest', '/icons/icon-192.png', 'apple-touch-icon', 'theme-color',
    'col-left', 'col-center', 'col-right', '@media (max-width: 700px)', 'src="/app.mjs"'].forEach(function (needle) {
    assert.ok(html.indexOf(needle) > -1, '首页应包含 ' + needle);
  });
  const app = await (await get('/app.mjs')).text();
  ['serviceWorker', 'dsh-learn-offline-queue', 'dsh-learn-verify-cache', '/core/judge.mjs'].forEach(function (needle) {
    assert.ok(app.indexOf(needle) > -1, 'app.mjs 应包含 ' + needle);
  });
});

test('判定内核以 ES 模块提供给浏览器，bootstrap 下发规则（离线可判分）', async function () {
  const mod = await get('/core/judge.mjs');
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-type'), /javascript/);
  const source = await mod.text();
  assert.ok(source.indexOf('export function judge') > -1, '应导出 judge');
  assert.ok(source.indexOf('expandShortFlags') > -1);
  assert.ok(source.indexOf('ruleMatches') > -1, '大小写规则应包含在内核里');

  // 目录穿越与非法模块名一律拒绝
  assert.equal((await get('/core/../package.json')).status, 404);
  assert.equal((await get('/core/judge.txt')).status, 404);
  assert.equal((await get('/core/nope.mjs')).status, 404);

  const data = await (await get('/api/bootstrap?platform=darwin')).json();
  const task = data.tasks.filter(function (item) { return item.id === 'docker.run-web'; })[0];
  assert.ok(task.rules, '每道题都应带规则');
  assert.ok(task.rules.require.length >= 4);
  assert.ok(task.rules.require.every(function (rule) { return rule.p && rule.tip; }));
  assert.ok(Array.isArray(task.rules.forbid));
});

test('GET /api/progress 带每题的掌握状态（左栏列表用）', async function () {
  await post('/api/check', { taskId: 'git.switch-create', answer: 'git switch -c feature/report', platform: 'darwin', clientId: 'web-test' });
  const data = await (await get('/api/progress')).json();
  assert.ok(data.byTask, '应返回 byTask');
  const row = data.byTask['git.switch-create'];
  assert.equal(row.best, 100);
  assert.equal(row.attempts, 1);
  assert.equal(row.lastVerdict, '通过');
  assert.ok(data.summary.total >= 80);
});

test('GET /app.mjs 提供网页版逻辑，/api/progress 下发判定阈值', async function () {
  const res = await get('/app.mjs');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  const source = await res.text();
  assert.ok(source.indexOf('localJudge') > -1);
  assert.ok(source.indexOf("'/core/judge.mjs'") > -1, 'app.mjs 应动态导入判定内核');
  assert.ok(source.indexOf('>= 100') === -1, '页面不该再写死通过阈值');
  // 服务端把真实版本注入外壳脚本：页面据此判断"我这份是旧外壳"，进而更新 SW 并重载一次
  assert.ok(source.indexOf("const SCRIPT_VERSION = '__VERSION__'") === -1, 'app.mjs 里不该留着版本占位符');
  assert.match(source, /const SCRIPT_VERSION = '\d+\.\d+\.\d+';/, '应注入成真实版本号，实际未找到');

  const progress = await (await get('/api/progress')).json();
  assert.equal(progress.passScore, 100);
  assert.equal(progress.partialScore, 60);
  assert.ok(progress.storage, '进度接口应带存储健康度');
  assert.equal(progress.storage.recoveredFromBackup, false);
  assert.equal(progress.storage.brokenJournalLines, 0);
});

test('复习队列：GET /api/review 给出到期与之后到期的题', async function () {
  await post('/api/check', { taskId: 'linux.sed-inplace', answer: "sed -i 's/foo/bar/g' a.txt", platform: 'darwin', clientId: 'web-test' });

  const data = await (await get('/api/review?limit=3')).json();
  assert.ok(Array.isArray(data.due));
  assert.ok(Array.isArray(data.upcoming));
  assert.equal(data.track, 'all');
  const all = data.due.concat(data.upcoming);
  assert.ok(all.length >= 1, '刚练过的题应进入排期');
  assert.ok(all.every(function (row) { return row.taskId && row.dueAt && typeof row.intervalDays === 'number'; }));

  const shellOnly = await (await get('/api/review?track=shell')).json();
  assert.equal(shellOnly.track, 'shell');
  assert.ok(shellOnly.due.concat(shellOnly.upcoming).every(function (row) { return row.track === 'shell'; }));
});

test('学习目标：GET /api/goal 与 POST /api/goal 往返', async function () {
  const before = await (await get('/api/goal')).json();
  assert.ok(before.goal);
  assert.ok(before.progress.date);
  assert.ok(before.path.indexOf('goals.json') > -1);

  const saved = await (await post('/api/goal', { dailyTasks: 2, dailyMinutes: 15 })).json();
  assert.equal(saved.goal.dailyTasks, 2);
  assert.equal(saved.goal.dailyMinutes, 15);
  assert.equal(saved.progress.tasksTarget, 2);

  const after = await (await get('/api/goal')).json();
  assert.equal(after.goal.dailyTasks, 2);
  assert.ok(after.progress.summary.indexOf('今日通过') > -1);

  const progress = await (await get('/api/progress')).json();
  assert.equal(progress.goal.tasksTarget, 2, '进度接口也应带上今日目标');
});

test('题目笔记：GET /api/note 与 POST /api/note 增删', async function () {
  const empty = await (await get('/api/note?taskId=docker.run-web')).json();
  assert.equal(empty.note, null);

  const saved = await (await post('/api/note', { taskId: 'docker.run-web', text: '-d 是后台运行' })).json();
  assert.equal(saved.deleted, false);
  assert.equal(saved.note.text, '-d 是后台运行');

  const read = await (await get('/api/note?taskId=docker.run-web')).json();
  assert.equal(read.note.text, '-d 是后台运行');

  const all = await (await get('/api/note')).json();
  assert.equal(Object.keys(all.notes).length, 1);
  assert.ok(all.path.indexOf('notes.json') > -1);

  const removed = await (await post('/api/note', { taskId: 'docker.run-web', text: '   ' })).json();
  assert.equal(removed.deleted, true);
  assert.equal((await (await get('/api/note')).json()).notes['docker.run-web'], undefined);

  assert.equal((await post('/api/note', { taskId: 'no.such-task', text: 'x' })).status, 404);
});

test('POST /api/analyze 分析 JD 文本，GET /api/knowledge 给出字典', async function () {
  const res = await (await post('/api/analyze', { text: '熟悉 Python 虚拟环境与依赖管理；会用 tcpdump 抓包；了解 YOLO 训练' })).json();
  assert.equal(res.ok, true);
  assert.equal(res.source, 'text');
  assert.ok(res.report.matched >= 3, '应命中至少 3 个知识点：' + res.summaryText);
  assert.ok(res.report.tasks.length >= 3, '应给出推荐题目');
  assert.ok(res.report.tasks.every(function (row) { return row.taskId; }));
  assert.match(res.summaryText, /识别出/);

  const bad = await post('/api/analyze', {});
  assert.equal(bad.status, 400, 'text/url/image 都不给时应报 400');

  const urlFail = await (await post('/api/analyze', { url: 'ftp://nope' })).json();
  assert.equal(urlFail.ok, false);
  assert.match(urlFail.reason, /只支持 http\/https/);

  const dict = await (await get('/api/knowledge')).json();
  assert.ok(dict.points.length >= 60, '字典条目数：' + dict.points.length);
  assert.ok(dict.modules.some(function (m) { return m.id === 'python'; }));
  assert.ok(dict.points.every(function (point) { return point.id && point.module && point.name; }));
});

test('项目截图上传：走同一套 8MB 上限，并且真的 OCR 出知识点（网页版与原生端都走这条路）', async function () {
  const fixture = join(process.cwd(), 'docs/evidence/terminal-note-screenshot.png');
  if (!existsSync(fixture) || process.platform !== 'darwin') {
    assert.ok(true, '跳过：没有截图夹具或不是 macOS');
    return;
  }
  const png = readFileSync(fixture);
  const dataUrl = 'data:image/png;base64,' + png.toString('base64');
  // base64 会放大 4/3：58KB 的 PNG 传到服务端就是 78KB 的请求体，正好越过全局 64KB 上限
  assert.ok(dataUrl.length > 65536, '这条用例必须真的越过 64KB 全局上限，否则测不出回归：' + dataUrl.length);
  // 带上原文件名：服务端要给 notes/ 与 drafts/ 里的产物起名，而不是留一个 OCR 临时文件名
  const res = await post('/api/project', { name: 'shot-api-test', dataUrl: dataUrl, fileName: '终端记录截图.png' });
  assert.equal(res.status, 200, '真实截图不该被 413 拦下（这条曾经真的坏了：只有 /api/analyze 放大了上限）');
  const body = await res.json();
  assert.ok(body.knowledge.matched > 0, 'OCR 后应命中知识点：' + body.knowledge.matched);
  assert.ok(body.tasks > 0, '截图里的命令应出草案题：' + body.tasks);
  // 产物名要用上传时的文件名，而不是 OCR 临时文件名（dsh-learn-ocr-1790486590）
  assert.ok(body.artifacts.some(function (rel) { return rel.indexOf('终端记录截图') > -1; }),
    '产物名应带上原文件名：' + JSON.stringify(body.artifacts));
  assert.equal(body.artifacts.some(function (rel) { return /dsh-learn-ocr-\d+/.test(rel); }), false,
    '不该把 OCR 临时文件名留给用户：' + JSON.stringify(body.artifacts));

  // 上限仍然存在：超过 8MB 继续拒绝，别把"能传截图"变成"能传任意大文件"
  const huge = JSON.stringify({ name: 'shot-api-test', dataUrl: 'data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024) });
  const tooBig = await post('/api/project', null, huge);
  assert.equal(tooBig.status, 413, '超过 8MB 仍应 413');
});

test('草案接口不接受路径（越界读文件要 400，草案 id 里的 ../ 也写不出去）', async function () {
  const traversal = await post('/api/draft', { project: 'api-test', file: '../../../../../../../etc/hosts', dryRun: true });
  assert.equal(traversal.status, 400, '带路径的 file 参数应被拒绝，而不是去读项目目录外的文件');
  assert.match((await traversal.json()).error, /文件名不合法/);

  // 草案 id 是文件内容（用户可控）：让它试着把 promoted 目标写到项目目录之外
  const evil = {
    id: '../../../../tmp/dsh-learn-escape-' + Date.now(),
    track: 'demo',
    tasks: [{
      id: 'demo.x', track: 'demo', title: 't', goal: 'g',
      require: [{ p: 'echo', tip: 'x' }, { p: 'hi', tip: 'x' }], sample: 'echo hi'
    }]
  };
  const home = process.env.DSH_LEARN_HOME;
  const draftsDir = join(home, 'projects', 'api-test', 'drafts');
  writeFileSync(join(draftsDir, 'evil.json'), JSON.stringify(evil));
  const res = await post('/api/draft', { project: 'api-test', file: 'evil.json', dryRun: false, force: true });
  assert.equal(res.status, 200, '预览/转正流程本身应正常走完');
  const body = await res.json();
  assert.ok(String(body.target || '').indexOf(join(home, 'projects', 'api-test', 'promoted')) === 0,
    'promoted 目标必须留在项目目录内：' + body.target);
  const stray = readdirSync('/tmp').filter(function (name) { return name.indexOf('dsh-learn-escape-') === 0; });
  assert.deepEqual(stray, [], '不该在项目目录外留下逃逸文件：' + stray.join(','));
});

test('批量导入备份：几百条记录（>64KB）不该被 413 顶回来，超大仍要拦住', async function () {
  const records = [];
  for (let i = 0; i < 800; i += 1) {
    records.push({
      taskId: 'docker.run-web',
      client: 'bulk-import-test',
      score: 100,
      verdict: '通过',
      answer: 'docker run -d -p 8080:80 --name web nginx:1.25',
      platform: 'darwin',
      at: new Date(Date.now() - i * 1000).toISOString()
    });
  }
  const body = JSON.stringify({ records: records });
  assert.ok(body.length > 65536, '这条用例必须真的越过 64KB 全局上限：' + body.length);
  const res = await post('/api/import', null, body);
  assert.equal(res.status, 200, '一次导入几百条记录应被接受（离线队列补传也走这里）');
  const payload = await res.json();
  assert.equal(payload.import.added, 800, '应真的写进去 800 条：' + payload.import.added);

  const huge = JSON.stringify({ records: [{ taskId: 'x', answer: 'A'.repeat(9 * 1024 * 1024) }] });
  const tooBig = await post('/api/import', null, huge);
  assert.equal(tooBig.status, 413, '超过大请求体上限仍应 413');
});

test('截图上传走的是更大的请求体上限（100KB+ 的 base64 不该被 413 拦下）', async function () {
  // 1x1 PNG 的 base64 只有几十字节，这里用注释式填充把它撑到 100KB 以上，模拟真实截图
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const padded = 'data:image/png;base64,' + png + 'A'.repeat(140000);
  const res = await post('/api/analyze', { image: padded });
  assert.equal(res.status, 200, '图片请求体应被接受（上限 8MB），而不是 413');
  const body = await res.json();
  // 这张图里没有文字，OCR 会如实失败；关键是"请求被受理了"这条链路
  assert.equal(typeof body.ok, 'boolean');
});

test('bootstrap 会带上"别的平台怎么写"（变体题才有，普通题不带）', async function () {
  const boot = await (await get('/api/bootstrap?platform=darwin')).json();
  const variant = boot.tasks.find(function (t) { return t.id === 'netops.ping-mtu-discovery'; });
  assert.ok(variant, '应有这道变体题');
  assert.equal(variant.others.linux, 'ping -M do -s 1472 -c 3 10.0.0.1', '别的平台写法要一起下发：' + JSON.stringify(variant.others));
  assert.equal(variant.others.darwin, undefined, '当前平台不该重复下发自己那条');

  const plain = boot.tasks.find(function (t) { return t.id === 'docker.run-web'; });
  assert.ok(!plain.others, '没有变体的题不该带这个字段');

  const linuxBoot = await (await get('/api/bootstrap?platform=linux')).json();
  assert.equal(linuxBoot.tasks.find(function (t) { return t.id === 'netops.ping-mtu-discovery'; }).others.darwin,
    'ping -D -s 1472 -c 3 10.0.0.1', '换平台后对比项也要跟着换');
});

// 题目声明 platforms（只在某些平台上成立）时，接口要把「当前平台算不算数」说清楚：
// 否则学员在 Windows 上练到一道只写了 macOS/Linux 参考答案的题，只看得到「未通过」，
// 会以为自己的写法错了，而不是「这道题不覆盖 Windows」。
test('bootstrap 会带上 supported：声明了 platforms 的题在当前平台不算数', async function () {
  const darwinBoot = await (await get('/api/bootstrap?platform=darwin')).json();
  const onDarwin = darwinBoot.tasks.find(function (t) { return t.id === 'service.launchctl-list'; });
  assert.equal(onDarwin.supported, true, 'darwin 在声明范围内');
  assert.deepEqual(onDarwin.taskPlatforms, ['darwin', 'linux']);

  const winBoot = await (await get('/api/bootstrap?platform=win32')).json();
  const onWin = winBoot.tasks.find(function (t) { return t.id === 'service.launchctl-list'; });
  assert.equal(onWin.supported, false, 'win32 不在声明范围内，页面据此提示');
  assert.deepEqual(onWin.taskPlatforms, ['darwin', 'linux'], '要带上题目自己声明的平台，页面才能口语化地说明白');

  const plain = winBoot.tasks.find(function (t) { return t.id === 'docker.run-web'; });
  assert.equal(plain.supported, true, '没声明 platforms 的题在哪个平台都算数');
  assert.equal(plain.taskPlatforms, null);
});
// 不适用的平台上一律不判分、不记录，也不允许客户端"退化成兜底判分"：
// 兜底规则可能是本平台根本不存在的命令（Windows 上判 launchctl），判 100 分等于教错。
// 离线外壳的清单必须逐条取得到：SW 的 install 是「逐个下载、失败就跳过」，
// 清单里有一个 404 不会报错，只会让离线打开时少一块——比整块失效更难发现。
// 这里把清单当契约来验：每个路径都要 200，且 sw.js 里的版本号必须被替换成当前版本
// （不替换的话发版后清不掉旧缓存桶，用户会一直看到上一版页面）。
test('离线外壳清单里的每个资源都能取到，且 sw.js 打上了当前版本', async function () {
  const { APP_VERSION } = await import('../src/web/static.mjs');
  const sw = await (await get('/sw.js')).text();
  assert.equal(sw.indexOf('__VERSION__'), -1, 'sw.js 里的 __VERSION__ 没被替换');
  assert.ok(sw.indexOf('dsh-learn-shell-' + APP_VERSION) > -1, '缓存名要带当前版本 ' + APP_VERSION);

  const block = (sw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
  const paths = (block.match(/'([^']+)'/g) || []).map(function (row) { return row.slice(1, -1); });
  assert.ok(paths.length >= 8, '外壳清单太短，离线会缺东西：' + JSON.stringify(paths));
  assert.ok(paths.indexOf('/core/judge.mjs') > -1, '离线判定要缓存判定内核 judge.mjs');
  for (const path of paths) {
    const res = await get(path);
    assert.equal(res.status, 200, '外壳资源 ' + path + ' 取不到（离线时会静默少一块）');
  }
});
test('POST /api/check 在平台不适用的题上拒绝判定，并且不写进度', async function () {
  const res = await post('/api/check', { taskId: 'service.launchctl-list', answer: 'launchctl list', platform: 'win32' });
  assert.equal(res.status, 400, '应拒绝而不是给个分数');
  const body = await res.json();
  assert.equal(body.platformUnsupported, true);
  assert.match(body.error, /只在 darwin \/ linux 上有参考答案/);

  const rows = await (await get('/api/history?taskId=service.launchctl-list')).json();
  assert.equal((rows.records || []).length, 0, '被拦下的请求不该留下记录：' + JSON.stringify(rows.records));

  // darwin 上同一道题照常判（规则本来就属于这个平台）
  const ok = await post('/api/check', { taskId: 'service.launchctl-list', answer: 'launchctl list', platform: 'darwin' });
  assert.equal(ok.status, 200);
  assert.equal(typeof (await ok.json()).result.score, 'number');
});

test('POST /api/check 返回历史对比字段（与 CLI 的 check 同一套语义）', async function () {
  // 用本文件其它用例没提交过的题，才能稳定断言"第一次"
  const TASK = 'git.blame-range';
  const GOOD = 'git blame -L 10,20 src/app.js';
  const HALF = 'git blame src/app.js';

  const first = await (await post('/api/check', { taskId: TASK, answer: GOOD, clientId: 'compare-test' })).json();
  assert.equal(first.result.score, 100);
  assert.equal(first.attempts, 1, '第一次应是 1');
  assert.equal(first.previousBest, null, '第一次没有历史最好成绩');
  assert.equal(first.delta, null);

  const worse = await (await post('/api/check', { taskId: TASK, answer: HALF, clientId: 'compare-test' })).json();
  assert.equal(worse.attempts, 2);
  assert.equal(worse.previousBest, 100, '上次最好就是第一次的满分');
  assert.equal(worse.delta, worse.result.score - worse.previousBest, 'delta 必须等于本次减上次最好');
  assert.ok(worse.delta < 0, '这次分数更低，delta 应为负');
});

test('GET /api/drill?tasks=... 按给定清单返回（分析结果可以直接开练）', async function () {
  const res = await (await get('/api/drill?tasks=netops.iperf3,python.venv,does.not.exist&limit=5')).json();
  assert.equal(res.mode, 'analyze');
  assert.deepEqual(res.practice.map(function (row) { return row.taskId; }), ['netops.iperf3', 'python.venv'], '顺序应与清单一致，且忽略不存在的题');
  assert.ok(res.practice.every(function (row) { return row.reason === '来自分析清单'; }));
});

test('GET /api/daily 给出每日一题，同一天稳定', async function () {
  const first = await (await get('/api/daily?platform=darwin')).json();
  assert.ok(first.daily, '应有每日一题');
  assert.ok(first.daily.taskId);
  assert.ok(first.daily.goal, '应带上目标');
  assert.ok(first.daily.hint !== undefined);
  assert.match(first.daily.date, /^\d{4}-\d{2}-\d{2}$/);

  const again = await (await get('/api/daily?platform=darwin')).json();
  assert.equal(again.daily.taskId, first.daily.taskId, '同一天必须稳定');

  const shellOnly = await (await get('/api/daily?track=shell&platform=linux')).json();
  assert.equal(shellOnly.daily.track, 'shell');
  assert.equal(shellOnly.track, 'shell');
});

test('GET /api/report 返回 Markdown 学习报告', async function () {
  const res = await get('/api/report');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /markdown/);
  const text = await res.text();
  ['# dsh-learn 学习报告', '## 分轨道进度', '## 客户端排行', '连续学习'].forEach(function (needle) {
    assert.ok(text.indexOf(needle) > -1, '报告缺少 ' + needle);
  });
});

test('GET /api/progress 带连续学习天数', async function () {
  const data = await (await get('/api/progress')).json();
  assert.equal(typeof data.streak, 'number');
  assert.ok(data.streak >= 1, '刚才提交过记录，连续天数至少是 1');
});

test('GET /api/history 按题目与客户端过滤，最新在前', async function () {
  await post('/api/check', { taskId: 'git.switch-create', answer: 'git switch -c feature/report', platform: 'darwin', clientId: 'web-test' });

  const all = await (await get('/api/history?limit=5')).json();
  assert.ok(all.history.length >= 1);
  assert.ok(all.totalRecords >= 2);
  const times = all.history.map(function (row) { return row.at; });
  assert.deepEqual(times, times.slice().sort().reverse(), '历史应按时间倒序');

  const one = await (await get('/api/history?taskId=git.switch-create')).json();
  assert.ok(one.history.length >= 1);
  assert.ok(one.history.every(function (row) { return row.taskId === 'git.switch-create'; }));
  assert.equal(one.history[0].verdict, '通过');
  assert.match(one.history[0].answer, /git switch/);

  const other = await (await get('/api/history?clientId=someone-else')).json();
  assert.equal(other.history.length, 0);
});

test('GET /api/drill 返回带权重的练习建议', async function () {
  // 先制造一道没满分的题
  await post('/api/check', { taskId: 'linux.stat-size', answer: "stat -c '%s' a.txt", platform: 'darwin', clientId: 'web-test' });

  const weak = await (await get('/api/drill?mode=weak&limit=3')).json();
  assert.equal(weak.mode, 'weak');
  assert.ok(weak.practice.length >= 1);
  const top = weak.practice[0];
  assert.equal(top.taskId, 'linux.stat-size', '刚练错的题应排最前');
  assert.ok(top.weight > 0);
  assert.match(top.reason, /最高 3 分/);
  assert.ok(top.goal && typeof top.requireCount === 'number');
  assert.ok(top.weight >= (weak.practice[1] ? weak.practice[1].weight : 0));

  const all = await (await get('/api/drill?mode=all&limit=2&track=docker')).json();
  assert.equal(all.practice.length, 2);
  assert.ok(all.practice.every(function (row) { return row.track === 'docker'; }));

  const fresh = await (await get('/api/drill?mode=new&limit=2')).json();
  assert.equal(fresh.mode, 'new');
  assert.ok(fresh.practice.every(function (row) { return row.attempts === 0; }));
});

test('进度导出后原样导入被去重，并返回合并统计（备份也要带笔记与目标）', async function () {
  // 网页版导出是"整份搬走"：先写一条笔记与一个目标，备份里就该有它们
  await post('/api/note', { taskId: 'docker.run-web', text: '导出备份用：-d 后台运行' });
  await post('/api/goal', { dailyTasks: 2, dailyMinutes: 15 });

  const exported = await (await get('/api/export')).json();
  assert.equal(exported.version, 2, '备份版本升到 2：多了 notes / goals 两个字段');
  assert.ok(exported.records.length >= 1);
  assert.equal(exported.notes['docker.run-web'].text, '导出备份用：-d 后台运行', '笔记要进备份');
  assert.equal(exported.goals.dailyTasks, 2, '学习目标要进备份');

  const imported = await (await post('/api/import', exported)).json();
  assert.equal(imported.import.added, 0);
  assert.equal(imported.import.skipped, exported.records.length);
  assert.equal(imported.import.goals, false, '本机已设目标时不该被备份改掉');

  // 清理：别把这条笔记留给后面的用例
  await post('/api/note', { taskId: 'docker.run-web', text: '' });
});

test('--port 0 由内核挑端口并打印 DSH_LEARN_URL（macOS 桌面壳依赖这个契约）', async function () {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const child = spawn(process.execPath, [join(root, 'src/web/server.mjs'), '--host', '127.0.0.1', '--port', '0'], {
    cwd: root,
    env: Object.assign({}, process.env, { DSH_LEARN_HOME: HOME })
  });

  const url = await new Promise(function (resolve, reject) {
    let buffer = '';
    const timer = setTimeout(function () { reject(new Error('8 秒内没有打印 DSH_LEARN_URL：' + buffer)); }, 8000);
    child.stdout.on('data', function (chunk) {
      buffer += chunk.toString();
      const line = buffer.split('\n').filter(function (item) { return item.indexOf('DSH_LEARN_URL=http://') === 0; })[0];
      if (line) {
        clearTimeout(timer);
        resolve(line.trim().split('=').slice(1).join('='));
      }
    });
    child.on('error', reject);
  });

  assert.ok(url.indexOf('http://127.0.0.1:') === 0, '应打印 127.0.0.1 的地址，实际 ' + url);
  const port = Number(url.split(':').pop());
  assert.ok(port > 1024, '应是内核分配的临时端口，实际 ' + port);
  const data = await (await fetch(url + '/api/bootstrap?platform=darwin')).json();
  assert.ok(data.tasks.length >= EXPECT.tasks, 'bootstrap 应返回全部题（含用户题库）：' + data.tasks.length);

  child.kill('SIGTERM');
  await new Promise(function (resolve) { child.on('exit', resolve); });
  assert.ok(child.exitCode !== null || child.signalCode === 'SIGTERM', '子进程应已退出（exitCode 或 signalCode 至少有一个）');
});

test.after(async function () {
  await new Promise(function (resolve) { server.close(resolve); });
  rmSync(HOME, { recursive: true, force: true });
});

// 项目检索的接口面（网页与原生端都走它）
test('GET /api/project 支持 q / missingText / sort，并回报命中说明与缺原文数', async function () {
  await post('/api/project', { action: 'init', name: 'search-demo' });
  const all = await (await get('/api/project')).json();
  assert.ok(all.total >= 1, '至少有一个项目：' + JSON.stringify(all).slice(0, 120));
  assert.equal(all.filtered, all.projects.length);
  const hit = await (await get('/api/project?q=search-demo')).json();
  assert.equal(hit.filtered, 1, '应当只命中刚建的项目：' + JSON.stringify(hit.filters));
  assert.equal(hit.filters.query, 'search-demo');
  assert.ok(hit.projects[0].match.indexOf('项目名') > -1, '要说明为什么命中：' + JSON.stringify(hit.projects[0].match));
  const miss = await (await get('/api/project?q=绝对不存在的项目名')).json();
  assert.equal(miss.filtered, 0);
  assert.equal(miss.total, all.total, 'total 不受筛选影响');
  const missing = await (await get('/api/project?missingText=1')).json();
  assert.ok(missing.filtered <= missing.total);
  missing.projects.forEach(function (row) { assert.ok(row.missingText > 0, '只看缺原文时每行都该有缺失：' + JSON.stringify(row)); });
  const sorted = await (await get('/api/project?sort=name')).json();
  const names = sorted.projects.map(function (row) { return row.name; });
  // 用与实现相同的排序口径比较（localeCompare 对大小写不敏感，与 JS 默认码点排序不同）
  assert.deepEqual(names, names.slice().sort(function (a, b) { return String(a).localeCompare(String(b)); }), '按名称排序');
});


// 运行指标：请求打过之后，/api/metrics 要能给出请求量与本地数据量（网页版与原生端未来都读它）
test('GET /api/metrics 给出请求量、延迟与本地数据量', async function () {
  await get('/api/bootstrap');
  const res = await get('/api/metrics?limit=100');
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
  assert.ok(payload.summary.http.requests >= 1, '至少统计到刚打的那次请求：' + JSON.stringify(payload.summary.http));
  assert.ok(payload.counts.tasks > 0, '题目数是本地数据的一部分');
  assert.ok(typeof payload.logs.file === 'string' && payload.logs.file.length > 0);
  assert.ok(Number(payload.uptimeSec) >= 0);
});

test('契约里的每个 action 都能被执行到（不允许 is not defined 这类运行时缺导入）', async function () {
  const contract = JSON.parse(readFileSync(new URL('../docs/api-contract.json', import.meta.url), 'utf8'));
  const bodies = {
    init: { name: 'smoke-proj' },
    backfill: {},
    index: { name: 'smoke-proj' },
    tasks: { name: 'smoke-proj' },
    drill: { project: 'smoke-proj' },
    jdplan: { project: 'smoke-proj', text: '要求熟悉 git' },
    refresh: { name: 'smoke-proj' },
    rename: { name: 'smoke-proj', to: 'smoke-proj-2' },
    delete: { id: 'nope' },
    new: { id: 'smoke-pack' },
    validate: { pack: { id: 'smoke', track: 'linux', tasks: [] } },
    analyze: { id: 'nope' },
    resume: {},
    recommend: { text: '招聘 Linux 运维' },
    collect: { text: '招聘 PostgreSQL 工程师' },
    apply: { id: 'nope' },
    pack: {},
    build: {}
  };
  const routes = {
    '/api/check': 'POST', '/api/verify': 'POST', '/api/describe': 'POST', '/api/understand': 'POST',
    '/api/plan': 'POST', '/api/note': 'POST', '/api/goal': 'POST', '/api/jobs': 'POST', '/api/flow': 'POST',
    '/api/project': 'POST', '/api/pack': 'POST', '/api/import': 'POST', '/api/ocr': 'POST', '/api/search': 'POST'
  };
  const problems = [];
  for (const row of contract.actions) {
    const path = row.route.split(' ')[0];
    const body = Object.assign({ action: row.name }, bodies[row.name] || {});
    const res = await post(path, body);
    const text = await res.text();
    if (text.indexOf('is not defined') > -1) problems.push(path + ' action=' + row.name + ' → ' + text.slice(0, 120));
  }
  for (const path of Object.keys(routes)) {
    const res = await post(path, {});
    const text = await res.text();
    if (text.indexOf('is not defined') > -1) problems.push(path + ' → ' + text.slice(0, 120));
  }
  assert.deepEqual(problems, [], '这些分支运行时缺导入：' + problems.join(' | '));
});

// 文字理解与识图能力的 HTTP 层：结构化结果要有依据，识图能力矩阵要如实。
