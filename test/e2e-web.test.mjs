// 浏览器层端到端：真开 headless Chrome 走三个页面（脚本自带进程清理）。
//
// 为什么要有这条：前 8 轮每轮都手写 /tmp/cdp-*.mjs 冒烟，既没进仓库、又不清理——实测攒下 52 个
// Chrome 进程，把「真实执行」类用例拖成假失败。这条把冒烟固化成脚本 + 用例，并强制收尾。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('浏览器层端到端：三页真实走通，且不留进程', function (t) {
  if (!existsSync(CHROME)) { t.skip('这台机器没有 Google Chrome'); return; }
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/e2e-web.mjs')], { encoding: 'utf8', timeout: 180000 });
  const output = String(run.stdout || '') + String(run.stderr || '');
  assert.equal(run.status, 0, '浏览器层闭环应当通过：' + output.slice(-700));
  assert.ok(output.indexOf('浏览器层端到端通过') > -1, '要有通过标志：' + output.slice(-500));
  const fails = output.split(String.fromCharCode(10)).filter(function (row) { return row.indexOf('FAIL') === 0; });
  assert.deepEqual(fails, [], '不该有失败步骤：' + fails.join(' | '));
  assert.ok(output.indexOf('自动清理') > -1, '要说明收尾清理过');
});
