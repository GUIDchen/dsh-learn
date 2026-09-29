import test from 'node:test';
import assert from 'node:assert/strict';
// 网页模块化的两条硬约束（拆多了最容易出的事）：
//   1) 页面模块**不许反向 import app.mjs**——那就是循环依赖，加载顺序一变就白屏；
//   2) 每个 web/*.mjs 都必须在 Service Worker 外壳清单里，否则断网时模块拿不到。
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('网页模块：不许反向依赖 app.mjs，且每个模块都在 SW 外壳清单里', function () {
  const dir = join(ROOT, 'web');
  const modules = readdirSync(dir).filter(function (name) { return name.endsWith('.mjs'); }).sort();
  assert.ok(modules.indexOf('app.mjs') > -1, '入口 app.mjs 要在');
  assert.ok(modules.length >= 3, '至少已经有 app/format/jobs 三个模块：' + modules.join(','));
  const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
  const problems = [];
  modules.forEach(function (name) {
    if (name === 'app.mjs') return;
    const code = readFileSync(join(dir, name), 'utf8');
    if (code.indexOf("from './app.mjs'") > -1) problems.push(name + ' 反向 import 了 app.mjs（循环依赖）');
    if (sw.indexOf("'/" + name + "'") === -1) problems.push(name + ' 不在 sw.js 外壳清单里（断网会 404）');
  });
  assert.deepEqual(problems, [], problems.join(' | '));
});

test('网页模块：被拆出去的页面逻辑只能有一份（app.mjs 里不留旧实现）', function () {
  const app = readFileSync(join(ROOT, 'web/app.mjs'), 'utf8');
  const jobs = readFileSync(join(ROOT, 'web/jobs.mjs'), 'utf8');
  assert.ok(jobs.indexOf('export function initJobsPanel') > -1, 'jobs.mjs 要导出 initJobsPanel');
  assert.equal(app.indexOf('const jobsState = {'), -1, 'app.mjs 不该还留着 jobsState（已搬走）');
  assert.ok(app.indexOf('jobsPanel.loadJobs()') > -1, 'app.mjs 要用返回的引用切页');
});
