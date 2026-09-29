// 由 docs/capabilities.json 生成 docs/CAPABILITIES.md（数据是唯一事实源，文档只是渲染结果）。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rows = JSON.parse(readFileSync(join(ROOT, 'docs/capabilities.json'), 'utf8'));

function cell(c) {
  const text = c.marker ? ('有：' + c.marker) : ('缺：' + (c.why || ''));
  return text.replace(/\|/g, '/').slice(0, 40);
}

const out = [];
out.push('# 三端能力对照表');
out.push('');
out.push('> 本文档由 docs/capabilities.json 生成，请勿手改：改数据后运行 node scripts/capabilities-doc.mjs，'
  + '再用 node --test test/capability-matrix.test.mjs 验证。');
out.push('');
out.push('这张表回答一个问题：**同一个能力，CLI / 接口 / 网页版 / 原生端 四处是不是都有。**');
out.push('守卫会逐个去源码里找「有」后面的标记；标了「缺」的必须真的缺，并写明原因。');
out.push('');
out.push('| 能力 | CLI | 接口 | 网页版 | 原生端 | 用例 | 实测证据 |');
out.push('| --- | --- | --- | --- | --- | --- | --- |');
rows.forEach(function (row) {
  const evidence = row.evidence ? ('[' + row.evidence.replace(/^docs\//, '') + '](' + row.evidence + ')') : '—';
  const line = '| ' + row.name + ' | ' + cell(row.cli) + ' | ' + cell(row.api) + ' | ' + cell(row.web)
    + ' | ' + cell(row.native) + ' | ' + row.test + ' | ' + evidence + ' |';
  out.push(line);
});
out.push('');
const absent = [];
rows.forEach(function (row) {
  ['cli', 'api', 'web', 'native'].forEach(function (surface) {
    if (row[surface].absent) absent.push('- ' + row.name + ' · ' + surface + '：' + row[surface].why);
  });
});
out.push('## 故意缺失的入口（' + absent.length + ' 处）');
out.push('');
if (!absent.length) out.push('无——四端都有。');
absent.forEach(function (line) { out.push(line); });
out.push('');
writeFileSync(join(ROOT, 'docs/CAPABILITIES.md'), out.join(String.fromCharCode(10)));
console.log('已生成 docs/CAPABILITIES.md：' + rows.length + ' 项能力，' + absent.length + ' 处故意缺失');
