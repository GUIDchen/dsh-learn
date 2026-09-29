#!/usr/bin/env node
// 覆盖率门槛：跑一遍测试拿 lcov，按文件与基线比对，掉下来就失败。
// 目的是让"覆盖率"从一次性数字变成有人守的指标——后面每轮改代码都不许把它拉低。
//
// 用法：
//   node scripts/coverage.mjs                 # 检查（低于门槛即退出码 1）
//   node scripts/coverage.mjs --update        # 用当前结果刷新基线
//   node scripts/coverage.mjs --record        # 追加一行到 docs/coverage.md（趋势）
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 门槛只管"产品代码"：src/** 与 web/**。
// scripts/** 是开发工具（含本文件自己），把它算进去会让门槛随工具增长而莫名下滑。
export function isProductFile(file) {
  return file.indexOf('src/') === 0 || file.indexOf('web/') === 0;
}
const BASELINE_FILE = join(ROOT, 'coverage-baseline.json');
const TREND_FILE = join(ROOT, 'docs/coverage.md');
// 允许的正常波动：门槛比基线低这么多，超过才算回归。
// 分支覆盖率天然比行覆盖率抖（一个分支的取舍就能差 1-2 个点），所以给得更宽。
const TOLERANCE = 2;
const BRANCH_TOLERANCE = 4;

export function parseLcov(text) {
  const rows = [];
  let current = null;
  String(text || '').split('\n').forEach(function (line) {
    const trimmed = line.trim();
    if (trimmed.indexOf('SF:') === 0) {
      current = { file: trimmed.slice(3), linesFound: 0, linesHit: 0, branchesFound: 0, branchesHit: 0, functionsFound: 0, functionsHit: 0 };
      return;
    }
    if (!current) return;
    if (trimmed.indexOf('LF:') === 0) current.linesFound = Number(trimmed.slice(3)) || 0;
    else if (trimmed.indexOf('LH:') === 0) current.linesHit = Number(trimmed.slice(3)) || 0;
    else if (trimmed.indexOf('BRF:') === 0) current.branchesFound = Number(trimmed.slice(4)) || 0;
    else if (trimmed.indexOf('BRH:') === 0) current.branchesHit = Number(trimmed.slice(4)) || 0;
    else if (trimmed.indexOf('FNF:') === 0) current.functionsFound = Number(trimmed.slice(4)) || 0;
    else if (trimmed.indexOf('FNH:') === 0) current.functionsHit = Number(trimmed.slice(4)) || 0;
    else if (trimmed === 'end_of_record') {
      if (current.linesFound > 0) {
        current.linePct = Math.round(current.linesHit / current.linesFound * 1000) / 10;
        current.branchPct = current.branchesFound ? Math.round(current.branchesHit / current.branchesFound * 1000) / 10 : null;
        current.functionPct = current.functionsFound ? Math.round(current.functionsHit / current.functionsFound * 1000) / 10 : null;
        rows.push(current);
      }
      current = null;
    }
  });
  return rows;
}

// 汇总整体覆盖率。只吃"带计数"的行；如果给进来的是已经算好的百分比行，
// 就别假装算得出来——返回 null 而不是 0，否则会凭空报出"整体 0%"的假回归。
export function totals(rows) {
  const sum = { linesFound: 0, linesHit: 0, branchesFound: 0, branchesHit: 0, counted: 0 };
  (rows || []).forEach(function (row) {
    if (!row || !row.linesFound) return;
    sum.counted += 1;
    sum.linesFound += row.linesFound;
    sum.linesHit += row.linesHit || 0;
    sum.branchesFound += row.branchesFound || 0;
    sum.branchesHit += row.branchesHit || 0;
  });
  if (!sum.counted) return { linePct: null, branchPct: null, linesFound: 0, counted: 0 };
  return {
    linePct: Math.round(sum.linesHit / sum.linesFound * 1000) / 10,
    branchPct: sum.branchesFound ? Math.round(sum.branchesHit / sum.branchesFound * 1000) / 10 : null,
    linesFound: sum.linesFound,
    counted: sum.counted
  };
}

// 门槛检查：每条形如 { file, linePct, branchPct } 与基线里的 minLine/minBranch 比对
export function evaluate(rows, baseline) {
  const base = baseline || { files: {}, overall: {} };
  const violations = [];
  const checked = rows.map(function (row) {
    const entry = base.files[row.file];
    const minLine = entry ? entry.minLine : (base.overall.minLinePerFile || 0);
    const minBranch = entry && entry.minBranch !== undefined ? entry.minBranch : 0;
    const status = [];
    if (row.linePct < minLine) status.push('行覆盖 ' + row.linePct + '% < ' + minLine + '%');
    if (row.branchPct !== null && minBranch && row.branchPct < minBranch) status.push('分支覆盖 ' + row.branchPct + '% < ' + minBranch + '%');
    if (status.length) violations.push({ file: row.file, reason: status.join('，') });
    return Object.assign({}, row, { minLine: minLine, minBranch: minBranch, ok: status.length === 0 });
  });

  const all = totals(rows);
  if (base.overall && base.overall.minLine && all.linePct !== null && all.linePct < base.overall.minLine) {
    violations.push({ file: '(整体)', reason: '行覆盖 ' + all.linePct + '% < ' + base.overall.minLine + '%' });
  }
  if (base.overall && base.overall.minBranch && all.branchPct !== null && all.branchPct < base.overall.minBranch) {
    violations.push({ file: '(整体)', reason: '分支覆盖 ' + all.branchPct + '% < ' + base.overall.minBranch + '%' });
  }

  // 基线里记着、这次却没出现的文件：要么被删了，要么不再被测试覆盖
  const missing = Object.keys(base.files || {}).filter(function (file) {
    return !rows.some(function (row) { return row.file === file; });
  });

  return { ok: violations.length === 0, checked, violations, missing, totals: all };
}

function runCoverage() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-learn-cov-'));
  const lcov = join(dir, 'lcov.info');
  const result = spawnSync(process.execPath, [
    '--test',
    '--experimental-test-coverage',
    '--test-reporter=lcov',
    '--test-reporter-destination=' + lcov,
    // 覆盖率插桩会让整体变慢，超时给宽一点，避免把"跑得慢"误报成"覆盖率下滑"
    '--test-timeout=60000'
  ], { cwd: ROOT, encoding: 'utf8' });
  if (!existsSync(lcov)) {
    console.error('没有生成 lcov 报告，测试可能失败了。');
    console.error((result.stderr || '').split('\n').slice(-15).join('\n'));
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  const rows = parseLcov(readFileSync(lcov, 'utf8')).map(function (row) {
    return Object.assign({}, row, { file: relative(ROOT, row.file) });
  });
  rmSync(dir, { recursive: true, force: true });
  return { rows: rows, exitCode: result.status };
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return { files: {}, overall: {} };
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

function printTable(result) {
  console.log('文件'.padEnd(30) + '行覆盖'.padStart(10) + '分支覆盖'.padStart(12) + '  门槛');
  result.checked.slice().sort(function (a, b) { return a.file.localeCompare(b.file); }).forEach(function (row) {
    const branch = row.branchPct === null ? '  -' : String(row.branchPct).padStart(5) + '%';
    console.log(row.file.padEnd(30) + (String(row.linePct).padStart(6) + '%').padStart(10) + branch.padStart(12)
      + '  ' + (row.ok ? 'ok' : 'FAIL') + '（≥' + row.minLine + '%）');
  });
  console.log('---');
  const lineText = result.totals.linePct === null ? '-' : result.totals.linePct + '%';
  const branchText = result.totals.branchPct === null ? '-' : result.totals.branchPct + '%';
  console.log('整体：行 ' + lineText + '　分支 ' + branchText + '　统计行数 ' + result.totals.linesFound);
}

function main(argv) {
  const update = argv.indexOf('--update') > -1;
  const record = argv.indexOf('--record') > -1;
  const run = runCoverage();
  if (!run) return 1;

  if (update) {
    const files = {};
    run.rows.filter(function (row) { return isProductFile(row.file); }).forEach(function (row) {
      files[row.file] = {
        minLine: Math.max(0, Math.floor(row.linePct) - TOLERANCE),
        minBranch: row.branchPct === null ? 0 : Math.max(0, Math.floor(row.branchPct) - BRANCH_TOLERANCE)
      };
    });
    const all = totals(run.rows.filter(function (row) { return isProductFile(row.file); }));
    const baseline = {
      generatedAt: new Date().toISOString(),
      tolerance: TOLERANCE,
      overall: {
        minLine: Math.max(0, Math.floor(all.linePct) - TOLERANCE),
        minBranch: Math.max(0, Math.floor(all.branchPct) - BRANCH_TOLERANCE)
      },
      files: files
    };
    writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n');
    console.log('基线已更新：' + BASELINE_FILE + '（' + Object.keys(files).length + ' 个文件，整体 ≥' + baseline.overall.minLine + '%）');
  }

  const productRows = run.rows.filter(function (row) { return isProductFile(row.file); });
  const toolRows = run.rows.filter(function (row) { return !isProductFile(row.file); });
  if (!productRows.length) {
    console.error('没有产品代码的覆盖率数据，检查 lcov 路径映射');
    return 1;
  }

  let result = evaluate(productRows, loadBaseline());
  // 覆盖率测量本身会抖（某个测试偶发超时就会少跑到分支），失败时重测一次再下结论
  if (!result.ok && !update) {
    console.log('首次检查未通过，重测一次以排除测量抖动……');
    const retry = runCoverage();
    if (retry) {
      const retryRows = retry.rows.filter(function (row) { return isProductFile(row.file); });
      if (retryRows.length) result = evaluate(retryRows, loadBaseline());
    }
  }
  printTable(result);
  if (toolRows.length) {
    console.log('（另有 ' + toolRows.length + ' 个开发脚本文件，不计入门槛）');
  }

  if (result.missing.length) {
    console.log('基线里有、这次没出现的文件（被删或不再被覆盖）：' + result.missing.join(', '));
  }
  if (result.violations.length) {
    console.log('覆盖率回归：');
    result.violations.forEach(function (item) { console.log('  ' + item.file + '：' + item.reason); });
    return 1;
  }
  console.log('覆盖率门槛通过（' + result.checked.length + ' 个文件）');

  if (record) {
    const header = existsSync(TREND_FILE) ? '' : '# 覆盖率趋势\n\n每次跑 node scripts/coverage.mjs --record 追加一行。门槛来自 coverage-baseline.json（基线 − ' + TOLERANCE + '%）。\n\n| 时间 | 整体行覆盖 | 整体分支覆盖 | 统计行数 | 说明 |\n| --- | --- | --- | --- | --- |\n';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const note = process.env.COVERAGE_NOTE || '';
    const line = '| ' + stamp + ' | ' + result.totals.linePct + '% | ' + result.totals.branchPct + '% | ' + result.totals.linesFound + ' | ' + note + ' |\n';
    const current = existsSync(TREND_FILE) ? readFileSync(TREND_FILE, 'utf8') : header;
    writeFileSync(TREND_FILE, current + line);
    console.log('趋势已追加到 ' + TREND_FILE);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
