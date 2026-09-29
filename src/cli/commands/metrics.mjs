// 运行指标：把结构化日志聚合成人话（接口 /api/metrics 与体检用的是同一份 core/log.mjs）。
import { logPath, logStatus, readEvents, summarizeEvents } from '../../core/log.mjs';
import { homeDir, load, readJobs } from '../../store.mjs';
import { listProjects } from '../../core/project.mjs';
import { TASKS } from '../../core/tasks.mjs';

export async function metrics(ctx) {
  const { args, asJson, out } = ctx;
  const home = homeDir();
  const read = readEvents({ home: home, limit: Number(args.limit) || 200 });
  const summary = summarizeEvents(read.events);
  const status = logStatus(home);
  const payload = {
    ok: true, home: home, log: logPath(home), brokenLines: read.broken, sizeBytes: status.sizeBytes || 0,
    counts: { records: load().records.length, jobs: readJobs().length, projects: listProjects({}).length, tasks: TASKS.length },
    summary: summary
  };
  if (asJson) { out(payload); return 0; }
  console.log('日志：' + payload.log + '（' + String(payload.sizeBytes) + ' 字节，读 ' + String(read.events.length) + ' 条，坏行 ' + String(read.broken) + '）');
  const http = summary.http;
  console.log('HTTP：' + String(http.requests) + ' 次，错误 ' + String(http.errors) + '（' + String(Math.round(http.errorRate * 100)) + '%）'
    + '　延迟 p50 ' + String(http.p50ms === null ? '-' : http.p50ms) + 'ms / p95 ' + String(http.p95ms === null ? '-' : http.p95ms) + 'ms');
  if (http.topPaths.length) {
    console.log('最常访问：' + http.topPaths.slice(0, 5).map(function (row) { return row.path + '×' + row.count; }).join('　'));
  }
  const events = Object.keys(summary.byEvent).map(function (name) { return name + '×' + summary.byEvent[name]; }).join('　');
  if (events) console.log('事件分布：' + events);
  console.log('本地数据：进度 ' + String(payload.counts.records) + ' 条　投递 ' + String(payload.counts.jobs) + ' 条　项目 ' + String(payload.counts.projects) + ' 个　题库 ' + String(payload.counts.tasks) + ' 题');
  return 0;
}
