// 完成报告分卷的守卫：拆完之后最容易出的事是「搬丢了、搬重了、索引指向不存在的卷」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { readVolumes, sectionNumbers, volumeFor } = await import('../scripts/report-doc.mjs');
const index = readFileSync(join(ROOT, 'docs/COMPLETION-REPORT.md'), 'utf8');

test('完成报告分卷：小节不丢、不重、不跳号', function () {
  const volumes = readVolumes();
  assert.ok(volumes.length >= 1, '至少要有一卷');
  const all = [];
  volumes.forEach(function (row) { row.numbers.forEach(function (n) { all.push(Number(n.split('.')[1])); }); });
  const seen = new Set();
  const dup = [];
  all.forEach(function (n) { if (seen.has(n)) dup.push(n); seen.add(n); });
  assert.deepEqual(dup, [], '有小节被搬重了：5.' + dup.join(' / 5.'));
  const sorted = all.slice().sort(function (a, b) { return a - b; });
  assert.equal(sorted[0], 1, '应从 5.1 开始');
  for (let i = 1; i < sorted.length; i += 1) {
    assert.equal(sorted[i], sorted[i - 1] + 1, '小节号跳号：5.' + sorted[i - 1] + ' 之后是 5.' + sorted[i]);
  }
  assert.ok(sorted.length >= 211, '小节总数不该少于拆分时的 211：' + sorted.length);
});

test('完成报告分卷：每卷的小节号都落在它文件名声明的区间里', function () {
  readVolumes().forEach(function (row) {
    const m = row.name.match(/^rounds-([0-9]{3})-([0-9]{3})\.md$/);
    assert.ok(m, '卷名格式不对：' + row.name);
    const start = Number(m[1]);
    const end = Number(m[2]);
    row.numbers.forEach(function (n) {
      const num = Number(n.split('.')[1]);
      assert.ok(num >= start && num <= end, row.name + ' 里出现了区间外的小节 5.' + num);
      assert.equal(volumeFor(num).file, row.name, 'volumeFor 与卷名算法不一致：5.' + num);
    });
  });
});

test('完成报告索引：目录覆盖每一卷，计数与卷内实际一致，头尾章节都在', function () {
  const volumes = readVolumes();
  volumes.forEach(function (row) {
    assert.ok(index.indexOf('(report/' + row.name + ')') > -1, '索引里没有列出 ' + row.name);
    // 目录行形如：| 2 | 5.51 – 5.100 | 50 | [rounds-051-100.md](report/rounds-051-100.md) |
    const tocLine = index.split('\n').filter(function (line) { return line.indexOf('(report/' + row.name + ')') > -1; })[0] || '';
    const cols = tocLine.split('|').map(function (x) { return x.trim(); });
    assert.ok(cols.length >= 5, row.name + ' 的目录行格式不对：' + tocLine);
    assert.equal(cols[3], String(row.numbers.length), row.name + ' 的计数与索引写的不一致：' + tocLine);
    // cols[2] 是「起始 – 结束」的区间列，只校验它与卷内实际首尾一致
    assert.equal(cols[2].indexOf(row.numbers[0]), 0, row.name + ' 的区间开头与卷内不一致：' + tocLine);
    assert.ok(cols[2].indexOf(row.numbers[row.numbers.length - 1]) > -1, row.name + ' 的区间结尾与卷内不一致：' + tocLine);
  });
  const total = volumes.reduce(function (sum, row) { return sum + row.numbers.length; }, 0);
  assert.ok(index.indexOf('共 **' + total + '** 节逐轮记录') > -1, '索引里的总数应为 ' + total);
  assert.ok(index.indexOf('## 1. 结论') > -1, '头部章节要在索引里');
  assert.ok(index.indexOf('## 6. 运行入口') > -1, '尾部章节要在索引里');
  assert.equal(existsSync(join(ROOT, 'docs/report/00-head.md')), true, '头部源文件要在');
  assert.equal(existsSync(join(ROOT, 'docs/report/99-tail.md')), true, '尾部源文件要在');
});

test('完成报告索引是生成的：重跑 report-doc 一字不差', function () {
  const before = readFileSync(join(ROOT, 'docs/COMPLETION-REPORT.md'), 'utf8');
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/report-doc.mjs')], { encoding: 'utf8' });
  assert.equal(run.status, 0, '生成脚本要能跑：' + String(run.stderr || '').slice(0, 200));
  assert.equal(readFileSync(join(ROOT, 'docs/COMPLETION-REPORT.md'), 'utf8'), before, '索引与分卷不一致，请重跑 node scripts/report-doc.mjs');
});
