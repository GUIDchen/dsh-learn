// 存储 schema 版本化与迁移：旧形状能读、能检测、能 dry-run、能迁移、迁移后一致且幂等。
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-schema-'));
process.env.DSH_LEARN_HOME = home;
writeFileSync(join(home, 'progress.json'), JSON.stringify({ version: 1, records: [{ id: 'r1', taskId: 'go.env-check', score: 100 }] }));
writeFileSync(join(home, 'jobs.json'), JSON.stringify([{ id: 'j1', company: '甲', position: '运维', status: 'todo' }]));
writeFileSync(join(home, 'goals.json'), JSON.stringify({ dailyTasks: 3, dailyMinutes: 30 }));
const store = await import('../src/store.mjs');
const { detectStorage, migrateStorageValue } = await import('../src/core/storage-schema.mjs');

test('旧形状：能检测出需要迁移，而且不迁移也能照常读', function () {
  const report = store.storageStatus();
  assert.equal(report.ok, false);
  assert.equal(report.needsMigration.length, 3, JSON.stringify(report.needsMigration));
  assert.ok(report.needsMigration.some(function (x) { return x.indexOf('jobs v1 → v2') > -1; }), JSON.stringify(report.needsMigration));
  // 读侧兼容：迁移前旧文件也能用
  assert.equal(store.load().records.length, 1);
  assert.equal(store.readJobs().length, 1);
  assert.equal(store.readGoals().dailyTasks, 3);
});

test('dry-run：只出计划，不落盘', function () {
  const before = readFileSync(join(home, 'jobs.json'), 'utf8');
  const plan = store.migrateStorage({ dryRun: true });
  assert.equal(plan.dryRun, true);
  assert.deepEqual(plan.steps.map(function (s) { return s.action; }), ['would-migrate', 'would-migrate', 'would-migrate']);
  assert.equal(readFileSync(join(home, 'jobs.json'), 'utf8'), before, 'dry-run 不该改文件');
});

test('迁移：写新形状 + 留备份 + 记日志，读回数据一致', function () {
  const result = store.migrateStorage({});
  assert.deepEqual(result.steps.map(function (s) { return s.action; }), ['migrated', 'migrated', 'migrated']);
  const jobs = JSON.parse(readFileSync(join(home, 'jobs.json'), 'utf8'));
  assert.equal(jobs.version, 2, 'jobs.json 应当是带版本的对象');
  assert.equal(jobs.jobs.length, 1);
  const progress = JSON.parse(readFileSync(join(home, 'progress.json'), 'utf8'));
  assert.equal(progress.version, 2);
  const goals = JSON.parse(readFileSync(join(home, 'goals.json'), 'utf8'));
  assert.equal(goals.version, 1);
  assert.equal(existsSync(join(home, 'migrations.log')), true, '要留迁移日志');
  const backups = readdirSync(home).filter(function (n) { return n.indexOf('.bak-') > -1; });
  assert.ok(backups.length >= 3, '每份迁移前都要有 .bak 备份：' + backups.join(','));
  assert.equal(store.load().records.length, 1, '迁移后记录数不变');
  assert.equal(store.readJobs().length, 1, '迁移后岗位数不变');
  assert.equal(store.readGoals().dailyTasks, 3);
  assert.equal(store.storageStatus().ok, true, '迁移后应当是最新');
});

test('幂等：再迁移一次不会动任何文件', function () {
  const before = readFileSync(join(home, 'jobs.json'), 'utf8') + readFileSync(join(home, 'progress.json'), 'utf8');
  const again = store.migrateStorage({});
  assert.deepEqual(again.steps.map(function (s) { return s.action; }), ['ok', 'ok', 'ok']);
  assert.equal(readFileSync(join(home, 'jobs.json'), 'utf8') + readFileSync(join(home, 'progress.json'), 'utf8'), before);
});

test('坏形状不崩：jobs 对象里 jobs 不是数组时读回空数组', function () {
  writeFileSync(join(home, 'jobs.json'), JSON.stringify({ version: 2, jobs: 'oops' }));
  assert.deepEqual(store.readJobs(), []);
  const detected = detectStorage('jobs', { version: 2, jobs: 'oops' });
  assert.equal(detected.needsMigration, false, '版本够了就不再要求迁移（形状交给读侧兜底）');
});

test('迁移是纯函数可单测：四种输入都能给出确定结果', function () {
  assert.deepEqual(migrateStorageValue('jobs', [{ id: 'x' }], 'T').jobs, [{ id: 'x' }]);
  assert.equal(migrateStorageValue('jobs', { version: 1, jobs: [] }, 'T').version, 2);
  assert.equal(migrateStorageValue('progress', [], 'T').records.length, 0);
  assert.equal(migrateStorageValue('goals', { dailyTasks: -5 }, 'T').dailyTasks, 0, '负数夹取');
});

test.after(function () { rmSync(home, { recursive: true, force: true }); });
