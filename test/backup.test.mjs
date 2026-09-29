// 整机备份/恢复：备什么、dry-run 不写、恢复能还原、覆盖前留后悔药。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { backupStatus, collectHome, createBackup, planBackup, planRestore, readBackup, restoreBackup, verifyBackup } = await import('../src/core/backup.mjs');

function seedHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-backup-'));
  mkdirSync(join(home, 'projects/demo/sources'), { recursive: true });
  mkdirSync(join(home, 'bin'), { recursive: true });
  mkdirSync(join(home, 'backups'), { recursive: true });
  writeFileSync(join(home, 'progress.json'), JSON.stringify({ version: 2, records: [{ id: 'r1', taskId: 'go.env-check', score: 100 }, { id: 'r2', taskId: 'git.version-check', score: 100 }] }));
  writeFileSync(join(home, 'jobs.json'), JSON.stringify({ version: 2, jobs: [{ id: 'j1', company: '甲' }] }));
  writeFileSync(join(home, 'goals.json'), JSON.stringify({ version: 1, dailyTasks: 3 }));
  writeFileSync(join(home, 'notes.json'), JSON.stringify({ 'go.env-check': '看 go env' }));
  writeFileSync(join(home, 'projects/demo/project.json'), JSON.stringify({ name: 'demo', sources: [] }));
  writeFileSync(join(home, 'projects/demo/sources/0001-a.txt'), '招聘 Go 工程师，熟悉 docker build');
  writeFileSync(join(home, 'bin/dsh-ocr'), 'BINARY-SHOULD-NOT-BACKUP');
  writeFileSync(join(home, 'backups/old.json'), 'SHOULD-NOT-BACKUP');
  writeFileSync(join(home, 'progress.json.bak-123'), 'BACKUP-COPY-SHOULD-BE-EXCLUDED');
  return home;
}

test('备份清单：只收用户资产，排除 bin/backups/.bak', function () {
  const home = seedHome();
  const rows = collectHome(home);
  const rels = rows.map(function (r) { return r.rel; });
  assert.ok(rels.indexOf('progress.json') > -1 && rels.indexOf('jobs.json') > -1 && rels.indexOf('goals.json') > -1 && rels.indexOf('notes.json') > -1, rels.join(','));
  assert.ok(rels.indexOf('projects/demo/project.json') > -1, '项目元数据要备');
  assert.ok(rels.indexOf('projects/demo/sources/0001-a.txt') > -1, '项目来源原文要备');
  assert.equal(rels.some(function (r) { return r.indexOf('bin/') === 0; }), false, 'bin/ 是二进制，不该备');
  assert.equal(rels.some(function (r) { return r.indexOf('backups/') === 0; }), false, '备份目录不该塞进备份');
  assert.equal(rels.some(function (r) { return r.indexOf('.bak-') > -1; }), false, '临时副本不该备');
  const plan = planBackup(home);
  assert.equal(plan.fileCount, rows.length);
  assert.ok(plan.totalBytes > 0);
  rmSync(home, { recursive: true, force: true });
});

test('dry-run 只出计划：不写任何文件', function () {
  const home = seedHome();
  const plan = createBackup(home, { dryRun: true });
  assert.equal(plan.wrote, false);
  assert.equal(existsSync(plan.out), false, 'dry-run 不该落盘');
  assert.ok(plan.fileCount > 0);
  rmSync(home, { recursive: true, force: true });
});

test('备份：写出可校验的包 + latest 指针', function () {
  const home = seedHome();
  const result = createBackup(home);
  assert.equal(result.wrote, true);
  assert.equal(existsSync(result.out), true);
  const bundle = readBackup(result.out);
  assert.equal(bundle.format, 'dsh-learn-backup');
  assert.equal(Object.keys(bundle.files).length, result.fileCount);
  const check = verifyBackup(result.out);
  assert.equal(check.ok, true, '包内 hash 要自洽：' + check.broken.join(','));
  assert.equal(readFileSync(join(home, 'backups/latest.json'), 'utf8').indexOf('fileCount') > -1, true);
  const status = backupStatus(home);
  assert.equal(status.exists, true);
  assert.equal(status.stale, false);
  rmSync(home, { recursive: true, force: true });
});

test('恢复：能还原到另一个 home；dry-run 不写；覆盖前留 pre-restore 副本', function () {
  const src = seedHome();
  const target = mkdtempSync(join(tmpdir(), 'dsh-restore-'));
  const backup = createBackup(src).out;
  // dry-run 计划：目标 home 里应当全是 create
  const plan = planRestore(backup, target);
  assert.equal(plan.create, plan.rows.length);
  assert.equal(plan.overwrite, 0);
  assert.equal(restoreBackup(backup, { home: target, dryRun: true }).wrote, false);
  assert.equal(existsSync(join(target, 'progress.json')), false, 'dry-run 不该写');
  // 真恢复
  const done = restoreBackup(backup, { home: target });
  assert.equal(done.wrote, true);
  assert.equal(done.safetyCount, 0, '目标 home 本来是空的，不需要后悔药');
  assert.equal(readFileSync(join(target, 'progress.json'), 'utf8'), readFileSync(join(src, 'progress.json'), 'utf8'), '进度要逐字节一致');
  assert.equal(readFileSync(join(target, 'projects/demo/sources/0001-a.txt'), 'utf8'), readFileSync(join(src, 'projects/demo/sources/0001-a.txt'), 'utf8'), '项目原文要一致');
  // 再恢复一次：这次全是 overwrite，且要留后悔药
  const again = planRestore(backup, target);
  assert.equal(again.overwrite, again.rows.length);
  writeFileSync(join(target, 'progress.json'), '被我改坏了');
  const second = restoreBackup(backup, { home: target });
  assert.ok(second.safetyCount > 0, '覆盖前要留后悔药');
  assert.equal(readFileSync(join(second.safetyDir, 'progress.json'), 'utf8'), '被我改坏了', '后悔药里应当是覆盖前的内容');
  assert.equal(verifyBackup(backup).ok, true);
  rmSync(src, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
});

test('体检口径：没有备份 / 备份超过 7 天都算该提醒', function () {
  const home = seedHome();
  assert.equal(backupStatus(home).exists, false);
  const result = createBackup(home);
  const latest = JSON.parse(readFileSync(join(home, 'backups/latest.json'), 'utf8'));
  latest.at = new Date(Date.now() - 8 * 86400000).toISOString();
  writeFileSync(join(home, 'backups/latest.json'), JSON.stringify(latest));
  const stale = backupStatus(home);
  assert.equal(stale.exists, true);
  assert.equal(stale.stale, true, '超过 7 天应当被标记为需要重新备份');
  assert.ok(result.fileCount > 0);
  rmSync(home, { recursive: true, force: true });
});
