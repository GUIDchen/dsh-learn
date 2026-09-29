import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentServer } from '../src/agent.mjs';
import { verifyWith, listRunners, getRunner, RUNNER_NAMES } from '../src/core/runners.mjs';
import { resolveTask } from '../src/core/judge.mjs';
import { findTask } from '../src/core/tasks.mjs';

function probeTask() {
  return resolveTask(findTask('linux.platform-probe'), 'darwin');
}

test('三个执行后端都注册在册', function () {
  assert.deepEqual(RUNNER_NAMES, ['local', 'docker', 'remote']);
  RUNNER_NAMES.forEach(function (name) {
    assert.ok(getRunner(name), name + ' 未注册');
    assert.equal(typeof getRunner(name).execute, 'function');
  });
  assert.equal(getRunner('nope'), null);
  assert.ok(listRunners({ endpoint: 'http://127.0.0.1:1' }).length === 3);
});

test('local 后端默认 dry-run，不执行任何命令', async function () {
  const result = await verifyWith(probeTask(), { runner: 'local', run: false });
  assert.equal(result.runner, 'local');
  assert.equal(result.ran, false);
  assert.equal(result.dryRun, true);
});

test('local 后端真实执行时同时校验退出码与输出', async function () {
  // 用 node -v 而不是 uname -s：它在 macOS / Linux / Windows 上都存在，让这条断言在所有平台成立。
  const result = await verifyWith({ verify: { cmd: 'node -v', expect: '^v\\d+\\.' } }, { runner: 'local', run: true });
  assert.equal(result.ran, true);
  assert.equal(result.matched, true);
  assert.equal(result.ok, true);
  assert.match(result.output, /^v\d+/);

  const mismatch = await verifyWith(
    { verify: { cmd: 'node -v', expect: '^Windows$' } },
    { runner: 'local', run: true }
  );
  assert.equal(mismatch.ran, true);
  assert.equal(mismatch.matched, false);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /未匹配/);
});

test('POSIX 专属命令在非 POSIX 平台优雅失败而不是抛错', async function () {
  const result = await verifyWith({ verify: { cmd: 'uname -s', expect: 'Darwin|Linux' } }, { runner: 'local', run: true });
  assert.equal(result.ran, true);
  if (process.platform === 'win32') {
    assert.equal(result.ok, false);
    assert.equal(typeof result.output, 'string');
  } else {
    assert.equal(result.ok, true);
  }
});

test('docker 后端拒绝白名单外命令，且不调用 docker', async function () {
  const result = await verifyWith({ verify: { cmd: 'rm -rf /', expect: '.*' } }, { runner: 'docker', run: true });
  assert.equal(result.runner, 'docker');
  assert.equal(result.ran, false);
  assert.match(result.reason, /白名单/);
});

test('docker 后端在守护进程不可用时明确降级而不是抛错', async function () {
  // 故意用一个非法镜像名：拉取会立刻失败，不必等满网络超时，同时仍走真实的后端代码路径
  const result = await verifyWith(probeTask(), { runner: 'docker', run: true, image: 'not a valid image name' });
  assert.equal(result.runner, 'docker');
  if (!result.ran) {
    assert.match(result.reason, /守护进程|白名单|镜像/);
    assert.equal(result.ok, false);
  } else {
    assert.equal(typeof result.output, 'string');
  }
});

test('未知后端返回可读错误', async function () {
  const result = await verifyWith(probeTask(), { runner: 'k8s', run: true });
  assert.equal(result.ok, false);
  assert.match(result.reason, /未知执行后端/);
});

test('没有验证项的题目给出说明而不是失败堆栈', async function () {
  const result = await verifyWith({ verify: null }, { runner: 'local', run: true });
  assert.equal(result.ran, false);
  assert.match(result.reason, /没有可执行的验证项/);
});

test('remote 后端经 agent 执行，token 错误被拒绝', async function () {
  const agent = createAgentServer({ token: 'secret-token' });
  await new Promise(function (resolve) { agent.listen(0, '127.0.0.1', resolve); });
  const port = agent.address().port;
  const endpoint = 'http://127.0.0.1:' + port;

  const health = await (await fetch(endpoint + '/agent/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.requiresToken, true);

  const portable = { verify: { cmd: 'node -v', expect: 'v\\d+' } };
  const ok = await verifyWith(portable, { runner: 'remote', endpoint: endpoint, token: 'secret-token', run: true });
  assert.equal(ok.ran, true);
  assert.equal(ok.ok, true);
  assert.match(ok.output, /^v\d+/);

  const bad = await verifyWith(portable, { runner: 'remote', endpoint: endpoint, token: 'wrong', run: true });
  assert.equal(bad.ran, false);
  assert.equal(bad.status, 401);
  assert.match(bad.reason, /token/);

  const blocked = await fetch(endpoint + '/agent/exec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'rm -rf /', run: true, token: 'secret-token' })
  });
  assert.equal(blocked.status, 403);

  const dry = await fetch(endpoint + '/agent/exec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'uname -s', run: false, token: 'secret-token' })
  });
  const dryBody = await dry.json();
  assert.equal(dryBody.ran, false);
  assert.equal(dryBody.dryRun, true);

  await new Promise(function (resolve) { agent.close(resolve); });
});
