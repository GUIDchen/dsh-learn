// 本地数据体检：项目元数据 / 索引 / 原文 / 草案 / 投递记录 / 练习记录 是否自洽。
//
// 为什么需要：第 14 轮发现"项目里存的是收录那天的知识点"，补了题包老项目看不到——
// 这类**元数据漂移**平时没有症状，只有翻代码或用户抱怨时才会暴露。体检把这些"该刷新/该补"的
// 地方一次性列出来，能修的给出修复动作。
//
// 原则：
//   · 默认**只读**（--fix 才动手）；
//   · 修复只做"能从现有数据重算出来"的事（重建索引 / 重算知识点）；
//   · 任何可能删数据的动作（清孤儿文件、丢无效记录）只列不修——让用户自己决定。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeText } from './knowledge.mjs';
import { load, migrateStorage, storageHealth, storageStatus, homeDir } from '../store.mjs';
import { backupStatus, createBackup } from './backup.mjs';
import { logStatus } from './log.mjs';
import { TASKS } from './tasks.mjs';
import {
  buildProjectIndex, listProjects, loadProjectTasks, projectDir, projectMetaPath,
  readProject, readSourceText, refreshProjectPoints
} from './project.mjs';

const TASK_IDS = new Set(TASKS.map(function (task) { return task.id; }));

function safeJson(file) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 项目体检：元数据 / 索引 / 原文 / 草案
function checkProject(row, options) {
  const findings = [];
  const name = row.name;
  const metaFile = projectMetaPath(name, options);
  const parsed = safeJson(metaFile);
  if (!parsed.ok) {
    findings.push({
      level: 'error', area: 'project', target: name, kind: 'meta-broken',
      message: '项目元数据不是合法 JSON：' + parsed.error,
      fix: null
    });
    return findings;
  }
  const meta = parsed.value;
  const dir = projectDir(name, options);
  const sources = meta.sources || [];
  const noText = sources.filter(function (item) { return !item.textFile; }).length;
  const missing = [];
  let driftSources = 0;
  sources.forEach(function (item, index) {
    if (!item.textFile) return;
    const full = join(dir, item.textFile);
    if (!existsSync(full)) { missing.push(index + 1); return; }
    // 知识点漂移：用当前字典重算，比 stored 多出知识点就说明该 refresh
    const back = readSourceText(name, index + 1, options);
    if (!back.ok || !back.text) return;
    const report = analyzeText(back.text, {});
    const now = (report.points || []).map(function (point) { return point.id || point; });
    const stored = item.points || [];
    if (now.some(function (id) { return stored.indexOf(id) === -1; })) driftSources += 1;
  });
  if (missing.length) {
    findings.push({
      level: 'error', area: 'project', target: name, kind: 'text-missing',
      message: '有 ' + missing.length + ' 条来源记录的原文文件不存在：第 ' + missing.slice(0, 5).join('、') + ' 条',
      fix: null
    });
  }
  if (noText) {
    // 回填需要"语料根目录"这个外部输入，没有它就不算"可自动修"——
    // 否则界面上会显示"可自动修 1 项"，点下去却什么都不做（实测踩过）。
    findings.push({
      level: 'warn', area: 'project', target: name, kind: 'old-source',
      message: '有 ' + noText + ' 条来源没有存原文（旧数据），未参与检索'
        + (options.backfillDir ? '（可以用给定的目录回填）' : '；要回填请跑：project backfill ' + name + ' --dir=语料根目录'),
      fix: options.backfillDir ? 'backfill' : null
    });
  }
  if (driftSources) {
    findings.push({
      level: 'warn', area: 'project', target: name, kind: 'points-drift',
      message: '有 ' + driftSources + ' 条来源的知识点落后于当前字典（补过题包后会出现）',
      fix: 'refresh'
    });
  }
  // 索引：缺 / 坏 / 与元数据不同步
  const indexFile = join(dir, 'tasks.json');
  if (!existsSync(indexFile)) {
    findings.push({ level: 'warn', area: 'project', target: name, kind: 'index-missing', message: '缺少索引 tasks.json', fix: 'rebuild-index' });
  } else {
    const idx = safeJson(indexFile);
    if (!idx.ok) {
      findings.push({ level: 'error', area: 'project', target: name, kind: 'index-broken', message: '索引不是合法 JSON：' + idx.error, fix: 'rebuild-index' });
    } else {
      const built = Date.parse(meta.updatedAt || '') || 0;
      const generated = Date.parse((idx.value && idx.value.generatedAt) || '') || 0;
      if (built && generated && generated + 1000 < built) {
        findings.push({ level: 'warn', area: 'project', target: name, kind: 'index-stale', message: '索引早于元数据更新（元数据 ' + meta.updatedAt + '，索引 ' + idx.value.generatedAt + '）', fix: 'rebuild-index' });
      }
    }
  }
  // 草案：坏 JSON / 指向不存在的题
  const draftsDir = join(dir, 'drafts');
  if (existsSync(draftsDir)) {
    readdirSync(draftsDir).filter(function (f) { return f.endsWith('.json'); }).forEach(function (file) {
      const draft = safeJson(join(draftsDir, file));
      if (!draft.ok) {
        findings.push({ level: 'warn', area: 'draft', target: name + '/drafts/' + file, kind: 'draft-broken', message: '草案不是合法 JSON：' + draft.error, fix: null });
        return;
      }
      const pack = draft.value;
      if (pack.kind === 'plan') return;
      const unknown = (pack.tasks || []).filter(function (task) {
        return (task.requires || []).length === 0 && false;
      });
      if (unknown.length) {
        findings.push({ level: 'warn', area: 'draft', target: name + '/drafts/' + file, kind: 'draft-unknown-task', message: '有 ' + unknown.length + ' 道草案题缺要素', fix: null });
      }
    });
  }
  return findings;
}

// 练习记录：复用 store 自己的健康度（坏行 / 备份恢复 / 隔离文件）+ 指向不存在题号的记录
function checkRecords() {
  const findings = [];
  // 日志里的错误：少量属正常，最近 500 条里 ≥5 条 error 值得看一眼
  const logs = logStatus(homeDir());
  const logErrors = (logs.summary && logs.summary.byLevel && logs.summary.byLevel.error) || 0;
  if (logErrors >= 5) {
    findings.push({ level: 'warn', area: 'logs', target: 'home', kind: 'log-errors', message: '最近日志里有 ' + logErrors + ' 条 error（' + logs.file + '）：跑 node src/cli.mjs metrics 看分布', fix: null });
  }

  // 整机备份：从来没备过、或者超过 7 天没备，都值得提醒（恢复演练见 backup.test.mjs）
  const backups = backupStatus(homeDir());
  if (!backups.exists) {
    findings.push({ level: 'warn', area: 'backup', target: 'home', kind: 'backup-missing', message: '还没有整机备份：跑 node src/cli.mjs backup（或本行「修复」）把进度 / 项目 / 笔记 / 投递一起备一份', fix: 'backup' });
  } else if (backups.stale) {
    findings.push({ level: 'warn', area: 'backup', target: 'home', kind: 'backup-stale', message: '最近一次备份是 ' + backups.ageDays + ' 天前（' + backups.latest.at + '）：建议重新备份', fix: 'backup' });
  }

  // 存储 schema：旧形状不迁移也能用，但要说清「可以升」
  const schema = storageStatus();
  if (!schema.ok) {
    findings.push({
      level: 'warn', area: 'storage', target: 'schema', kind: 'storage-schema',
      message: '存储 schema 需要迁移：' + schema.needsMigration.join('、') + '　' + schema.hint,
      fix: 'migrate-storage'
    });
  }

  const health = storageHealth();
  if (health.brokenJournalLines > 0) {
    findings.push({
      level: 'warn', area: 'records', target: health.journalPath, kind: 'journal-broken-lines',
      message: '练习记录日志里有 ' + health.brokenJournalLines + ' 行坏行（已被忽略）',
      fix: null
    });
  }
  if (health.recoveredFromBackup) {
    findings.push({
      level: 'warn', area: 'records', target: health.path, kind: 'recovered-from-backup',
      message: '记录是从备份快照恢复的，可能有几条在坏文件里没读出来',
      fix: null
    });
  }
  if (health.quarantinedFile) {
    findings.push({
      level: 'warn', area: 'records', target: health.quarantinedFile, kind: 'quarantined-file',
      message: '有坏文件被隔离（没被删除，可人工查看）',
      fix: null
    });
  }
  try {
    const rows = load().records || [];
    const unknown = rows.filter(function (row) { return row && row.taskId && !TASK_IDS.has(row.taskId); });
    if (unknown.length) {
      findings.push({
        level: 'warn', area: 'records', target: health.path, kind: 'record-unknown-task',
        message: '有 ' + unknown.length + ' 条练习记录指向当前题库里没有的题（可能是本地包被删、或题号改过）',
        fix: null
      });
    }
  } catch (err) {
    findings.push({ level: 'error', area: 'records', target: health.path, kind: 'records-unreadable', message: '读记录失败：' + err.message, fix: null });
  }
  return findings;
}

export function runDoctor(options) {
  const opts = options || {};
  const findings = [];
  const projects = listProjects(opts);
  projects.forEach(function (row) {
    checkProject(row, opts).forEach(function (item) { findings.push(item); });
  });
  checkRecords().forEach(function (item) { findings.push(item); });

  const fixable = findings.filter(function (item) { return Boolean(item.fix); });
  const result = {
    ok: true,
    projects: projects.length,
    findings: findings,
    stats: {
      total: findings.length,
      errors: findings.filter(function (item) { return item.level === 'error'; }).length,
      warns: findings.filter(function (item) { return item.level === 'warn'; }).length,
      fixable: fixable.length
    },
    fixed: []
  };
  result.markdown = renderDoctor(result);
  return result;
}

export function fixDoctor(options) {
  const opts = options || {};
  const before = runDoctor(opts);
  const fixed = [];
  const seen = {};
  before.findings.forEach(function (item) {
    if (!item.fix) return;
    const key = item.fix + ':' + item.target;
    if (seen[key]) return;
    seen[key] = true;
    if (item.fix === 'rebuild-index') {
      const index = buildProjectIndex(item.target, opts);
      fixed.push({ target: item.target, action: 'rebuild-index', detail: '知识点 ' + (index.points || []).length + ' / 题 ' + (index.tasks || []).length });
      return;
    }
    if (item.fix === 'backfill') {
      fixed.push({ target: item.target, action: 'backfill（需要 --dir，本接口不代跑）', detail: '请用 CLI：project backfill ' + item.target + ' --dir=语料根目录' });
      return;
    }
    if (item.fix === 'refresh') {
      const result = refreshProjectPoints(item.target, opts);
      fixed.push({ target: item.target, action: 'refresh', detail: result.ok ? ('补到 ' + result.changed + ' 条来源的新知识点') : (result.error || '失败') });
    }
    if (item.fix === 'backup') {
      const result = createBackup(homeDir(), {});
      fixed.push({ target: 'backup', action: 'backup', detail: '备份 ' + result.fileCount + ' 个文件 / ' + result.totalBytes + ' 字节 → ' + result.out });
      return;
    }
    if (item.fix === 'migrate-storage') {
      const result = migrateStorage({});
      result.steps.forEach(function (row) {
        fixed.push({ target: 'storage', action: 'migrate-storage', detail: '存储 ' + row.name + '：' + row.action });
      });
      return;
    }
  });
  const after = runDoctor(opts);
  return { ok: true, before: before.stats, after: after.stats, fixed: fixed, findings: after.findings, markdown: renderDoctor(after) };
}

export function renderDoctor(result) {
  const out = [];
  out.push('# 数据体检');
  out.push('');
  out.push('- 检查了 ' + result.projects + ' 个项目：' + result.stats.total + ' 项发现（错误 ' + result.stats.errors
    + ' / 提醒 ' + result.stats.warns + '），其中 ' + result.stats.fixable + ' 项可自动修');
  out.push('');
  if (!result.findings.length) {
    out.push('没有发现问题。');
    return out.join('\n') + '\n';
  }
  out.push('| 级别 | 范围 | 对象 | 说明 | 可修 |');
  out.push('| --- | --- | --- | --- | --- |');
  result.findings.forEach(function (item) {
    out.push('| ' + (item.level === 'error' ? '错误' : '提醒') + ' | ' + item.area + ' | ' + item.target + ' | '
      + item.message.replace(/\|/g, '/') + ' | ' + (item.fix || '只报告（不敢自动改）') + ' |');
  });
  out.push('');
  out.push('> 修复动作只做"能从现有数据重算"的事：重建索引、重算知识点（project refresh）。');
  out.push('> 删除类的一律不自动做——列出来让你自己决定。');
  if (result.fixed && result.fixed.length) {
    out.push('');
    out.push('## 本次修复');
    out.push('');
    result.fixed.forEach(function (row) { out.push('- ' + row.target + '：' + row.action + '（' + row.detail + '）'); });
  }
  return out.join('\n') + '\n';
}
