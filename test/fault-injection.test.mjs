// 故障注入：把「坏了会怎样」变成用例，而不是等用户碰上。
//
// 覆盖：快照损坏（有/无可用 .bak）、jobs/goals/notes 文件损坏、日志半行、
// 目录只读、陈旧锁抢占、目标路径被目录占位（原子写失败不能留半成品）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-fault-'));
process.env.DSH_LEARN_HOME = home;
const store = await import('../src/store.mjs');

const SNAPSHOT = join(home, 'progress.json');
const BACKUP = SNAPSHOT + '.bak';
const JOURNAL = join(home, 'progress.ndjson');
const tmpLeftovers = function () { return readdirSync(home).filter(function (n) { return n.indexOf('.tmp-') > -1; }); };

test('快照损坏：回退到 .bak 并把坏文件改名留档（不抛错）', function () {
  store.save({ records: [{ id: 'r1', taskId: 'go.env-check', score: 100 }] });
  store.save({ records: [{ id: 'r1', taskId: 'go.env-check', score: 100 }] });  // 第二次落盘才产生 .bak
  assert.equal(existsSync(BACKUP), true, '需要有 .bak 才谈得上回退');
  writeFileSync(SNAPSHOT, '{"version":1,"records":[{"client":"c1"');   // 写坏
  const data = store.load();
  assert.equal(data.records.length, 1, '应当从 .bak 恢复出一条');
  assert.equal(data.recoveredFromBackup, true, '要如实报告「这是从 .bak 恢复来的」（字段名就是它）');
  assert.ok(data.quarantinedFile, '坏文件要改名留档：' + data.quarantinedFile);
  assert.equal(tmpLeftovers().length, 0, '不该留下半成品临时文件');
});

test('快照与 .bak 都坏：返回空、不抛错、坏文件留档', function () {
  writeFileSync(SNAPSHOT, 'not json at all');
  writeFileSync(BACKUP, 'also broken');
  const data = store.load();
  assert.deepEqual(data.records, []);
  assert.ok(!data.recoveredFromBackup, '两边都坏时不该声称恢复成功');
  assert.ok(data.quarantinedFile, '坏文件同样要留档：' + data.quarantinedFile);
});

test('jobs / goals / notes 文件损坏：读回默认值，不抛错', function () {
  writeFileSync(join(home, 'jobs.json'), '{{{ broken');
  writeFileSync(join(home, 'goals.json'), 'broken');
  writeFileSync(join(home, 'notes.json'), 'broken');
  assert.deepEqual(store.readJobs(), []);
  const goals = store.readGoals();
  assert.equal(goals.dailyTasks, 0);
  assert.equal(goals.dailyMinutes, 0);
  assert.deepEqual(store.readNotes(), {});
});

test('日志半行（进程被杀）：忽略坏行并如实计数', function () {
  writeFileSync(JOURNAL, JSON.stringify({ id: 'ok1', taskId: 'go.env-check' }) + String.fromCharCode(10) + '{"id":"half');
  const data = store.load();
  assert.ok(data.brokenJournalLines >= 1, '要报告坏行数：' + data.brokenJournalLines);
  rmSync(JOURNAL, { force: true });
});

test('目录只读：写入失败要给出能看懂的原因，且不留下半成品', function () {
  if (process.getuid && process.getuid() === 0) return;   // root 下权限不生效
  chmodSync(home, 0o500);
  let error = null;
  try { store.record({ client: 'fault', taskId: 'go.env-check', score: 100 }); } catch (err) { error = err; }
  chmodSync(home, 0o700);
  assert.ok(error, '只读目录下写入应当失败而不是静默丢数据');
  assert.ok(/存储写入失败/.test(error.message), '要说清是存储写入失败：' + error.message);
  assert.ok(/目录不可写|EACCES|permission/i.test(error.message), '要指向权限问题：' + error.message);
  assert.equal(tmpLeftovers().length, 0, '失败后不该留 .tmp-*');
});

test('陈旧锁（持有者挂了）：后来者能抢占并写成功', function () {
  const lock = join(home, '.compact.lock');
  writeFileSync(lock, String(process.pid));
  const old = new Date(Date.now() - 6000);
  utimesSync(lock, old, old);   // 6 秒前：超过 5 秒的陈旧阈值
  const count = store.record({ client: 'fault', taskId: 'go.env-check', score: 100 });
  assert.ok(count >= 1, '抢占后应当写成功：' + count);
  assert.equal(existsSync(lock), false, '写完要把锁清掉');
});

test('目标路径被目录占位：原子写失败、旧文件内容不变、不留 .tmp', function () {
  const goals = join(home, 'goals.json');
  rmSync(goals, { force: true });
  mkdirSync(goals);   // 用同名目录占位，rename 必然失败
  const before = readdirSync(home).slice().sort().join(',');
  let error = null;
  try { store.writeGoals({ dailyTasks: 5 }); } catch (err) { error = err; }
  assert.ok(error, '写不进去要抛错，而不是假装成功');
  assert.equal(statSync(goals).isDirectory(), true, '占位目录还在（没有半写状态）');
  assert.equal(tmpLeftovers().length, 0, '失败后不该留 .tmp-*：' + tmpLeftovers().join(','));
  assert.ok(before.indexOf('goals.json') > -1);
  rmSync(goals, { recursive: true, force: true });
});

test('恢复：坏掉之后写入仍然可用（状态回到可用）', function () {
  const count = store.record({ client: 'fault', taskId: 'git.version-check', score: 100 });
  assert.ok(count >= 1);
  assert.ok(store.load().records.length >= 1);
});

test.after(function () {
  try { chmodSync(home, 0o700); } catch (err) { /* 已是可写 */ }
  rmSync(home, { recursive: true, force: true });
});
