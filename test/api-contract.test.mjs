// 接口契约：代码里的路由 / action 与 docs/api-contract.json **双向一致**。
//
// 为什么需要：评审前踩过两次「同一份数据两种包装」（init 给 project 而 GET 给 meta；
// recommend 给 jobs 而 core 返回数组）。接口面一旦没有清单，形状漂移只能靠人偶然发现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// 路由按域拆到 src/web/routes/*.mjs 之后，「代码里出现的路由/action」要连它们一起扫，
// 否则守卫会误报「契约里多出」——这正是它该抓的漂移，所以扫面必须跟着代码结构走。
// 小路由实现（api-routes.mjs）与各域路由都要扫：改了文件布局就得让守卫跟上，
// 否则「搬走实现」会让对账静默失效（本轮项目域/学习域都遇到过）。
const api = [
  readFileSync(join(ROOT, 'src/web/api.mjs'), 'utf8'),
  readFileSync(join(ROOT, 'src/web/api-routes.mjs'), 'utf8')
].concat(
  readdirSync(join(ROOT, 'src/web/routes')).filter(function (name) { return name.endsWith('.mjs'); })
    .map(function (name) { return readFileSync(join(ROOT, 'src/web/routes', name), 'utf8'); })
).join(String.fromCharCode(10));
const contract = JSON.parse(readFileSync(join(ROOT, 'docs/api-contract.json'), 'utf8'));

test('接口契约：代码里的每个路由与 action 都已登记，登记了也都存在', function () {
  // 路由有两种写法：老的 if（pathname === '/api/x'）与新的路由表（'GET /api/x': fn）。
  // 表键必须一起收集，否则改成表驱动就等于绕过了契约对账（project 域那轮吃过一次）。
  const tableRoutes = [];
  const routeTableRe = /'([A-Z]+) (\/api\/[a-z0-9-]+)':/g;
  let routeHit;
  while ((routeHit = routeTableRe.exec(api)) !== null) tableRoutes.push(routeHit[2]);
  const codeRoutes = [...new Set([]
    .concat((api.match(/pathname === '[^']+'/g) || []).map(function (x) { return x.replace(/pathname === |'/g, ''); }))
    .concat(tableRoutes))].sort();
  // action 有两种写法：老的 if 链（action === 'x'）与新的动作表（const ACTIONS = { x: fn }）。
  // 动作表是 5.232 引入的分发方式，守卫必须认得——否则改成动作表就等于绕过了契约对账。
  const tableActions = [];
  const tableRe = /const ACTIONS = \{([\s\S]*?)\n\};/g;
  let tableHit;
  while ((tableHit = tableRe.exec(api)) !== null) {
    (tableHit[1].match(/^\s*([A-Za-z][A-Za-z0-9]*):/gm) || []).forEach(function (line) {
      tableActions.push(line.trim().replace(':', ''));
    });
  }
  const codeActions = [...new Set([]
    .concat((api.match(/action === '[^']+'/g) || []).map(function (x) { return x.replace(/action === |'/g, ''); }))
    .concat(tableActions))].sort();
  const docRoutes = contract.routes.map(function (row) { return row.path; }).sort();
  const docActions = contract.actions.map(function (row) { return row.name; }).sort();
  assert.deepEqual(codeRoutes, docRoutes, '路由不一致：代码有 ' + codeRoutes.length + ' 条，契约有 ' + docRoutes.length + ' 条'
    + '；未登记：' + codeRoutes.filter(function (x) { return docRoutes.indexOf(x) === -1; }).join('、')
    + '；契约里多出：' + docRoutes.filter(function (x) { return codeRoutes.indexOf(x) === -1; }).join('、'));
  assert.deepEqual(codeActions, docActions, 'action 不一致'
    + '；未登记：' + codeActions.filter(function (x) { return docActions.indexOf(x) === -1; }).join('、')
    + '；契约里多出：' + docActions.filter(function (x) { return codeActions.indexOf(x) === -1; }).join('、'));
  assert.ok(contract.routes.length >= 25, '路由数量看着不对：' + contract.routes.length);
  assert.ok(contract.actions.length >= 10, 'action 数量看着不对：' + contract.actions.length);
});

test('接口契约：每个路由都有用途，已知的别名包装写进了说明', function () {
  contract.routes.forEach(function (row) {
    assert.ok((row.purpose || '').length > 4, row.path + ' 缺用途说明');
  });
  contract.actions.forEach(function (row) {
    assert.ok((row.note || '').length > 4, row.name + ' 缺说明');
    assert.ok(Array.isArray(row.identifiers), row.name + ' 要有 identifiers（没有就写空数组）');
  });
  const byName = {};
  contract.actions.forEach(function (row) { byName[row.name] = row; });
  assert.ok((byName.init.note || '').indexOf('meta') > -1, 'init 的别名包装要写在说明里（project / meta）');
  assert.ok((byName.recommend.note || '').indexOf('matches') > -1, 'recommend 的别名包装要写在说明里（jobs / matches）');
  assert.ok(byName.import.identifiers.length === 0 && byName.backfill.identifiers.length === 0, '批量 action 不该列识别字段');
});

test('接口契约文档与数据同源（重跑 scripts/api-doc.mjs 一字不差）', function () {
  const docPath = join(ROOT, 'docs/API.md');
  const before = readFileSync(docPath, 'utf8');
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/api-doc.mjs')], { encoding: 'utf8' });
  assert.equal(run.status, 0, '生成脚本要能跑：' + String(run.stderr || '').slice(0, 200));
  assert.equal(readFileSync(docPath, 'utf8'), before, 'docs/API.md 与 api-contract.json 不一致，请重跑 node scripts/api-doc.mjs');
});
