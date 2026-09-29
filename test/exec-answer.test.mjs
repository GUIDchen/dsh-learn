// 执行型判定：只跑只读白名单内的命令，跑不了就如实说，绝不假装跑过。
import test from 'node:test';
import assert from 'node:assert/strict';

const { assessAnswer, isAllowed, whitelistEntries } = await import('../src/core/exec.mjs');
const { TASKS } = await import('../src/core/tasks.mjs');

test('白名单内的答案：真的跑一遍并带回输出', async function () {
  const task = TASKS.filter(function (row) { return row.id === 'git.version-check'; })[0];
  assert.ok(task, '要有这道题');
  const result = await assessAnswer(task, 'git --version', { run: true });
  assert.equal(result.allowed, true, JSON.stringify(result));
  assert.equal(result.ran, true, JSON.stringify(result));
  assert.equal(result.exitCode, 0, 'git --version 应当正常退出：' + JSON.stringify(result));
  assert.ok(String(result.output || '').indexOf('git version') > -1, '要带回真实输出：' + result.output);
});

test('白名单外：拒绝执行并说明原因（不假装跑过）', async function () {
  const danger = await assessAnswer({}, 'rm -rf /tmp/whatever', { run: true });
  assert.equal(danger.allowed, false, JSON.stringify(danger));
  assert.equal(danger.ran, false);
  assert.ok(danger.reason.indexOf('白名单') > -1, danger.reason);
  // 管道 / 重定向 / 命令替换同样拒绝
  for (const cmd of ['git --version | cat', 'git --version > /tmp/x', 'echo `whoami`']) {
    const blocked = await assessAnswer({}, cmd, { run: true });
    assert.equal(blocked.allowed, false, cmd + ' 不该被允许');
  }
  const empty = await assessAnswer({}, '   ', { run: true });
  assert.equal(empty.allowed, false);
  assert.ok(empty.reason.indexOf('没有答案') > -1, empty.reason);
});

test('不带 run 时是 dry-run：只说不执行', async function () {
  const result = await assessAnswer({}, 'git --version', { run: false });
  assert.equal(result.allowed, true, '白名单内仍然算 allowed');
  assert.equal(result.ran, false, '但不会真的跑');
  assert.equal(result.dryRun, true, JSON.stringify(result));
  assert.ok(String(result.reason || '').indexOf('--run') > -1, '要说清怎么才执行：' + result.reason);
});

test('白名单与题库对得上：题目自带的参考答案里有可执行的那部分', function () {
  const allowedSamples = TASKS.filter(function (row) { return isAllowed(row.sample || ''); });
  assert.ok(allowedSamples.length >= 2, '至少有两道题的参考答案在只读白名单内：' + allowedSamples.length);
  assert.ok(whitelistEntries().length >= 20, '白名单条目数量看着不对');
});
