// 接口层闭环：同样的求职闭环经 HTTP 跑一遍（网页版与原生端用的就是这层）。
// 与 test/e2e-flow.test.mjs 的分工：那条证 core 逻辑通，这条证"客户端真能走通"。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('接口层闭环：18 步经 HTTP 全部走通（临时环境 + 随机端口）', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-e2e-api-test-'));
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/e2e-api.mjs')], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { DSH_LEARN_HOME: home }),
    timeout: 60000
  });
  const output = String(run.stdout || '') + String(run.stderr || '');
  assert.equal(run.status, 0, '接口层闭环应当通过：' + output.slice(-700));
  assert.ok(output.indexOf('接口层闭环通过') > -1, '要有通过标志：' + output.slice(-500));
  const fails = output.split(String.fromCharCode(10)).filter(function (row) { return row.indexOf('FAIL') === 0; });
  assert.deepEqual(fails, [], '不该有失败步骤：' + fails.join(' | '));
  rmSync(home, { recursive: true, force: true });
});
