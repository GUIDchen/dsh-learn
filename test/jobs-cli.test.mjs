
// CLI 的简历投递：与网页版 / 原生端同一份 core/jobs.mjs，命令只是壳。
// 这里盯三件事：增改不丢字段、分析结果存回记录、校验失败给人话（退出码 2）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-jobs-cli-'));
process.env.DSH_LEARN_HOME = HOME;

const jobsCmd = await import('../src/cli/commands/jobs.mjs');
const store = await import('../src/store.mjs');

function ctx(argv, flags) {
  return {
    // 下标 0 是命令名本身（真实 ctx 里就是 'jobs'），子命令在第 1 位——写错了会静默变成 list
    args: Object.assign({ _: ['jobs'].concat(argv) }, flags || {}),
    asJson: false,
    out: function () {},
    command: 'jobs'
  };
}

// 命令直接输出到 stdout：这里拦住它，既避免测试刷屏，也能断言打印内容
function capture(fn) {
  const lines = [];
  const original = console.log;
  const originalError = console.error;
  console.log = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  console.error = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  return Promise.resolve(fn()).then(function (code) {
    console.log = original;
    console.error = originalError;
    return { code: code, text: lines.join('\n') };
  }, function (err) {
    console.log = original;
    console.error = originalError;
    throw err;
  });
}

test('jobs add/list：落盘、给人话、空表如实说', async function () {
  store.clearJobs();
  const empty = await capture(function () { return jobsCmd.jobs(ctx(['list'])); });
  assert.equal(empty.code, 0);
  assert.ok(empty.text.indexOf('还没有投递记录') > -1, '空表要说清怎么加：' + empty.text);

  const added = await capture(function () {
    return jobsCmd.jobs(ctx(['add'], { company: '某某科技', position: '运维工程师', status: 'applied', jd: '熟悉 Kubernetes 滚动发布' }));
  });
  assert.equal(added.code, 0);
  assert.ok(added.text.indexOf('已新增：某某科技 · 运维工程师') > -1, added.text);
  const rows = store.readJobs();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'applied');
  assert.equal(rows[0].appliedAt.length, 10, '投出去要自动补日期');
});

test('jobs add 校验失败：退出码 2 + 说清是哪个字段', async function () {
  store.clearJobs();
  const bad = await capture(function () { return jobsCmd.jobs(ctx(['add'], { company: '', position: 'x' })); });
  assert.equal(bad.code, 2);
  assert.ok(bad.text.indexOf('公司名不能为空') > -1, bad.text);
  assert.equal(store.readJobs().length, 0, '校验失败不该写盘');
});

test('jobs analyze 把知识点与可练题存回记录，drill 打印可复制的开练命令', async function () {
  store.clearJobs();
  await capture(function () { return jobsCmd.jobs(ctx(['add'], { company: 'A', position: 'B', status: 'applied', jd: '熟悉 Kubernetes 滚动发布与 Prometheus 告警；会用 tcpdump 抓包' })); });
  const id = store.readJobs()[0].id;
  const analyzed = await capture(function () { return jobsCmd.jobs(ctx(['analyze', id])); });
  assert.equal(analyzed.code, 0);
  assert.ok(/知识点 \d+ 个 → 可练题 \d+ 道/.test(analyzed.text), analyzed.text);
  const stored = store.readJobs()[0];
  assert.ok(stored.analysis && stored.analysis.tasks.length > 0, '分析结果要存进记录');
  const drilled = await capture(function () { return jobsCmd.jobs(ctx(['drill', id])); });
  assert.ok(drilled.text.indexOf('node src/cli.mjs drill --tasks=') > -1, drilled.text);
  const csv = await capture(function () { return jobsCmd.jobs(ctx(['drill', id], { csv: true })); });
  assert.equal(csv.text.trim(), stored.analysis.tasks.join(','), '--csv 给脚本用');
  // 用法/找不到记录这类问题在 handler 里抛 CliError，由入口统一转退出码（测试直接看 exitCode）
  const noId = await capture(function () { return jobsCmd.jobs(ctx(['analyze', 'nope'])); }).catch(function (err) { return { error: err }; });
  assert.ok(noId.error, '找不到记录要抛错');
  assert.equal(noId.error.exitCode, 3);
});

test('jobs update 只改给定字段：公司名、JD 与分析结果都要留住', async function () {
  store.clearJobs();
  await capture(function () { return jobsCmd.jobs(ctx(['add'], { company: 'A', position: 'B', status: 'applied', jd: 'kubectl rollout restart deployment/web' })); });
  const id = store.readJobs()[0].id;
  await capture(function () { return jobsCmd.jobs(ctx(['analyze', id])); });
  const before = store.readJobs()[0];
  assert.ok(before.analysis, '前置：先有分析结果');
  const updated = await capture(function () { return jobsCmd.jobs(ctx(['update', id], { status: 'interview' })); });
  assert.equal(updated.code, 0);
  const after = store.readJobs()[0];
  assert.equal(after.status, 'interview');
  assert.equal(after.company, 'A', '没给的公司名不能被清空');
  assert.equal(after.jd, before.jd, 'JD 要留着');
  assert.ok(after.analysis, '分析结果不该被一次状态更新抹掉');
  assert.equal(after.createdAt, before.createdAt, 'createdAt 不能被覆盖');
});

test('jobs --jd-file 读文件；delete 与筛选项', async function () {
  store.clearJobs();
  const jdFile = join(HOME, 'jd.txt');
  writeFileSync(jdFile, '熟悉 Docker Compose 与 Kubernetes 滚动发布');
  await capture(function () { return jobsCmd.jobs(ctx(['add'], { company: 'C', position: 'D', 'jd-file': jdFile })); });
  assert.ok(store.readJobs()[0].jd.indexOf('Docker Compose') > -1, '--jd-file 要读文件内容');
  const listTodo = await capture(function () { return jobsCmd.jobs(ctx(['list'], { status: 'todo' })); });
  assert.ok(listTodo.text.indexOf('筛出 1 / 1 条') > -1, listTodo.text);
  const listApplied = await capture(function () { return jobsCmd.jobs(ctx(['list'], { status: 'applied' })); });
  assert.ok(listApplied.text.indexOf('筛出 0 / 1 条') > -1, listApplied.text);
  const badStatus = await capture(function () { return jobsCmd.jobs(ctx(['list'], { status: 'nope' })); }).catch(function (err) { return { error: err }; });
  assert.ok(badStatus.error, '非法状态要抛 CliError（退出码 2）');
  const noJd = await capture(function () { return jobsCmd.jobs(ctx(['add'], { company: 'E', position: 'F' })); });
  assert.equal(noJd.code, 0);
  const eId = store.readJobs().filter(function (row) { return row.company === 'E'; })[0].id;
  const analyzeNoJd = await capture(function () { return jobsCmd.jobs(ctx(['analyze', eId])); });
  assert.equal(analyzeNoJd.code, 2);
  assert.ok(analyzeNoJd.text.indexOf('没存 JD') > -1, analyzeNoJd.text);
  const removed = await capture(function () { return jobsCmd.jobs(ctx(['delete', eId])); });
  assert.equal(removed.code, 0);
  assert.equal(store.readJobs().length, 1);
  const missing = await capture(function () { return jobsCmd.jobs(ctx(['delete', 'nope'])); });
  assert.equal(missing.code, 3, '删不存在的记录：打印原因并退 3');
});
