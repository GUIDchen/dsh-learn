// 并发写岗位记录的压力测试：验证「读-改-写」竞态是否已消除。
//
// 历史：jobs.json 曾是 readJobs() → 改 → writeJobs()，写单文件是原子的，但整段不是，
// 多写入者互相覆盖（实测 20 个写入者只剩 7 条）。现在写入走「追加日志 + 定期归档」，
// 所以断言要看**合并视图** readJobs()（快照 + 日志回放），而不是只看 jobs.json。
//
// 用法：node scripts/stress-jobs-write.mjs [写入者数量]（丢记录时退出码 1）
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const home = mkdtempSync(join(tmpdir(), 'dsh-jobs-stress-'));
const N = Number(process.argv[2] || 20);
process.env.DSH_LEARN_HOME = home;
const store = await import(ROOT + 'src/store.mjs');

const WORKER = [
  "const ROOT = process.argv[1];",
  "const store = await import(ROOT + 'src/store.mjs');",
  "const { mergeJob } = await import(ROOT + 'src/core/jobs.mjs');",
  "const rows = store.readJobs();",
  "const merged = mergeJob(rows, { company: 'C' + process.argv[2], position: 'P', status: 'todo' }, {});",
  "store.writeJobs(merged.jobs);",
].join(String.fromCharCode(10));

const procs = [];
for (let i = 0; i < N; i += 1) {
  procs.push(new Promise(function (resolve) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', WORKER, ROOT, String(i)], { env: Object.assign({}, process.env, { DSH_LEARN_HOME: home }) });
    child.on('exit', function (code) { resolve(code); });
  }));
}
const codes = await Promise.all(procs);
const failed = codes.filter(function (code) { return code !== 0; }).length;
const rows = store.readJobs();
const unique = new Set(rows.map(function (row) { return row.company; })).size;
const lost = N - unique;
console.log('并发 ' + N + ' 个写入者（失败进程 ' + failed + '）→ 合并视图 ' + rows.length + ' 条 / 去重 ' + unique + ' 家'
  + (lost > 0 ? '　丢了 ' + lost + ' 条' : '　（未丢 ✓）'));
process.exit(lost > 0 ? 1 : 0);
