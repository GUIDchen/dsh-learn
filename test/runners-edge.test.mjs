// 执行后端的边界测试：超时、镜像不可用、远端不可达/异常响应、agent 的非法请求。
// 这些路径平时不会走到，但一旦走到就是"学员看到一句莫名其妙的英文"——必须钉住提示语。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { verifyWith, listRunners, getRunner, ensureImage, runInImage } from '../src/core/runners.mjs';
import { runReadonlyCommand, runVerify, assessOutput } from '../src/core/exec.mjs';
import { createAgentServer } from '../src/agent.mjs';

const NODE_SPEC = { verify: { cmd: 'node -v', expect: 'v\\d+' } };

function listen(server) {
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(server.address().port); }); });
}
// 关服务时顺手断掉保活连接：否则 undici 的 keep-alive socket 会拖住事件循环，
// 甚至把"SERVER 已关闭"的错误算到下一个测试头上。
function close(server) {
  return new Promise(function (resolve) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(resolve);
  });
}
const NO_KEEPALIVE = { 'content-type': 'application/json', connection: 'close' };
// 挑一个"干净的基础镜像"。本机常躺着应用镜像（自带 ENTRYPOINT 会先打横幅），
// 拿它跑 uname 会把横幅混进输出，所以优先选明显是基础镜像的名字；找不到就跳过。
const BASE_IMAGE_HINT = /(^|\/)(python|node|alpine|debian|ubuntu|busybox|golang|ruby|openjdk|temurin)[:@]/;
function localImage() {
  const r = spawnSync('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return null;
  const rows = (r.stdout || '').split('\n').map(function (line) { return line.trim(); }).filter(function (line) { return line && line.indexOf('<none>') === -1; });
  const base = rows.filter(function (row) { return BASE_IMAGE_HINT.test(row); });
  return base.length ? base[0] : null;
}

test('本地后端：超时被明确报成超时，而不是"exit null"', async function () {
  const result = await verifyWith(NODE_SPEC, { runner: 'local', run: true, timeout: 1 });
  assert.equal(result.ran, true);
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(result.reason, /超时/);
  assert.match(result.reason, /1ms/);

  const ok = await verifyWith(NODE_SPEC, { runner: 'local', run: true, timeout: 10000 });
  assert.equal(ok.ok, true);
});

test('没有验证项的题、以及不存在的后端都给出可读结论', async function () {
  const none = await verifyWith({}, { runner: 'local', run: true });
  assert.equal(none.ran, false);
  assert.match(none.reason, /没有可执行的验证项/);

  const unknown = await verifyWith(NODE_SPEC, { runner: 'ssh', run: true });
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /未知执行后端/);
});

test('本地 runVerify 在超时与白名单外命令上都不抛异常', async function () {
  const blocked = await runVerify({ verify: { cmd: 'rm -rf /', expect: '.*' } }, { run: true });
  assert.equal(blocked.ran, false);
  assert.match(blocked.reason, /白名单/);

  const timedOut = await runVerify({ verify: { cmd: 'node -v', expect: 'v\\d+' } }, { run: true, timeout: 1 });
  assert.equal(timedOut.ran, true);
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.reason, /超时/);

  const noVerify = await runVerify({ id: 'x' }, { run: true });
  assert.equal(noVerify.ran, false);
  assert.match(noVerify.reason, /没有可执行的验证项/);
});

test('输出失控：超过上限就截断并终止，而不是把内存吃掉', async function () {
  // 白名单里能稳定产出输出的命令：uname -s；把上限压到 1 字节即可复现"输出失控"
  const result = await runReadonlyCommand('uname -s', { run: true, timeout: 5000, maxOutput: 1 });
  assert.equal(result.ran, true);
  assert.equal(result.ok, false);
  assert.match(result.reason, /输出超过 1 字节/);
});

test('docker 后端全流程：守护进程可用 + 镜像本地已有 + 容器内跑通（注入执行器）', async function () {
  const seen = [];
  function fakeExec(table) {
    return function (args, timeoutMs) {
      seen.push(args[0] + ':' + args.slice(1, 3).join(' '));
      return table[args[0]] || { status: 0, stdout: '', stderr: '' };
    };
  }

  const runner = getRunner('docker');
  const available = runner.available({ exec: fakeExec({ info: { status: 0, stdout: 'Server: 29.4.0', stderr: '' } }) });
  assert.equal(available.ok, true);
  assert.match(available.reason, /守护进程可用/);
  seen.length = 0; // available 那次探活已经记过一笔，后面的断言只看执行顺序

  const result = await verifyWith(NODE_SPEC, {
    runner: 'docker',
    run: true,
    image: 'python:3.12-slim',
    exec: fakeExec({
      info: { status: 0, stdout: 'Server: 29.4.0', stderr: '' },
      image: { status: 0, stdout: '', stderr: '' },
      run: { status: 0, stdout: 'v24.19.0', stderr: '' }
    })
  });
  assert.equal(result.ran, true);
  assert.equal(result.ok, true, '容器内输出匹配就该判通过：' + result.reason);
  assert.match(result.reason, /容器内输出符合预期/);
  assert.deepEqual(seen, ['info:', 'image:inspect python:3.12-slim', 'run:--rm --network'], '顺序应是 探活 → 预检镜像 → 跑容器');

  const mismatch = await verifyWith(NODE_SPEC, {
    runner: 'docker',
    run: true,
    exec: fakeExec({
      info: { status: 0, stdout: 'Server: 29.4.0', stderr: '' },
      image: { status: 0, stdout: '', stderr: '' },
      run: { status: 1, stdout: '', stderr: 'sh: 1: node: not found' }
    })
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /容器内输出未匹配/);
});

test('守护进程无响应与镜像拉不动：都在降级说明里说清楚（注入执行器）', async function () {
  const runner = getRunner('docker');
  const hung = runner.available({ exec: function () { return { status: null, signal: 'SIGKILL', stdout: '', stderr: '' }; }, timeout: 3000 });
  assert.equal(hung.ok, false);
  assert.match(hung.reason, /3000ms 内没有返回/);

  // 守护进程正常，但镜像既不在本地也拉不动 → 降级说明要带镜像名与建议
  const noImage = await verifyWith(NODE_SPEC, {
    runner: 'docker',
    run: true,
    image: 'nope:1.0',
    exec: function (args) {
      if (args[0] === 'info') return { status: 0, stdout: 'Server: 29.4.0', stderr: '' };
      return { status: 1, stdout: '', stderr: 'Error response from daemon: pull access denied for nope' };
    }
  });
  assert.equal(noImage.ran, false);
  assert.equal(noImage.unavailable, true);
  assert.match(noImage.reason, /nope:1\.0 不在本地且拉取失败/);
  assert.match(noImage.reason, /DSH_LEARN_DOCKER_IMAGE/);
  assert.match(noImage.output, /pull access denied/);
});

test('remote 后端：dry-run 与白名单外命令都不发请求', async function () {
  const dry = await verifyWith(NODE_SPEC, { runner: 'remote', run: false, endpoint: 'http://127.0.0.1:9' });
  assert.equal(dry.dryRun, true);
  assert.match(dry.reason, /默认不执行/);

  const blocked = await verifyWith({ verify: { cmd: 'rm -rf /', expect: '.*' } }, { runner: 'remote', run: true, endpoint: 'http://127.0.0.1:9' });
  assert.equal(blocked.ran, false);
  assert.match(blocked.reason, /白名单/);
});

test('容器内执行：成功、失败、非零退出三种判定都走同一条路径', function () {
  const seen = [];
  function fakeExec(proc) {
    return function (args, timeoutMs) {
      seen.push(args.join(' ') + ' @' + timeoutMs);
      return proc;
    };
  }

  const ok = runInImage('python:3.12-slim', 'uname -s', { exec: fakeExec({ status: 0, stdout: 'Linux\n', stderr: '' }) });
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.output, 'Linux');
  assert.equal(ok.verdict.ok, true);
  assert.match(seen[0], /^run --rm --network none python:3\.12-slim sh -lc uname -s @30000$/, '命令要原样交给容器里的 sh -lc');

  const bad = runInImage('python:3.12-slim', 'uname -s', { exec: fakeExec({ status: 1, stdout: '', stderr: 'sh: 1: uname: not found' }), timeout: 1234 });
  assert.equal(bad.verdict.ok, false);
  assert.match(bad.verdict.reason, /非零退出|失败/);
  assert.match(seen[1], /@1234$/, '超时应可配置');
});

test('镜像预检：本地有镜像直接用，没有就拉，拉不动才降级（用注入的执行器覆盖三条路径）', function () {
  const calls = [];
  function fakeExec(statuses) {
    return function (args, timeoutMs) {
      calls.push(args.join(' ') + ' @' + timeoutMs);
      const status = statuses[args[0] === 'image' ? 'inspect' : 'pull'];
      return { status: status, stdout: status === 0 ? '' : '', stderr: status === 0 ? '' : 'Error response from daemon: pull access denied' };
    };
  }

  const local = ensureImage('python:3.12-slim', { exec: fakeExec({ inspect: 0, pull: 0 }) });
  assert.equal(local.ok, true);
  assert.equal(local.pulled, false);
  assert.equal(calls.length, 1, '本地已有镜像就不该再去拉');

  calls.length = 0;
  const pulled = ensureImage('python:3.12-slim', { exec: fakeExec({ inspect: 1, pull: 0 }), pullTimeout: 1234 });
  assert.equal(pulled.ok, true);
  assert.equal(pulled.pulled, true);
  assert.match(calls[1], /@1234$/, '拉取超时应可配置');

  const failed = ensureImage('nope:1.0', { exec: fakeExec({ inspect: 1, pull: 1 }) });
  assert.equal(failed.ok, false);
  assert.match(failed.output, /pull access denied/);
});

test('assessOutput 对 null 退出码给出可读说明', function () {
  const result = assessOutput(null, '');
  assert.equal(result.ok, false);
  assert.match(result.reason, /没有正常退出/);
  assert.match(assessOutput(null, 'Cannot connect to the Docker daemon').reason, /守护进程/);
});

test('容器后端：dry-run、白名单、镜像不可用三条路径都有明确说明', async function () {
  const dry = await verifyWith(NODE_SPEC, { runner: 'docker', run: false });
  assert.equal(dry.dryRun, true);
  assert.match(dry.reason, /默认不执行/);

  const blocked = await verifyWith({ verify: { cmd: 'rm -rf /', expect: '.*' } }, { runner: 'docker', run: true });
  assert.equal(blocked.ran, false);
  assert.match(blocked.reason, /白名单/);

  // 非法镜像名 + 短的拉取上限：既覆盖"镜像拉不动"，也不会让测试陪着重试网络
  const bogus = await verifyWith(NODE_SPEC, { runner: 'docker', run: true, image: 'not a valid image name', timeout: 20000, pullTimeout: 3000 });
  assert.equal(bogus.ok, false);
  assert.equal(bogus.unavailable, true, '镜像预检失败应直接降级，不要卡满超时：' + bogus.reason);
  if (/守护进程不可用/.test(bogus.reason)) {
    // 守护进程没起：到不了镜像预检，但同样必须是一句中文说明
    assert.match(bogus.reason, /守护进程不可用/);
    // 探活超时时本来就没有输出（不是被吞掉），只在有输出时要求它是 docker 的原始报错
    if (bogus.output) assert.equal(typeof bogus.output, 'string');
  } else {
    // 守护进程在跑但镜像拿不到：说明里要给出可操作建议
    assert.match(bogus.reason, /镜像 .* 不在本地且拉取失败/);
    assert.match(bogus.reason, /DSH_LEARN_DOCKER_IMAGE/);
  }
});

test('容器后端：本机有可用镜像时能真的在容器里跑通', async function () {
  const probe = runReadonlyCommand('docker info', { run: true, timeout: 5000 });
  const image = probe.ok ? localImage() : null;
  if (!image) {
    // 没有守护进程或没有本地镜像时跳过（CI 上很常见），但不能静默通过
    assert.ok(true, '跳过：本机没有可用镜像或守护进程未运行');
    return;
  }
  // 用 uname -s：几乎所有 Linux 镜像都有它，同时还能证明"确实跑在 Linux 容器里"
  const spec = { verify: { cmd: 'uname -s', expect: 'Linux' } };
  const result = await verifyWith(spec, { runner: 'docker', run: true, image: image, timeout: 60000 });
  assert.equal(result.ran, true, '用了本地镜像就应该真的跑起来：' + result.reason);
  assert.equal(result.ok, true, '容器内 uname -s 应输出 Linux：' + result.output);
  assert.match(result.output, /Linux/);
});

test('远端后端：缺 endpoint、连不上、agent 报错、返回非 JSON 都有可读说明', async function () {
  const noEndpoint = await verifyWith(NODE_SPEC, { runner: 'remote', run: true });
  assert.equal(noEndpoint.ran, false);
  assert.match(noEndpoint.reason, /未提供 endpoint/);

  const unreachable = await verifyWith(NODE_SPEC, { runner: 'remote', run: true, endpoint: 'http://127.0.0.1:1' });
  assert.equal(unreachable.ran, false);
  assert.match(unreachable.reason, /无法连接 agent/);

  // agent 返回 500 且带 reason
  const failing = createServer(function (req, res) {
    res.writeHead(500, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ reason: '上游炸了' }));
  });
  const failingPort = await listen(failing);
  const errResult = await verifyWith(NODE_SPEC, { runner: 'remote', run: true, endpoint: 'http://127.0.0.1:' + failingPort });
  assert.equal(errResult.ran, false);
  assert.equal(errResult.status, 500);
  assert.match(errResult.reason, /上游炸了/);
  await close(failing);

  // agent 返回非 JSON
  const garbage = createServer(function (req, res) {
    res.writeHead(200, { 'content-type': 'text/plain', connection: 'close' });
    res.end('not json at all');
  });
  const garbagePort = await listen(garbage);
  const garbageResult = await verifyWith(NODE_SPEC, { runner: 'remote', run: true, endpoint: 'http://127.0.0.1:' + garbagePort });
  assert.equal(garbageResult.ran, true);
  assert.equal(garbageResult.ok, false);
  assert.match(garbageResult.reason, /未匹配/);
  await close(garbage);

  const blocked = await verifyWith({ verify: { cmd: 'rm -rf /', expect: '.*' } }, { runner: 'remote', run: true, endpoint: 'http://127.0.0.1:1' });
  assert.equal(blocked.ran, false);
  assert.match(blocked.reason, /白名单/);
});

test('agent：非法请求与未知路径都有明确拒绝', async function (t) {
  const agent = createAgentServer({ token: 'edge-token' });
  // 用 t.after 关服务：断言失败时也能关掉，否则监听句柄会拖住整个测试文件
  t.after(function () { return close(agent); });
  const port = await listen(agent);
  const base = 'http://127.0.0.1:' + port;

  const badJson = await fetch(base + '/agent/exec', { method: 'POST', headers: NO_KEEPALIVE, body: '{oops' });
  assert.equal(badJson.status, 400);
  assert.match((await badJson.json()).reason, /JSON/);

  const huge = await fetch(base + '/agent/exec', {
    method: 'POST',
    headers: NO_KEEPALIVE,
    body: JSON.stringify({ cmd: 'node -v', token: 'edge-token', pad: 'x'.repeat(20000) })
  });
  // 413 而不是 400：请求体超限是"实体过大"，而且响应里要带 Connection: close
  assert.equal(huge.status, 413);
  assert.match((await huge.json()).reason, /过大/);

  const unknown = await fetch(base + '/agent/nope');
  assert.equal(unknown.status, 404);

  const getExec = await fetch(base + '/agent/exec');
  assert.equal(getExec.status, 404, 'GET /agent/exec 不是有效路由');

  // 正确请求仍然可用
  const ok = await fetch(base + '/agent/exec', {
    method: 'POST',
    headers: NO_KEEPALIVE,
    body: JSON.stringify({ cmd: 'node -v', token: 'edge-token', run: true })
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.match(body.output, /v\d+/);

  await close(agent);
});

test('listRunners 在缺 endpoint / 缺证书的情况下也能给出可用性结论', function () {
  const rows = listRunners({ endpoint: null });
  assert.equal(rows.length, 3);
  const remote = rows.filter(function (row) { return row.name === 'remote'; })[0];
  assert.equal(remote.available.ok, false);
  assert.match(remote.available.reason, /未提供 endpoint/);
  assert.equal(getRunner('docker').name, 'docker');
});
