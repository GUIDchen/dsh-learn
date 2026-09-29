// 简历投递（求职记录）的护栏：校验、排序、统计、JD 分析，以及 HTTP 层的人话报错。
// 口径只有 core/jobs.mjs 一份，网页版 / CLI / 原生端都走它。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-jobs-home-'));
process.env.DSH_LEARN_HOME = HOME;

const jobs = await import('../src/core/jobs.mjs');
const store = await import('../src/store.mjs');

test('投递记录：必填、状态枚举、链接与日期格式都要拦', function () {
  const empty = jobs.normalizeJob({}, {});
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.some(function (msg) { return msg.indexOf('公司名') > -1; }));
  assert.ok(empty.errors.some(function (msg) { return msg.indexOf('岗位名') > -1; }));
  const bad = jobs.normalizeJob({ company: 'A', position: 'B', status: 'nope', url: 'ftp://x', appliedAt: '2026/1/1' }, {});
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 3, '三类问题都要报出来：' + JSON.stringify(bad.errors));
  const longJd = jobs.normalizeJob({ company: 'A', position: 'B', jd: 'x'.repeat(20001) }, {});
  assert.equal(longJd.ok, false);
  assert.ok(longJd.errors[0].indexOf('JD 太长') > -1);
});

test('投递记录：状态不是待投时自动补投递日期，改动保留 createdAt', function () {
  const created = jobs.mergeJob([], { company: '某某科技', position: '运维工程师' }, { now: '2026-01-02T03:04:05.000Z' });
  assert.equal(created.ok, true);
  assert.equal(created.job.status, 'todo');
  assert.equal(created.job.appliedAt, '', '待投不补日期');
  const applied = jobs.mergeJob(created.jobs, { id: created.job.id, company: '某某科技', position: '运维工程师', status: 'applied' }, { now: '2026-01-03T00:00:00.000Z' });
  assert.equal(applied.ok, true);
  assert.equal(applied.created, false, '同 id 是改不是增');
  assert.equal(applied.job.appliedAt, '2026-01-03', '投出去就要有日期');
  assert.equal(applied.job.createdAt, created.job.createdAt, 'createdAt 不能被覆盖');
  assert.equal(applied.jobs.length, 1);
});

test('列表与统计：已投的排前面、按状态筛选、五种状态都要计数', function () {
  const rows = [
    { id: 'a', company: 'A', position: 'p', status: 'todo', appliedAt: '', updatedAt: '2026-03-01' },
    { id: 'b', company: 'B', position: 'p', status: 'applied', appliedAt: '2026-02-01', updatedAt: '2026-02-01' },
    { id: 'c', company: 'C', position: 'p', status: 'interview', appliedAt: '2026-01-15', updatedAt: '2026-02-20' }
  ];
  assert.deepEqual(jobs.listJobs(rows, {}).map(function (row) { return row.id; }), ['b', 'c', 'a'], '按投递日期倒序，未投的垫底');
  assert.deepEqual(jobs.listJobs(rows, { status: 'interview' }).map(function (row) { return row.id; }), ['c']);
  assert.deepEqual(jobs.listJobs(rows, { query: 'b' }).map(function (row) { return row.id; }), ['b'], '搜索命中公司名');
  const stats = jobs.jobStats(rows);
  assert.equal(stats.total, 3);
  assert.equal(stats.applied, 2, '已投不含待投');
  assert.equal(stats.byStatus.interview, 1);
  assert.equal(stats.latest, '2026-02-01');
});

test('删除：删掉就是删掉，删不存在的如实说没删', function () {
  const rows = [{ id: 'a' }, { id: 'b' }];
  const removed = jobs.removeJob(rows, 'a');
  assert.equal(removed.removed, true);
  assert.deepEqual(removed.jobs.map(function (row) { return row.id; }), ['b']);
  assert.equal(jobs.removeJob(rows, 'nope').removed, false);
  assert.equal(rows.length, 2, '原数组不该被改动');
});

test('JD 分析：知识点 id 去重、可练题来自字典挂载，结果能存进记录', function () {
  const analysis = jobs.analyzeJd('熟悉 Kubernetes 滚动发布与 Prometheus 告警；会用 tcpdump 抓包');
  assert.ok(analysis.points.length > 0, 'JD 应命中知识点');
  assert.equal(new Set(analysis.points).size, analysis.points.length, '知识点 id 不能重复');
  assert.ok(analysis.tasks.length > 0, '知识点应挂出可练题');
  assert.ok(analysis.matched >= analysis.points.length, '命中数不少于知识点数');
  const saved = jobs.mergeJob([], { company: 'A', position: 'B', jd: 'kubectl rollout restart deployment/web', analysis: analysis }, {});
  assert.equal(saved.job.analysis.points.length, analysis.points.length);
  assert.equal(jobs.renderJobLine(saved.job).indexOf('可练题') > -1, true, '列表那一行要能看出有没有可练题');
  assert.equal(jobs.analyzeJd('').tasks.length, 0, '空 JD 不报错，只是没有题');
});

test('存储：写盘、读回、备份带 jobs 字段', function () {
  const written = store.writeJobs([{ id: 'x', company: 'A', position: 'B', status: 'todo', appliedAt: '' }]);
  assert.equal(written.length, 1);
  assert.deepEqual(store.readJobs().map(function (row) { return row.id; }), ['x']);
  const backup = store.exportProgress();
  assert.ok(Array.isArray(backup.jobs), '备份里要带求职记录，换机器不用重录');
  // 新模型：写入先追加到操作日志，归档后才落成 jobs.json 快照；读取是「快照 + 日志回放」
  store.compactJobs();
  const onDisk = JSON.parse(readFileSync(join(HOME, 'jobs.json'), 'utf8'));
  // 第 209 轮起快照带 schema 版本：{ version: 2, jobs: [...] }；读侧仍兼容裸数组（v1）
  assert.equal(onDisk.version, 2, '快照要带 schema 版本');
  assert.equal(onDisk.jobs[0].company, 'A', '归档后快照里应当有这条');
  rmSync(join(HOME, 'jobs.json'), { force: true });
  rmSync(store.jobsJournalPath(), { force: true });
  assert.deepEqual(store.readJobs(), [], '快照与日志都没有时返回空数组而不是抛错');
});

test('改记录不丢 JD 分析结果（网页版编辑 / CLI update / 原生端保存共用这条规则）', function () {
  const withJd = jobs.mergeJob([], { company: 'A', position: 'B', status: 'applied', jd: 'kubectl rollout restart deployment/web' }, {});
  const analysis = jobs.analyzeJd(withJd.job.jd);
  const analyzed = jobs.mergeJob(withJd.jobs, Object.assign({}, withJd.job, { analysis: analysis }), {});
  assert.ok(analyzed.job.analysis, '前置：先有分析结果');
  // 只改状态：入参不带 analysis
  const updated = jobs.mergeJob(analyzed.jobs, { id: withJd.job.id, company: 'A', position: 'B', status: 'interview' }, {});
  assert.equal(updated.job.status, 'interview');
  assert.ok(updated.job.analysis, '改状态不该把分析结果抹掉');
  assert.equal(updated.job.analysis.tasks.length, analysis.tasks.length);
});