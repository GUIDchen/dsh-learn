// 进度存储的健壮性测试：原子写、并发追加、半行容忍、备份回退、归档。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOME = mkdtempSync(join(tmpdir(), 'dsh-learn-store-'));
process.env.DSH_LEARN_HOME = HOME;

const store = await import('../src/store.mjs');
const snapshot = join(HOME, 'progress.json');
const journal = join(HOME, 'progress.ndjson');
const backup = snapshot + '.bak';

// "换一台机器"要连笔记与目标一起清掉：只清记录的话，备份完整性测试会误判
function freshHome() {
  rmSync(snapshot, { force: true });
  rmSync(journal, { force: true });
  rmSync(backup, { force: true });
  rmSync(join(HOME, 'notes.json'), { force: true });
  rmSync(join(HOME, 'goals.json'), { force: true });
}

test('record 先写日志、快照保持原子性，且不留临时文件', function () {
  freshHome();
  store.record({ client: 'c1', taskId: 't1', score: 100, verdict: '通过' });
  assert.ok(existsSync(journal), '记录应先落到日志');
  assert.equal(store.load().records.length, 1);

  store.save({ records: store.load().records });
  const raw = readFileSync(snapshot, 'utf8');
  assert.doesNotThrow(function () { JSON.parse(raw); }, '快照必须是完整 JSON');
  assert.ok(existsSync(snapshot));
  assert.equal(existsSync(snapshot + '.tmp-' + process.pid), false, '不应留下临时文件');
  assert.equal(existsSync(backup), false, '首次落盘还没有可备份的旧版本');

  // 第二次落盘才应留下 .bak
  store.save({ records: store.load().records });
  assert.ok(existsSync(backup), '覆盖快照时应留一份 .bak');
});

test('多个进程并发提交不丢记录', function () {
  freshHome();
  const workers = 8;
  const perWorker = 5;
  const script = 'import(' + JSON.stringify(new URL('../src/store.mjs', import.meta.url).href) + ').then(function (s) {'
    + ' var id = process.env.WORKER_ID;'
    + ' for (var i = 0; i < ' + perWorker + '; i += 1) { s.record({ client: "w" + id, taskId: "task" + i, score: 100, verdict: "通过" }); }'
    + ' });';

  for (let i = 0; i < workers; i += 1) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: Object.assign({}, process.env, { DSH_LEARN_HOME: HOME, WORKER_ID: String(i) }),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, '子进程应正常结束：' + result.stderr);
  }

  const records = store.load().records;
  assert.equal(records.length, workers * perWorker, '并发写入的记录数应完全保留');
  const clients = new Set(records.map(function (row) { return row.client; }));
  assert.equal(clients.size, workers, '每个 worker 的记录都应在');
});

test('日志结尾的半行不会破坏读取', function () {
  freshHome();
  store.record({ client: 'c1', taskId: 't1', score: 100, verdict: '通过' });
  appendFileSync(journal, '{"client":"c2","taskId":"t2"'); // 模拟进程被杀留下的半行
  const data = store.load();
  assert.equal(data.records.length, 1, '完整的那条仍应读到');
  assert.equal(data.brokenJournalLines, 1, '应报告坏行数量');
});

test('快照损坏时回退到 .bak，并把坏文件改名留档', function () {
  freshHome();
  store.save({ records: [{ client: 'c1', taskId: 't1', score: 100, verdict: '通过', at: '2026-01-01T00:00:00.000Z' }] });
  store.save({ records: [{ client: 'c1', taskId: 't1', score: 100, verdict: '通过', at: '2026-01-01T00:00:00.000Z' }, { client: 'c1', taskId: 't2', score: 100, verdict: '通过', at: '2026-01-01T00:01:00.000Z' }] });
  assert.ok(existsSync(backup), '第二次 save 应产生 .bak');

  writeFileSync(snapshot, '{"version":1,"records":[{"client":"c1"'); // 写坏
  const data = store.load();
  assert.ok(data.records.length >= 1, '应从 .bak 恢复出记录');
  assert.equal(data.recoveredFromBackup, true);
  assert.ok(data.quarantinedFile && data.quarantinedFile.indexOf('corrupt') > -1, '坏文件应被改名留档');
});

test('归档：记录攒够阈值后会并进快照并清空日志', function () {
  freshHome();
  for (let i = 0; i < 220; i += 1) {
    store.record({ client: 'bulk', taskId: 'task' + i, score: 100, verdict: '通过' });
  }
  const data = store.load();
  assert.equal(data.records.length, 220, '归档后记录数不变');
  assert.ok(store.journalSize() < 200 * 60, '归档后日志应明显变小（只剩归档后新写入的）');

  // 再归档一次：日志应清空，且快照包含全部记录
  store.save(store.load());
  assert.equal(store.journalSize(), 0, '归档后日志应被清空');
  const onDisk = JSON.parse(readFileSync(snapshot, 'utf8'));
  assert.equal(onDisk.records.length, 220, '快照里应包含全部记录');
});

test('导入去重：同一份数据导入两次只有第一次生效', function () {
  freshHome();
  const payload = { records: [
    { client: 'c1', taskId: 't1', score: 100, verdict: '通过', at: '2026-02-01T00:00:00.000Z' },
    { client: 'c1', taskId: 't2', score: 40, verdict: '未通过', at: '2026-02-01T00:01:00.000Z' }
  ] };
  const first = store.importProgress(payload);
  assert.equal(first.added, 2);
  const second = store.importProgress(payload);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 2);
  assert.equal(store.load().records.length, 2);
});

// 同一毫秒内的两次练习必须各算一次：曾经用 (client, taskId, at, score, verdict) 当身份，
// 满分→满分、判定相同、时间戳同毫秒时会被 dedupe 静默合并，用户看到"累计第 4 次"而不是第 5 次
// （只在机器快时复现，实测 12 次里偶发 1 次）。身份改成写入时生成的唯一 id。
test('同一毫秒的两次相同成绩不会被当成重复丢掉', function () {
  freshHome();
  const at = '2026-03-01T00:00:00.000Z';
  const entry = { client: 'c1', taskId: 't-dup', score: 100, verdict: '通过', at: at };
  store.record(Object.assign({}, entry));
  store.record(Object.assign({}, entry));
  assert.equal(store.load().records.length, 2, '两次练习要各留一条，字段一样不是重复');
  assert.equal(store.record(Object.assign({}, entry)), 3, 'record 的返回值是记录总数');

  // 老记录（没有 id）仍然按字段组合去重：导出文件的幂等导入不能因此失效
  const legacy = { records: [{ client: 'c2', taskId: 't-legacy', score: 40, verdict: '未通过', at: at }] };
  assert.equal(store.importProgress(legacy).added, 1);
  assert.equal(store.importProgress(legacy).added, 0);
});

test('导出是整份搬走：记录、笔记、学习目标都在（换机器不会丢手写的东西）', function () {
  freshHome();
  store.record({ client: 'c1', taskId: 'docker.run-web', score: 100, verdict: '通过' });
  store.writeNote('docker.run-web', '-d 后台运行');
  store.writeGoals({ dailyTasks: 3, dailyMinutes: 20 });

  const payload = store.exportProgress();
  assert.equal(payload.version, 2, '备份带版本号，老客户端读不懂的字段会忽略');
  assert.equal(payload.records.length, 1);
  assert.equal(payload.notes['docker.run-web'].text, '-d 后台运行', '笔记要进备份');
  assert.equal(payload.goals.dailyTasks, 3, '学习目标要进备份');
  assert.equal(payload.goals.dailyMinutes, 20);

  // 换一台空机器导入：三样都要回来
  freshHome();
  const merged = store.importProgress(payload);
  assert.equal(merged.added, 1);
  assert.equal(merged.notes, 1, '笔记 +1');
  assert.equal(merged.goals, true, '本机没有目标时采纳备份里的目标');
  assert.equal(store.readNote('docker.run-web').text, '-d 后台运行');
  assert.equal(store.readGoals().dailyTasks, 3);
});

test('导入笔记：更新时间更晚的赢，本机没有的才补；本机已设的目标不被改掉', function () {
  freshHome();
  store.writeNote('t1', '本机的新笔记');
  store.writeNote('t2', '本机旧笔记');
  // 把 t2 的时间改早，模拟"备份里那条更新"
  const notes = store.readNotes();
  notes.t2.updatedAt = '2020-01-01T00:00:00.000Z';
  writeFileSync(store.notesPath(), JSON.stringify(notes));
  store.writeGoals({ dailyTasks: 5, dailyMinutes: 30 });

  const merged = store.importProgress({
    records: [],
    notes: {
      t1: { text: '备份里的旧笔记', updatedAt: '2020-01-01T00:00:00.000Z' },
      t2: { text: '备份里的新笔记', updatedAt: '2030-01-01T00:00:00.000Z' },
      t3: { text: '本机没有的笔记', updatedAt: '2021-01-01T00:00:00.000Z' }
    },
    goals: { dailyTasks: 99, dailyMinutes: 99 }
  });

  assert.equal(store.readNote('t1').text, '本机的新笔记', '更旧的备份笔记不该盖掉本机的新笔记');
  assert.equal(store.readNote('t2').text, '备份里的新笔记', '更晚的备份笔记应当覆盖');
  assert.equal(store.readNote('t3').text, '本机没有的笔记', '本机没有的要补上');
  assert.equal(merged.notes, 2, '真正写进去两条');
  assert.equal(store.readGoals().dailyTasks, 5, '本机已设目标时不被备份改掉');
  assert.equal(merged.goals, false);
});

test('reset 清空进度但保留可读结构', function () {
  freshHome();
  store.record({ client: 'c1', taskId: 't1', score: 100, verdict: '通过' });
  store.reset();
  assert.deepEqual(store.load().records, []);
  assert.equal(store.journalSize(), 0);
});

test('storageHealth 报告坏行、日志规模与恢复状态', function () {
  freshHome();
  store.record({ client: 'c1', taskId: 't1', score: 100, verdict: '通过' });
  appendFileSync(journal, 'not-json\n');
  const health = store.storageHealth();
  assert.equal(health.brokenJournalLines, 1);
  assert.equal(health.recoveredFromBackup, false);
  assert.ok(health.journalRecords >= 1);
  assert.ok(health.journalBytes > 0);
  assert.ok(health.path.indexOf('progress.json') > -1);

  writeFileSync(snapshot, 'oops');
  const after = store.storageHealth();
  assert.equal(after.records, health.journalRecords, '快照坏了只剩日志里的记录');
});

test('学习目标：写入/读取/夹取负数，且原子落盘不留临时文件', function () {
  rmSync(store.goalsPath(), { force: true });
  assert.deepEqual(store.readGoals(), { dailyTasks: 0, dailyMinutes: 0, updatedAt: null });

  const saved = store.writeGoals({ dailyTasks: 3, dailyMinutes: 20 });
  assert.equal(saved.dailyTasks, 3);
  assert.equal(saved.dailyMinutes, 20);
  assert.ok(saved.updatedAt);
  assert.equal(store.readGoals().dailyTasks, 3);
  assert.equal(existsSync(store.goalsPath() + '.tmp-' + process.pid), false, '不应留下临时文件');

  // 只改一项时另一项保持
  const patched = store.writeGoals({ dailyTasks: 5 });
  assert.equal(patched.dailyTasks, 5);
  assert.equal(patched.dailyMinutes, 20);
  assert.equal(store.writeGoals({ dailyTasks: -3 }).dailyTasks, 0, '负数应被夹到 0');

  writeFileSync(store.goalsPath(), 'not json');
  assert.deepEqual(store.readGoals(), { dailyTasks: 0, dailyMinutes: 0, updatedAt: null }, '坏文件应回退到默认值');
});

test('题目笔记：增删查与空内容即删除', function () {
  rmSync(store.notesPath(), { force: true });
  assert.deepEqual(store.readNotes(), {});
  assert.equal(store.readNote('docker.run-web'), null);

  const saved = store.writeNote('docker.run-web', '  -d 是后台运行  ');
  assert.equal(saved.deleted, false);
  assert.equal(store.readNote('docker.run-web').text, '-d 是后台运行', '应去掉首尾空白');
  assert.ok(store.readNote('docker.run-web').updatedAt);

  store.writeNote('git.switch-create', 'switch -c 比 checkout -b 语义清楚');
  assert.equal(Object.keys(store.readNotes()).length, 2);

  assert.equal(store.writeNote('git.switch-create', '   ').deleted, true, '空内容等于删除');
  assert.equal(store.readNote('git.switch-create'), null);

  assert.equal(store.deleteNote('docker.run-web').deleted, true);
  assert.equal(store.deleteNote('docker.run-web').deleted, false, '重复删除应返回 false');
  assert.deepEqual(store.readNotes(), {});
});

test.after(function () {
  rmSync(HOME, { recursive: true, force: true });
});
