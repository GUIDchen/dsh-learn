// 覆盖率门槛的单元测试：解析 lcov 与门槛判定这两块逻辑必须可靠，
// 否则"覆盖率门禁"要么误报、要么形同虚设。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLcov, totals, evaluate } from '../scripts/coverage.mjs';

const LCOV = [
  'TN:',
  'SF:/repo/src/core/judge.mjs',
  'FNF:10',
  'FNH:9',
  'BRF:40',
  'BRH:36',
  'LF:100',
  'LH:99',
  'end_of_record',
  'SF:/repo/src/store.mjs',
  'BRF:20',
  'BRH:10',
  'LF:50',
  'LH:40',
  'end_of_record',
  'SF:/repo/src/empty.mjs',
  'LF:0',
  'LH:0',
  'end_of_record'
].join('\n');

test('parseLcov 解析行/分支/函数数据并算百分比', function () {
  const rows = parseLcov(LCOV);
  assert.equal(rows.length, 2, '没有行数的记录应被跳过');
  const judge = rows[0];
  assert.equal(judge.file, '/repo/src/core/judge.mjs');
  assert.equal(judge.linesFound, 100);
  assert.equal(judge.linePct, 99);
  assert.equal(judge.branchPct, 90);
  assert.equal(judge.functionPct, 90);
  const store = rows[1];
  assert.equal(store.linePct, 80);
  assert.equal(store.branchPct, 50);
  assert.equal(store.functionPct, null, '没有函数数据时为 null');
});

test('parseLcov 对空输入与残缺输入不炸', function () {
  assert.deepEqual(parseLcov(''), []);
  assert.deepEqual(parseLcov(null), []);
  assert.deepEqual(parseLcov('LF:10\nLH:5'), [], '没有 SF 的记录不产出');
  const partial = parseLcov('SF:a.mjs\nLF:10\nend_of_record');
  assert.equal(partial.length, 1);
  assert.equal(partial[0].linePct, 0);
  assert.equal(partial[0].branchPct, null);
});

test('totals 汇总整体覆盖率', function () {
  const all = totals(parseLcov(LCOV));
  assert.equal(all.linesFound, 150);
  assert.equal(all.linePct, 92.7);
  assert.equal(all.branchPct, 76.7);
  assert.equal(totals([]).linePct, null, '空输入算不出整体覆盖率，给 null 而不是假 0');
  assert.equal(totals([{ file: 'x', linePct: 90, branchPct: 80 }]).linePct, null, '只有百分比没有计数也算不出来');
});

test('evaluate 在门槛之上通过、之下失败', function () {
  // 真实调用链里给的是带计数的行（这样整体覆盖率才算得出来）
  const rows = parseLcov(LCOV).map(function (row) {
    return Object.assign({}, row, { file: row.file.replace('/repo/', '') });
  });
  const baseline = {
    overall: { minLine: 90, minBranch: 70, minLinePerFile: 0 },
    files: {
      'src/core/judge.mjs': { minLine: 95, minBranch: 85 },
      'src/store.mjs': { minLine: 85, minBranch: 60 }
    }
  };
  const okResult = evaluate(rows, baseline);
  assert.equal(okResult.violations.length, 1, 'store.mjs 行覆盖 80% < 85% 应被判违规');
  assert.match(okResult.violations[0].reason, /行覆盖 80% < 85%/);
  assert.equal(okResult.checked.filter(function (row) { return row.file === 'src/core/judge.mjs'; })[0].ok, true);

  const strict = evaluate(rows, { overall: { minLine: 95 }, files: {} });
  assert.equal(strict.violations.some(function (item) { return item.file === '(整体)'; }), true, '整体不达标要报出来');
});

test('给了已经算好的百分比时不凭空报"整体 0%"', function () {
  const result = evaluate([{ file: 'src/a.mjs', linePct: 90, branchPct: 80 }], { overall: { minLine: 50, minBranch: 50 }, files: {} });
  assert.equal(result.totals.linePct, null, '没有计数就不该给出整体百分比');
  assert.deepEqual(result.violations, [], '不应因为算不出整体而误报');
});

test('evaluate 会指出基线里有、这次没出现的文件', function () {
  const result = evaluate([{ file: 'src/a.mjs', linePct: 100, branchPct: 100 }], {
    overall: {},
    files: { 'src/a.mjs': { minLine: 90 }, 'src/gone.mjs': { minLine: 90 } }
  });
  assert.deepEqual(result.missing, ['src/gone.mjs']);
  assert.equal(result.ok, true, '文件消失只是提示，不算回归');
});

test('evaluate 对没有基线条目的文件用整体下限兜底', function () {
  const result = evaluate([{ file: 'src/new.mjs', linePct: 50, branchPct: 50 }], {
    overall: { minLinePerFile: 60 },
    files: {}
  });
  assert.equal(result.ok, false);
  assert.match(result.violations[0].reason, /行覆盖 50% < 60%/);
});
