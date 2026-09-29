// 静态「用了但没声明」守卫（差分口径）：只拦新增，存量基线在 docs/lint-unresolved-baseline.json。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compareBaseline, lintRepository, loadBaseline } from '../scripts/lint-unresolved.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('生产代码里没有新增的用了但没声明的名字（漏 import 会被拦下）', function () {
  const report = lintRepository(ROOT);
  const baseline = loadBaseline(ROOT);
  assert.equal(baseline.missing, false, '缺基线文件，先跑 node scripts/lint-unresolved.mjs --update');
  const diff = compareBaseline(report, baseline);
  const added = diff.added.map(function (row) { return row.file + ':' + row.name; });
  assert.deepEqual(added, [], '这些名字用了但没声明：' + added.join(' | ') + '（确认是误报后跑 --update 更新基线）');
});

test('守卫扫面足够大，且基线不膨胀（误报不能当垃圾桶）', function () {
  const report = lintRepository(ROOT);
  assert.ok(report.files >= 60, '扫到的生产文件太少，扫面可能失效：' + report.files);
  assert.ok(report.findings.length <= 300, '存量过多说明误报失控，该收紧分析器或写清原因：' + report.findings.length);
  const baseline = loadBaseline(ROOT);
  assert.ok(baseline.entries.length >= report.findings.length - 5, '基线要覆盖当前存量（只允许已修掉少量）');
});
