// "项目 → 总题库"这条链路的护栏：项目目录里能加载题目与知识点、草案包能真的进总题库并被加载。
// 这组用例的由来：packs/ 里的包原先只有硬编码名单里的才被加载，于是"加入总题库"只是写了个
// 没人读的文件；项目目录里也没有可加载的题目索引，每次想看能练什么都要重新分析一遍。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-catalog-home-'));
process.env.DSH_LEARN_HOME = HOME;

const { loadLocalPacks, userPackDir } = await import('../src/core/packs.mjs');
const { detectBlockedPage } = await import('../src/core/ingest.mjs');
const project = await import('../src/core/project.mjs');
const { promoteDraft } = await import('../src/cli/commands/packs.mjs');

function demoPack(id, taskId) {
  return {
    id: id,
    name: '示例包',
    track: 'linux',
    tasks: [{
      id: taskId,
      track: 'linux',
      level: 'easy',
      title: '看看当前系统类型',
      goal: '输出系统类型',
      answer: 'uname -s',
      require: [{ p: 'uname', tip: 'uname' }, { p: '-s', tip: '-s' }, { p: '^\\s*uname\\s', tip: '开头就是 uname' }],
      hint: 'uname 加上打印系统名的参数'
    }]
  };
}

test('用户题库目录：包能被加载，且与随工具发布的 packs/ 分开', function () {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-local-packs-'));
  writeFileSync(join(dir, 'demo-local.json'), JSON.stringify(demoPack('demo-local', 'demo.local-echo')));
  const loaded = loadLocalPacks(dir);
  assert.deepEqual(loaded.map(function (p) { return p.id; }), ['demo-local']);
  assert.deepEqual(loadLocalPacks(join(dir, 'not-there')), [], '目录不存在时返回空数组而不是抛错');
  assert.deepEqual(loadLocalPacks(null), [], '没给目录时返回空数组');
  // 默认目录在用户 home 下，不在仓库里：升级工具不会覆盖用户加的题
  assert.equal(userPackDir({ home: '/tmp/some-home' }), '/tmp/some-home/packs');
  assert.equal(userPackDir({ localDir: '/tmp/explicit' }), '/tmp/explicit');
});

test('草案 promote 进总题库后，包能被加载出来（这条链路过去是断的）', function () {
  const packDir = mkdtempSync(join(tmpdir(), 'dsh-catalog-packs-'));
  const draft = demoPack('project-pay-gw', 'paygw.rollout');
  const moved = promoteDraft(draft, { into: join(packDir, 'project-pay-gw.json'), force: true });
  assert.deepEqual(moved.errors, [], 'promote 不该报错：' + JSON.stringify(moved.errors));
  assert.equal(moved.taskCount, 1);
  const loaded = loadLocalPacks(packDir);
  assert.deepEqual(loaded.map(function (p) { return p.id; }), ['project-pay-gw']);
  assert.deepEqual(loaded[0].tasks.map(function (t) { return t.id; }), ['paygw.rollout']);
  // 反过来：没 promote 时加载不到——证明上面那条不是因为别的路径碰巧加载了
  assert.deepEqual(loadLocalPacks(mkdtempSync(join(tmpdir(), 'dsh-empty-packs-'))), []);
});

test('项目索引：知识点 → 可练题 + 草案包，并标出是否已入总题库', function () {
  const name = 'catalog-demo';
  const created = project.createProject(name, { home: HOME });
  assert.equal(created.ok, true, JSON.stringify(created));
  // 直接写一份来源记账（模拟收过一次文字），知识点用真实字典里的 id
  const meta = project.readProject(name, { home: HOME });
  meta.sources = [{ kind: 'text', source: 'JD 文本', at: new Date().toISOString(), knowledge: 2, tasks: 0, points: ['k8s.workload', 'db.redis'] }];
  project.writeProject(name, meta, { home: HOME });
  // 再放两个草案包：一个已在总题库、一个还没
  const dir = project.projectDir(name, { home: HOME });
  mkdirSync(join(dir, 'drafts'), { recursive: true });
  writeFileSync(join(dir, 'drafts', 'a.json'), JSON.stringify(demoPack('catalog-a', 'catalog.a')));
  writeFileSync(join(dir, 'drafts', 'b.json'), JSON.stringify(demoPack('catalog-b', 'catalog.b')));
  const packDir = mkdtempSync(join(tmpdir(), 'dsh-catalog-packs2-'));
  writeFileSync(join(packDir, 'catalog-a.json'), JSON.stringify(demoPack('catalog-a', 'catalog.a')));

  const index = project.buildProjectIndex(name, { home: HOME, packDir: packDir });
  assert.ok(index.points.length >= 2, '至少要有两个知识点：' + JSON.stringify(index.points.map(function (p) { return p.id; })));
  assert.ok(index.tasks.length > 0, '知识点要映射出可练题');
  const byFile = {};
  index.drafts.forEach(function (row) { byFile[row.file] = row; });
  assert.equal(byFile['drafts/a.json'].inCatalog, true, 'a 已在总题库里要标 true');
  assert.equal(byFile['drafts/b.json'].inCatalog, false, 'b 还没进总题库');
  // 索引会落盘，之后 loadProjectTasks 直接读它（不用重新分析）
  const onDisk = JSON.parse(readFileSync(join(dir, 'tasks.json'), 'utf8'));
  assert.equal(onDisk.project, name);
  const loaded = project.loadProjectTasks(name, { home: HOME, packDir: packDir });
  assert.equal(loaded.tasks.length, index.tasks.length);
  assert.ok(loaded.points[0].name, '知识点要带名字，界面才能显示');
});

test('反爬识别：验证页 / JS 壳被拦下，长文档与普通命令不被误伤', function () {
  const challenge = detectBlockedPage('请稍候 - BOSS直聘 B O S S 正在加载中...', '<html><title>请稍候</title></html>');
  assert.ok(challenge, 'BOSS 那种加载中壳页要认出来');
  assert.ok(challenge.markers.length > 0);
  assert.equal(detectBlockedPage('本文讲接口怎么用验证码保护。'.repeat(200), ''), null, '长文档里提到验证码不算拦截');
  assert.equal(detectBlockedPage('kubectl rollout restart deployment/web', ''), null, '普通命令不算拦截');
  assert.ok(detectBlockedPage('安全验证', ''), '安全验证页要认出来');
});
