// 三端能力对照表：文档与代码必须一致（这张表的价值就在于能自动验，否则又是手工台账）。
//
// 背景：第 12 轮发现原生端投递时间线写好了却没接线、原生语料检索从来没发出去过，
// 都是靠人工读代码才发现的。这份守卫把每个能力在 CLI / 接口 / 网页 / 原生 四处是否存在钉住：
//   · 声明存在的：必须能在指定文件里找到标记；
//   · 声明缺失的：标记必须真的不在（否则表过期了），且必须写清为什么缺。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rows = JSON.parse(readFileSync(join(ROOT, 'docs/capabilities.json'), 'utf8'));
const cache = new Map();
function read(rel) {
  if (!cache.has(rel)) {
    const full = join(ROOT, rel);
    assert.ok(existsSync(full), '对照表指向的文件不存在：' + rel);
    cache.set(rel, readFileSync(full, 'utf8'));
  }
  return cache.get(rel);
}

test('能力对照表：声明的入口必须真实存在，声明缺失的必须真的缺', function () {
  assert.ok(rows.length >= 15, '对照表太短了：' + rows.length);
  const ids = rows.map(function (row) { return row.id; });
  assert.equal(new Set(ids).size, ids.length, '能力 id 不能重复');
  const problems = [];
  rows.forEach(function (row) {
    ['cli', 'api', 'web', 'native'].forEach(function (surface) {
      const cell = row[surface];
      assert.ok(cell, row.id + ' 缺 ' + surface + ' 这一列（缺失也要如实写 absent + why）');
      if (cell.marker) {
        if (read(cell.file).indexOf(cell.marker) === -1) {
          problems.push(row.id + '.' + surface + '：声称有，但 ' + cell.file + ' 里找不到该标记');
        }
        return;
      }
      assert.equal(cell.absent, true, row.id + '.' + surface + ' 要么给 marker，要么标 absent');
      assert.ok((cell.why || '').length > 8, row.id + '.' + surface + ' 标了缺失却没写原因');
      // 没有 file 的格子（整端不做）只需要写清原因，不必去读文件；有 file 才去确认'真的缺'
      if (cell.file && cell.check && read(cell.file).indexOf(cell.check) > -1) {
        problems.push(row.id + '.' + surface + '：标了缺失，但 ' + cell.file + ' 里已经出现该标记——表该更新了');
      }
    });
    assert.ok(read(row.test), row.id + ' 的用例文件为空：' + row.test);
    if (row.evidence) {
      // 证据截图（含本机数据）与真实岗位原文（第三方内容）不随公开仓库发布：
      // 本地存在就校验，干净克隆里不存在时跳过——否则公开仓库的 CI 会永远红。
      const localOnly = row.evidence.indexOf('docs/evidence/') === 0 || row.evidence.indexOf('docs/samples/boss/') === 0;
      if (!localOnly) {
        assert.ok(existsSync(join(ROOT, row.evidence)), row.id + ' 声明的证据文件不在：' + row.evidence);
      }
    }
  });
  assert.deepEqual(problems, [], problems.join('；'));
});

test('能力对照表文档与数据同源（CAPABILITIES.md 由脚本生成）', function () {
  const doc = readFileSync(join(ROOT, 'docs/CAPABILITIES.md'), 'utf8');
  assert.ok(doc.indexOf('由 docs/capabilities.json 生成') > -1, '文档要说明自己是生成的');
  rows.forEach(function (row) {
    assert.ok(doc.indexOf('| ' + row.name + ' |') > -1, '文档里缺这一行：' + row.name);
  });
  assert.ok(doc.indexOf('| 能力 | CLI | 接口 | 网页版 | 原生端 | 用例 | 实测证据 |') > -1, '表头要与脚本一致');
});
