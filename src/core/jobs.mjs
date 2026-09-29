// 简历投递（求职记录）：谁家、什么岗、什么时候投的、现在到哪一步、JD 里涉及哪些知识点。
// 纯函数放在 core 里：CLI / 网页版 / 原生端共用同一套校验与排序口径，判定规则也只有这一份。
import { analyzeText } from './knowledge.mjs';
import { understandText } from './understand.mjs';
import { slug as slugBase } from './text.mjs';

// 状态就这五个：再加就把一个下拉框变成流程图了
export const JOB_STATUSES = ['todo', 'applied', 'interview', 'offer', 'closed'];
export const JOB_STATUS_LABELS = {
  todo: '待投',
  applied: '已投',
  interview: '面试中',
  offer: '已录用',
  closed: '已结束'
};

const COMPANY_MAX = 80;
const POSITION_MAX = 80;
const URL_MAX = 500;
const NOTE_MAX = 2000;
const JD_MAX = 20000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function today(now) {
  const date = now ? new Date(now) : new Date();
  return date.toISOString().slice(0, 10);
}

export function jobId(company, position, stamp) {
  const base = (slug(company) + '-' + slug(position)).replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return 'job-' + (stamp || String(Date.now())) + (base ? '-' + base : '');
}

// 原行为：保留中英文、不限长
export function slug(text) { return slugBase(text); }

// 校验 + 归一：错误一律给"这条记录不能存"的人话原因，而不是抛异常
export function normalizeJob(input, options) {
  const opts = options || {};
  const raw = input || {};
  const errors = [];
  const company = String(raw.company === undefined || raw.company === null ? '' : raw.company).trim();
  const position = String(raw.position === undefined || raw.position === null ? '' : raw.position).trim();
  if (!company) errors.push('公司名不能为空');
  if (!position) errors.push('岗位名不能为空');
  if (company.length > COMPANY_MAX) errors.push('公司名太长（上限 ' + COMPANY_MAX + ' 字）');
  if (position.length > POSITION_MAX) errors.push('岗位名太长（上限 ' + POSITION_MAX + ' 字）');
  const url = String(raw.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) errors.push('链接只支持 http/https，收到的是：' + url.slice(0, 60));
  if (url.length > URL_MAX) errors.push('链接太长（上限 ' + URL_MAX + ' 字）');
  const status = String(raw.status || 'todo').trim();
  if (JOB_STATUSES.indexOf(status) === -1) errors.push('状态只能是 ' + JOB_STATUSES.join(' / ') + '，收到的是：' + status);
  const appliedAt = String(raw.appliedAt || '').trim() || (status === 'todo' ? '' : today(opts.now));
  if (appliedAt && !DATE_RE.test(appliedAt)) errors.push('投递日期要写成 YYYY-MM-DD，收到的是：' + appliedAt);
  const note = String(raw.note || '').trim();
  if (note.length > NOTE_MAX) errors.push('备注太长（上限 ' + NOTE_MAX + ' 字）');
  const jd = String(raw.jd || '').trim();
  if (jd.length > JD_MAX) errors.push('JD 太长（上限 ' + JD_MAX + ' 字）：只贴职责与要求那几段就够');
  if (errors.length) return { ok: false, errors: errors };
  const createdAt = raw.createdAt || new Date(opts.now || Date.now()).toISOString();
  return {
    ok: true,
    job: {
      id: String(raw.id || '').trim() || jobId(company, position),
      company: company,
      position: position,
      url: url,
      status: status,
      appliedAt: appliedAt,
      note: note,
      jd: jd,
      createdAt: createdAt,
      updatedAt: new Date(opts.now || Date.now()).toISOString(),
      // JD 的分析结果（可选）：存下来列表就能直接显示"涉及 N 个知识点 / M 道可练题"，不用每次重算
      analysis: raw.analysis || null
    }
  };
}

// 分析一段 JD 并把结果挂到记录上：知识点 id 与可练题都来自同一份字典（与网页版"分析这段文本"一致）
export function analyzeJd(jd, options) {
  const opts = options || {};
  const report = analyzeText(String(jd || ''), { limit: Math.max(1, Math.min(100, Number(opts.limit) || 20)) });
  const points = [];
  report.modules.forEach(function (mod) {
    (mod.points || []).forEach(function (point) { if (points.indexOf(point.id) === -1) points.push(point.id); });
  });
  const tasks = [];
  report.modules.forEach(function (mod) {
    (mod.points || []).forEach(function (point) {
      (point.tasks || []).forEach(function (taskId) { if (tasks.indexOf(taskId) === -1) tasks.push(taskId); });
    });
  });
  // 顺手把文字理解的结构一起存下来：匹配度要按"硬要求 vs 加分项"加权，投递材料要逐条对硬要求，
  // 每次现算一遍既慢又容易和列表显示不一致（口径只留这一处）。
  const understood = understandText(String(jd || ''), { limit: opts.limit || 20 });
  return {
    at: new Date().toISOString(),
    matched: report.matched,
    modules: report.modules.length,
    points: points,
    tasks: tasks,
    mustHave: understood.mustHave,
    niceToHave: understood.niceToHave,
    stack: understood.stack,
    seniority: understood.seniority,
    company: understood.company,
    position: understood.position,
    location: understood.location,
    salary: understood.salary,
    postedAt: understood.postedAt,
    remote: understood.remote
  };
}

export function listJobs(jobs, filter) {
  const opts = filter || {};
  const status = String(opts.status || 'all');
  const query = String(opts.query || '').trim().toLowerCase();
  return (jobs || [])
    .filter(function (job) {
      if (status !== 'all' && job.status !== status) return false;
      if (!query) return true;
      return (String(job.company || '') + ' ' + String(job.position || '') + ' ' + String(job.note || '')).toLowerCase().indexOf(query) > -1;
    })
    .slice()
    .sort(function (a, b) {
      // 先按投递日期倒序（没投的排最后），再看更新时间
      const left = a.appliedAt || '';
      const right = b.appliedAt || '';
      if (left !== right) return right.localeCompare(left);
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
}

export function jobStats(jobs) {
  const rows = jobs || [];
  const byStatus = {};
  JOB_STATUSES.forEach(function (key) { byStatus[key] = 0; });
  rows.forEach(function (job) { if (byStatus[job.status] !== undefined) byStatus[job.status] += 1; });
  const applied = rows.filter(function (job) { return job.status !== 'todo'; }).length;
  const latest = rows.map(function (job) { return job.appliedAt || ''; }).filter(Boolean).sort().pop() || '';
  return { total: rows.length, byStatus: byStatus, applied: applied, latest: latest };
}

// 增改：按 id 合并（同一个 id 就是改，没有就是增）
// 跟进口径：距离"最后一次动作"多少天没动静。
// 只对"已投/面试中"提醒——待投还没投、已录用/已结束都不用催。
export const FOLLOW_UP_STATUSES = ['applied', 'interview'];

export function daysBetween(from, to) {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// 每条记录的最后一次动作：优先看历史，其次看投递日期
export function lastTouchedAt(job) {
  const history = (job && job.history) || [];
  if (history.length) return history[history.length - 1].at;
  return (job && job.appliedAt) || '';
}

export function jobFollowUps(jobs, options) {
  const opts = options || {};
  const now = opts.now || today();
  const staleDays = Math.max(1, Number(opts.staleDays) || 5);
  const rows = (jobs || []).map(function (job) {
    const touched = lastTouchedAt(job);
    const days = touched ? daysBetween(touched, now) : null;
    const waiting = FOLLOW_UP_STATUSES.indexOf(job.status) > -1;
    const stale = waiting && days !== null && days >= staleDays;
    return {
      id: job.id,
      company: job.company,
      position: job.position,
      status: job.status,
      statusLabel: JOB_STATUS_LABELS[job.status] || job.status,
      lastAt: touched,
      days: days,
      waiting: waiting,
      followUp: stale,
      reason: !waiting
        ? (job.status === 'todo' ? '还没投，不用跟进' : '已收尾，不用跟进')
        : (days === null ? '没有时间记录' : (stale ? ('已 ' + days + ' 天没动静，建议跟进') : ('已 ' + days + ' 天，还在正常等待期')))
    };
  });
  rows.sort(function (a, b) { return (b.days === null ? -1 : b.days) - (a.days === null ? -1 : a.days); });
  const result = {
    now: now,
    staleDays: staleDays,
    total: rows.length,
    followUps: rows.filter(function (row) { return row.followUp; }),
    waiting: rows.filter(function (row) { return row.waiting; }),
    rows: rows
  };
  result.markdown = renderFollowUps(result);
  return result;
}

export function renderFollowUps(result) {
  const out = [];
  out.push('# 投递跟进（' + result.now + '）');
  out.push('');
  out.push('- 在等消息 ' + result.waiting.length + ' 条；其中 **' + result.followUps.length + ' 条超过 ' + result.staleDays + ' 天没动静**');
  out.push('');
  if (!result.waiting.length) {
    out.push('当前没有在等消息的投递（已投 / 面试中 才会进入跟进）。');
    return out.join(String.fromCharCode(10)) + String.fromCharCode(10);
  }
  out.push('| 公司 | 岗位 | 状态 | 最后一次动作 | 无动静 | 建议 |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  result.waiting.forEach(function (row) {
    out.push('| ' + row.company + ' | ' + row.position + ' | ' + row.statusLabel + ' | ' + (row.lastAt || '（无）')
      + ' | ' + (row.days === null ? '?' : (row.days + ' 天')) + ' | ' + row.reason + ' |');
  });
  out.push('');
  if (result.followUps.length) {
    out.push('**先跟这几家**：');
    result.followUps.forEach(function (row) {
      out.push('- ' + row.company + ' · ' + row.position + '（' + row.days + ' 天）——发一条礼貌的进度询问，别问"结果出来了吗"');
    });
    out.push('');
    out.push('跟进后记一笔：node src/cli.mjs jobs update ' + result.followUps[0].id + ' --status=applied --note="已跟进，对方说本周内回复"');
  }
  return out.join(String.fromCharCode(10)) + String.fromCharCode(10);
}

export function mergeJob(jobs, input, options) {
  const normalized = normalizeJob(input, options);
  if (!normalized.ok) return { ok: false, errors: normalized.errors };
  const rows = (jobs || []).slice();
  const at = rows.findIndex(function (job) { return job.id === normalized.job.id; });
  const created = at === -1;
  if (created) {
    const first = normalized.job;
    const history = (first.history || []).slice();
    if (!history.length) {
      history.push({
        status: first.status,
        at: first.appliedAt || today(),
        note: first.note ? String(first.note).trim() : '建立记录'
      });
    }
    const seeded = Object.assign({}, first, { history: history.slice(-50) });
    rows.push(seeded);
    return { ok: true, jobs: rows, job: seeded, created: true };
  }
  // 改的时候要返回**存下来的那一行**（保留原 createdAt），而不是归一化后的入参：
  // 调用方拿它去渲染或回执，返回入参就会让界面显示成刚刚创建（自检用例实测抓到的）
  // 入参没带 analysis（归一化后是 null）时保留原值：改状态 / 改备注不该把算好的知识点与可练题丢掉。
  // 这个坑三端都会踩（网页版编辑表单、CLI update、原生端保存），所以在 core 里一处修掉。
  const keptAnalysis = normalized.job.analysis === null ? (rows[at].analysis || null) : normalized.job.analysis;
  // 状态时间线：状态真的变了、或显式带了备注，就追一笔。
  // 老记录（还没有 history）先按投递日期补一条，这样时间线不会断层。
  const previous = rows[at];
  const history = (previous.history || []).slice();
  if (!history.length && previous.appliedAt) {
    history.push({ status: previous.status || 'todo', at: previous.appliedAt, note: '（历史记录，按投递日期补录）' });
  }
  const note = String((normalized.job.note || '')).trim();
  const statusChanged = normalized.job.status !== previous.status;
  const noteChanged = note && note !== String(previous.note || '').trim();
  if (statusChanged || noteChanged) {
    history.push({
      status: normalized.job.status,
      at: today(options && options.now),
      note: note || (statusChanged ? ('状态更新为 ' + (JOB_STATUS_LABELS[normalized.job.status] || normalized.job.status)) : ''),
      from: statusChanged ? previous.status : ''
    });
  }
  const merged = Object.assign({}, previous, normalized.job, {
    createdAt: previous.createdAt || normalized.job.createdAt,
    analysis: keptAnalysis,
    history: history.slice(-50)
  });
  rows[at] = merged;
  return { ok: true, jobs: rows, job: merged, created: false };
}

export function removeJob(jobs, id) {
  const rows = (jobs || []).slice();
  const at = rows.findIndex(function (job) { return job.id === id; });
  if (at === -1) return { ok: false, removed: false };
  rows.splice(at, 1);
  return { ok: true, removed: true, jobs: rows };
}

export function renderJobLine(job) {
  const status = JOB_STATUS_LABELS[job.status] || job.status;
  const when = job.appliedAt ? job.appliedAt : '未投';
  const points = job.analysis && job.analysis.points ? job.analysis.points.length : 0;
  const tasks = job.analysis && job.analysis.tasks ? job.analysis.tasks.length : 0;
  return '[' + status + '] ' + when + '　' + job.company + ' · ' + job.position
    + (points ? '　知识点 ' + points + ' / 可练题 ' + tasks : '');
}
