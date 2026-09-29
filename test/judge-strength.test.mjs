// 判定强度护栏：题库里不许出现"要素写了两个、实际只判一个"的题。
// 背景：难度口径只数要素条数，但要素能不能判住才是关键；这样的题会拉高通过率、让计划失真。
import test from 'node:test';
import assert from 'node:assert/strict';
import { sweep } from '../scripts/judge-sweep.mjs';

const SOFT_BASELINE = 2;

test('没有"要素≥2 却只写工具名就满分"的题', function () {
  const report = sweep('darwin');
  assert.ok(report.total >= 500, '扫的题目太少，先看看题库加载：' + report.total);
  assert.deepEqual(report.holes.map(function (row) { return row.id + '（' + row.elements + ' 要素）'; }), [],
    '这些题的某个要素等于没判：');
});

test('偏软题（只写工具名就满分）不超过基线', function () {
  const report = sweep('darwin');
  assert.ok(report.soft.length <= SOFT_BASELINE,
    '偏软题变多了（基线 ' + SOFT_BASELINE + '）：' + report.soft.map(function (row) { return row.id; }).join('、')
    + '——如果是有意为之，请同时更新 scripts/judge-sweep.mjs 里的 SOFT_BASELINE 并写清理由');
  // 基线里那两道要说明白：它们不是漏洞，正确答案本身就是裸命令
  report.soft.forEach(function (row) {
    assert.equal(row.elements, 1, '偏软题应当是单要素题（多要素还能被工具名骗过就是漏洞了）：' + row.id);
  });
});

test('换个平台扫也一样（win32 / linux 的变体不能漏判）', function () {
  ['linux', 'win32'].forEach(function (platform) {
    const report = sweep(platform);
    assert.deepEqual(report.holes.map(function (row) { return row.id; }), [], platform + ' 平台出现漏洞：');
  });
});
