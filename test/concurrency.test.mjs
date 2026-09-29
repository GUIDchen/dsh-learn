// 并发写存储：岗位记录与练习记录都不能丢，也不能崩（第 18 轮修的就是这个）。
//
// 历史：jobs.json 曾用「readJobs() → 改 → writeJobs()」整份覆盖，实测 20 个并发写入者只剩 7 条。
// 现在写入走「追加操作日志 + 锁内归档」，读是快照 + 日志回放（操作幂等）。
//
// 注意：store 的 HOME 在**模块导入时**固定，所以这个文件只设一次 home、只导入一次 store；
// 每个用例用 clearJobs() 之类显式重置，而不是换 home（第 16 轮踩过这个坑）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'dsh-concurrency-'));
process.env.DSH_LEARN_HOME = home;
const store = await import('../src/store.mjs');
const { mergeJob } = await import('../src/core/jobs.mjs');

function concurrentWorkers(script, count) {
  return Promise.all(Array.from({ length: count }, function (_, i) {
    return new Promise(function (resolve) {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, ROOT, String(i)], {
        env: Object.assign({}, process.env, { DSH_LEARN_HOME: home })
      });
      let err = '';
      child.stderr.on('data', function (chunk) { err += String(chunk); });
      child.on('exit', function (code) { resolve({ code: code, err: err }); });
    });
  }));
}

const ADD_WORKER = [
  "const ROOT = process.argv[1];",
  "const store = await import(ROOT + 'src/store.mjs');",
  "const { mergeJob } = await import(ROOT + 'src/core/jobs.mjs');",
  "const rows = store.readJobs();",
  "const merged = mergeJob(rows, { company: 'C' + process.argv[2], position: 'P', status: 'todo' }, {});",
  "store.writeJobs(merged.jobs);",
].join(String.fromCharCode(10));

test('并发 30 个写入者：岗位记录一条不丢、一个不崩', async function () {
  store.clearJobs();
  const N = 30;
  const results = await concurrentWorkers(ADD_WORKER, N);
  const failed = results.filter(function (row) { return row.code !== 0; });
  assert.deepEqual(failed.map(function (row) { return row.err.slice(0, 120); }), [], '不该有进程失败');
  const companies = new Set(store.readJobs().map(function (row) { return row.company; }));
  assert.equal(companies.size, N, '应保留 ' + N + ' 家，实际 ' + companies.size);
});

test('删除岗位记录走显式操作，归档后其余记录仍在', async function () {
  store.clearJobs();
  for (let i = 0; i < 5; i += 1) {
    const merged = mergeJob(store.readJobs(), { company: 'D' + i, position: 'P', status: 'todo' }, {});
    store.writeJobs(merged.jobs);
  }
  assert.equal(store.readJobs().length, 5);
  const target = store.readJobs().filter(function (row) { return row.company === 'D2'; })[0];
  store.deleteJobRecord(target.id);
  const left = store.readJobs();
  assert.equal(left.length, 4, '删掉一条后应剩 4 条：' + left.length);
  assert.equal(left.filter(function (row) { return row.company === 'D2'; }).length, 0, '被删的不该还在');
  store.compactJobs();
  assert.equal(store.readJobs().length, 4, '归档后应仍是 4 条');
});

test('并发 30 个练习记录：一条不丢、一个不崩', async function () {
  const WORKER = [
    "const ROOT = process.argv[1];",
    "const store = await import(ROOT + 'src/store.mjs');",
    "store.record({ client: 'w' + process.argv[2], taskId: 'go.env-check', score: 100, verdict: '通过', platform: 'darwin' });",
  ].join(String.fromCharCode(10));
  const before = store.load().records.length;
  const results = await concurrentWorkers(WORKER, 30);
  const failed = results.filter(function (row) { return row.code !== 0; });
  assert.deepEqual(failed.map(function (row) { return row.err.slice(0, 120); }), [], '不该有进程失败');
  const records = store.load().records;
  assert.equal(records.length, before + 30, '应新增 30 条练习记录，实际新增 ' + (records.length - before));
});

test.after(function () { rmSync(home, { recursive: true, force: true }); });
