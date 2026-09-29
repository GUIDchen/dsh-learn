// 知识点掌握度：把"练过哪些题"折成"这个知识点我会几成"。
//
// 为什么需要：题库有 165 个知识点，进度页只说"通过 N 道题"，答不了"我最弱的知识点是什么、
// 今天该练哪几道"。这里给一个可解释的估计，用来驱动每日练习。
//
// 口径（全部可复算，不做黑箱）：
//   mastery = 覆盖度 × 0.6 + 近期保持 × 0.4
//     · 覆盖度 = 该知识点下已通过的题 / 总题数
//     · 近期保持 = 通过题里"没过期"的比例，半衰期 30 天（越久没练越打折）
//     · 反复练却没过的题会拉低覆盖度（它不算通过）
// 分数落在 0..1；分档：未练（覆盖 0）/ 薄弱（<0.4）/ 一般（<0.75）/ 熟练（≥0.75）。
import { POINTS } from './knowledge.mjs';
import { taskStats } from './progress.mjs';
import { PASS_SCORE } from './judge.mjs';

const HALF_LIFE_DAYS = 30;

export function decayFactor(at, now) {
  if (!at) return 0.5; // 没有时间戳（老数据）按"半信半疑"折半
  const days = (new Date(now || Date.now()).getTime() - new Date(at).getTime()) / 86400000;
  if (!isFinite(days)) return 0.5;
  if (days <= 0) return 1;
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

export function masteryLevel(mastery, total, passed) {
  if (!total || !passed) return '未练';
  if (mastery < 0.4) return '薄弱';
  if (mastery < 0.75) return '一般';
  return '熟练';
}

export function pointMastery(records, tasks, points, options) {
  const opts = options || {};
  const now = opts.now || new Date().toISOString();
  const stats = taskStats(records || [], tasks || []);
  const known = new Map(stats.known.map(function (row) { return [row.taskId, row]; }));
  const taskIds = new Set((tasks || []).map(function (task) { return task.id; }));
  const list = (points || POINTS).map(function (point) {
    const owned = (point.tasks || []).filter(function (id) { return taskIds.has(id); });
    let passed = 0;
    let kept = 0;
    owned.forEach(function (id) {
      const row = known.get(id);
      if (!row) return;
      if (row.best >= PASS_SCORE) {
        passed += 1;
        kept += decayFactor(row.lastAt, now);
      }
    });
    const coverage = owned.length ? passed / owned.length : 0;
    const retention = passed ? kept / passed : 0;
    const mastery = coverage * 0.6 + coverage * retention * 0.4;
    return {
      id: point.id,
      name: point.name,
      module: point.module,
      total: owned.length,
      passed: passed,
      coverage: Number(coverage.toFixed(3)),
      retention: Number(retention.toFixed(3)),
      mastery: Number(mastery.toFixed(3)),
      level: masteryLevel(mastery, owned.length, passed)
    };
  });
  return list;
}

export function masteryReport(records, tasks, options) {
  const opts = options || {};
  const now = opts.now || new Date().toISOString();
  const rows = pointMastery(records, tasks, opts.points || POINTS, { now: now });
  const withTasks = rows.filter(function (row) { return row.total > 0; });
  // 排序口径（可解释，且比"纯按掌握度"实用）：
  //   ① 练过但没拿下（0 < 覆盖度 < 0.75）排最前——已经开头了，收尾最快；
  //   ② 完全没练的次之，**按题数升序**（先啃小的，尽快建立覆盖）；
  //   ③ 已熟练的垫底（先别管）。
  const tier = function (row) {
    if (row.passed > 0 && row.mastery < 0.75) return 0;
    if (row.passed === 0) return 1;
    return 2;
  };
  const ranked = withTasks.slice().sort(function (a, b) {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    if (ta === 1) {
      if (a.total !== b.total) return a.total - b.total;
      return a.mastery - b.mastery;
    }
    if (a.mastery !== b.mastery) return a.mastery - b.mastery;
    return b.total - a.total;
  });
  ranked.forEach(function (row) {
    if (row.passed === 0) row.reason = '还没练过（共 ' + row.total + ' 道，先啃小的）';
    else if (row.mastery < 0.75) row.reason = '练过 ' + row.passed + '/' + row.total + ' 道但还没拿下';
    else row.reason = '已经熟练（' + row.passed + '/' + row.total + '）';
  });
  const result = {
    now: now,
    points: rows.length,
    withTasks: withTasks.length,
    practiced: withTasks.filter(function (row) { return row.passed > 0; }).length,
    weakest: ranked.slice(0, Math.max(1, Number(opts.limit) || 5)),
    strongest: ranked.slice(-3).reverse(),
    rows: rows
  };
  // 今天先练哪几道：从最弱的知识点里挑**还没通过**的题，按难度从易到难
  const stats = taskStats(records || [], tasks || []);
  const passedIds = new Set(stats.known.filter(function (row) { return row.best >= PASS_SCORE; }).map(function (row) { return row.taskId; }));
  const taskIndex = new Map((tasks || []).map(function (task) { return [task.id, task]; }));
  const pool = [];
  result.weakest.forEach(function (row) {
    const point = (opts.points || POINTS).filter(function (item) { return item.id === row.id; })[0];
    if (!point) return;
    (point.tasks || []).forEach(function (id) {
      if (passedIds.has(id)) return;
      if (pool.some(function (item) { return item.id === id; })) return;
      const task = taskIndex.get(id);
      if (!task) return;
      pool.push({ id: id, title: task.title || id, track: task.track || '', level: task.level || '', pointId: row.id, pointName: row.name });
    });
  });
  const levelOrder = { easy: 0, medium: 1, hard: 2 };
  pool.sort(function (a, b) {
    const la = levelOrder[a.level] === undefined ? 1 : levelOrder[a.level];
    const lb = levelOrder[b.level] === undefined ? 1 : levelOrder[b.level];
    if (la !== lb) return la - lb;
    return a.id.localeCompare(b.id);
  });
  result.nextUp = pool.slice(0, Math.max(1, Number(opts.practiceLimit) || 5));
  result.command = 'node src/cli.mjs drill --tasks=' + result.nextUp.map(function (row) { return row.id; }).join(',');
  result.markdown = renderMastery(result);
  return result;
}

export function renderMastery(report) {
  const out = [];
  out.push('# 知识点掌握度');
  out.push('');
  out.push('- 有题的知识点 ' + report.withTasks + ' 个，其中练过 ' + report.practiced + ' 个；共 ' + report.points + ' 个知识点');
  out.push('- 口径：掌握度 = 覆盖度×0.6 + 覆盖度×近期保持×0.4；半衰期 30 天（越久没练越打折）');
  out.push('');
  out.push('## 最弱的 ' + report.weakest.length + ' 个（先补这些）');
  out.push('');
  out.push('| 知识点 | 模块 | 通过 / 总题 | 掌握度 | 档位 | 为什么先练它 |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  report.weakest.forEach(function (row) {
    out.push('| ' + row.name + ' | ' + row.module + ' | ' + row.passed + ' / ' + row.total + ' | '
      + String(Math.round(row.mastery * 100)) + '% | ' + row.level + ' | ' + (row.reason || '') + ' |');
  });
  if (report.strongest.length) {
    out.push('');
    out.push('## 掌握较好的');
    out.push('');
    report.strongest.forEach(function (row) {
      out.push('- ' + row.name + '（' + String(Math.round(row.mastery * 100)) + '%，' + row.passed + '/' + row.total + '）');
    });
  }
  out.push('');
  if (report.nextUp && report.nextUp.length) {
    out.push('## 今天先练这 ' + report.nextUp.length + ' 道');
    out.push('');
    report.nextUp.forEach(function (row) {
      out.push('- ' + row.id + '　[' + row.track + ']　' + row.title + '　（来自 ' + row.pointName + '）');
    });
    out.push('');
    out.push('```');
    out.push(report.command);
    out.push('```');
    out.push('');
  }
  out.push('> 掌握度是**可复算的估计**，不是考试认证：它只反映你在这套题上的通过情况与新鲜度。');
  return out.join('\n') + '\n';
}
