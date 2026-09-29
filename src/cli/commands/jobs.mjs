// 简历投递（求职记录）的命令行入口。校验、排序、统计、JD 分析都在 core/jobs.mjs，
// 与网页版 / 原生端共用同一份口径——三端只是三套"命令怎么敲"的壳。
import { readFileSync, writeFileSync } from 'node:fs';
import { CliError } from '../context.mjs';
import { JOB_STATUSES, jobFollowUps, JOB_STATUS_LABELS, analyzeJd, jobStats, listJobs, mergeJob, removeJob, renderJobLine } from '../../core/jobs.mjs';
import { jobsPath, readJobs, writeJobs, deleteJobRecord } from '../../store.mjs';

function flag(args, key) {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

function readJdFile(file) {
  try {
    return readFileSync(String(file), 'utf8');
  } catch (err) {
    throw new CliError('读 JD 文件失败：' + err.message, 3);
  }
}

// 表单参数：--jd 直接给文本，--jd-file / --from 从文件读（JD 通常很长，贴命令行不现实）
function jobInput(args, id) {
  const file = flag(args, 'jd-file') || flag(args, 'from');
  return {
    id: id || '',
    company: flag(args, 'company'),
    position: flag(args, 'position'),
    url: flag(args, 'url'),
    status: flag(args, 'status'),
    appliedAt: flag(args, 'date'),
    note: flag(args, 'note'),
    jd: file ? readJdFile(file) : flag(args, 'jd')
  };
}

function printStats(stats) {
  const parts = JOB_STATUSES.map(function (key) {
    return JOB_STATUS_LABELS[key] + ' ' + String((stats.byStatus || {})[key] || 0);
  });
  console.log('共 ' + String(stats.total) + ' 条（已投 ' + String(stats.applied) + '）　' + parts.join('　'));
}

export async function jobs(ctx) {
  const { args, asJson, out } = ctx;
  const sub = String(args._[1] || 'list');
  const rows = readJobs();

  if (sub === 'list') {
    const status = flag(args, 'status') || 'all';
    if (status !== 'all' && JOB_STATUSES.indexOf(status) === -1) {
      throw new CliError('状态只能是 all / ' + JOB_STATUSES.join(' / ') + '，收到的是：' + status);
    }
    const query = flag(args, 'q');
    const listed = listJobs(rows, { status: status, query: query });
    const stats = jobStats(rows);
    if (asJson) { out({ jobs: listed, stats: stats, path: jobsPath() }); return 0; }
    if (!rows.length) {
      console.log('还没有投递记录。用法：node src/cli.mjs jobs add --company=某某科技 --position=运维工程师 [--status=applied] [--jd-file=jd.txt]');
      return 0;
    }
    console.log('存于 ' + jobsPath());
    console.log('筛出 ' + String(listed.length) + ' / ' + String(rows.length) + ' 条：');
    listed.forEach(function (job) {
      console.log('  ' + job.id + '');
      console.log('    ' + renderJobLine(job));
    });
    printStats(stats);
    return 0;
  }

  if (sub === 'add' || sub === 'update') {
    const id = sub === 'update' ? String(args._[2] || '') : '';
    if (sub === 'update' && !id) throw new CliError('用法：node src/cli.mjs jobs update <记录 id> [--status=interview] [--note="…"]');
    const input = jobInput(args, id);
    if (sub === 'update') {
      // 更新时只覆盖显式给出的字段：不然 `jobs update <id> --status=interview` 会把公司名清空
      const current = rows.filter(function (job) { return job.id === id; })[0];
      if (!current) throw new CliError('没有这条记录：' + id, 3);
      Object.keys(input).forEach(function (key) {
        if (key === 'id') return;
        if (!input[key]) input[key] = current[key] === undefined ? '' : current[key];
      });
      // JD 分析结果也要留住：它不是"表单字段"，但改状态不该把之前算好的知识点/可练题丢掉
      // （实测：只改 --status 之后 analysis 变成了 false）
      input.analysis = current.analysis || null;
    }
    const merged = mergeJob(rows, input, {});
    if (!merged.ok) {
      merged.errors.forEach(function (msg) { console.error('错误：' + msg); });
      return 2;
    }
    const next = writeJobs(merged.jobs);
    if (asJson) { out({ job: merged.job, created: merged.created, stats: jobStats(next) }); return 0; }
    console.log((merged.created ? '已新增：' : '已更新：') + merged.job.company + ' · ' + merged.job.position
      + '　' + JOB_STATUS_LABELS[merged.job.status] + (merged.job.appliedAt ? '（' + merged.job.appliedAt + '）' : ''));
    console.log('  记录 id：' + merged.job.id + '（跟着 id 更新/删除/分析）');
    printStats(jobStats(next));
    return 0;
  }

  if (sub === 'follow') {
    // 投递跟进：谁在等消息、多久没动静、先跟哪几家
    const result = jobFollowUps(rows, { staleDays: Number(flag(args, 'stale-days')) || 5, now: flag(args, 'now') || undefined });
    if (asJson) { out(result); return 0; }
    if (flag(args, 'out')) { writeFileSync(String(flag(args, 'out')), result.markdown); console.log('已写入 ' + flag(args, 'out')); }
    console.log(result.markdown);
    return 0;
  }

  if (sub === 'delete') {
    const id = String(args._[2] || '');
    if (!id) throw new CliError('用法：node src/cli.mjs jobs delete <记录 id>');
    const removed = removeJob(rows, id);
    if (!removed.removed) { console.error('没有这条记录：' + id); return 3; }
    // 删除走显式操作（writeJobs 只增改）
    const next = deleteJobRecord(id);
    if (asJson) { out({ deleted: true, stats: jobStats(next) }); return 0; }
    console.log('已删除：' + id);
    printStats(jobStats(next));
    return 0;
  }

  if (sub === 'analyze') {
    const id = String(args._[2] || '');
    if (!id) throw new CliError('用法：node src/cli.mjs jobs analyze <记录 id>（记录里要先有 JD：jobs add --jd-file=jd.txt）');
    const row = rows.filter(function (job) { return job.id === id; })[0];
    if (!row) throw new CliError('没有这条记录：' + id, 3);
    if (!String(row.jd || '').trim()) { console.error('这条记录没存 JD：先把岗位描述存进去（--jd 或 --jd-file）再分析。'); return 2; }
    const analysis = analyzeJd(row.jd, { limit: 20 });
    const merged = mergeJob(rows, Object.assign({}, row, { analysis: analysis }), {});
    if (!merged.ok) { merged.errors.forEach(function (msg) { console.error('错误：' + msg); }); return 2; }
    writeJobs(merged.jobs);
    if (asJson) { out({ job: merged.job, analysis: analysis }); return 0; }
    console.log('已分析：' + row.company + ' · ' + row.position);
    console.log('  知识点 ' + String(analysis.points.length) + ' 个 → 可练题 ' + String(analysis.tasks.length) + ' 道（已存进这条记录）');
    console.log('  开练：' + drillCommand(analysis.tasks));
    return 0;
  }

  if (sub === 'drill') {
    const id = String(args._[2] || '');
    const row = rows.filter(function (job) { return job.id === id; })[0];
    if (!row) throw new CliError('没有这条记录：' + id, 3);
    const tasks = (row.analysis && row.analysis.tasks) || [];
    if (!tasks.length) { console.error('这条记录还没有可练题：先跑 jobs analyze ' + id); return 2; }
    if (asJson) { out({ tasks: tasks }); return 0; }
    // CLI 里不替用户起一个交互式会话：把开练命令打出来，复制即用（--csv 给脚本用）
    if (args.csv) { console.log(tasks.join(',')); return 0; }
    console.log(drillCommand(tasks));
    return 0;
  }

  throw new CliError('jobs 的子命令：list / add / update / delete / analyze / drill', 2);
}

function drillCommand(tasks) {
  return 'node src/cli.mjs drill --tasks=' + tasks.join(',');
}
