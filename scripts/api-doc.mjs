// 由 docs/api-contract.json 生成 docs/API.md（数据是唯一事实源）。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const contract = JSON.parse(readFileSync(join(ROOT, 'docs/api-contract.json'), 'utf8'));
const out = [];
out.push('# HTTP 接口清单');
out.push('');
out.push('> 本文档由 docs/api-contract.json 生成，请勿手改：改数据后运行 node scripts/api-doc.mjs，再用 node --test test/api-contract.test.mjs 验证。');
out.push('');
out.push('这份清单与 `src/web/api.mjs` **双向绑定**：代码里出现的路由 / action 必须在这里登记，登记了也必须存在（守卫会逐个核对）。');
out.push('');
out.push('响应约定：' + contract.envelope.success + '；' + contract.envelope.failure + '。');
out.push('');
out.push('## 路由（' + contract.routes.length + ' 条）');
out.push('');
out.push('| 路由 | 用途 |');
out.push('| --- | --- |');
contract.routes.forEach(function (row) { out.push('| `' + row.path + '` | ' + row.purpose + ' |'); });
out.push('');
out.push('## POST 动作（' + contract.actions.length + ' 个）');
out.push('');
out.push('| action | 所在路由 | 识别的字段 | 说明 |');
out.push('| --- | --- | --- | --- |');
contract.actions.forEach(function (row) {
  const ids = (row.identifiers || []).length ? row.identifiers.map(function (x) { return '`' + x + '`'; }).join(' / ') : '—（批量，不需要）';
  out.push('| `' + row.name + '` | ' + row.route + ' | ' + ids + ' | ' + row.note + ' |');
});
out.push('');
writeFileSync(join(ROOT, 'docs/API.md'), out.join(String.fromCharCode(10)));
console.log('已生成 docs/API.md：' + contract.routes.length + ' 条路由 / ' + contract.actions.length + ' 个 action');
