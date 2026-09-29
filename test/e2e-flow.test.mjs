// 端到端闭环回归：把整条链路（收岗位 → 分析 → 建项目 → 练习清单 → 练 → 简历 → 投递 → 跟进 → 检索/调研/体检）
// 在临时环境里跑一遍，任何一步没产出就失败。单点用例再多，也证明不了"这一串还接得上"。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('端到端闭环：17 步全部有产出（临时环境，不碰真实数据）', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-e2e-test-'));
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/e2e-flow.mjs')], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { DSH_LEARN_HOME: home })
  });
  const output = String(run.stdout || '') + String(run.stderr || '');
  assert.equal(run.status, 0, '端到端应当通过，实际输出：' + output.slice(-600));
  assert.ok(output.indexOf('端到端闭环通过') > -1, '要有通过标志：' + output.slice(-400));
  const fails = output.split(String.fromCharCode(10)).filter(function (row) { return row.indexOf('FAIL') === 0; });
  assert.deepEqual(fails, [], '不该有失败步骤：' + fails.join(' | '));
  rmSync(home, { recursive: true, force: true });
});
