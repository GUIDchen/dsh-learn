// 带超时执行器：macOS 没有 timeout 命令，而 docker/kind 卡死时会把整个脚本挂住。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = ROOT + 'scripts/with-timeout.mjs';

test('超时的子进程会被杀掉，并以 124 退出（跟 GNU timeout 一致）', function () {
  const started = Date.now();
  const result = spawnSync(process.execPath, [SCRIPT, '1', 'bash', '-c', 'sleep 30'], { encoding: 'utf8' });
  const elapsed = Date.now() - started;
  assert.equal(result.status, 124, '超时应返回 124，实际 ' + result.status);
  assert.ok(elapsed < 8000, '应在一秒左右就结束，而不是等子进程 30 秒：' + elapsed + 'ms');
  assert.match(result.stderr, /超过 1 秒未返回/);
});

test('正常结束的命令原样透传退出码与输出', function () {
  const ok = spawnSync(process.execPath, [SCRIPT, '10', 'echo', 'hello'], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /hello/);

  const failing = spawnSync(process.execPath, [SCRIPT, '10', 'bash', '-c', 'exit 3'], { encoding: 'utf8' });
  assert.equal(failing.status, 3, '子进程的退出码要透传');

  const missing = spawnSync(process.execPath, [SCRIPT, '10', 'dsh-learn-no-such-command-xyz'], { encoding: 'utf8' });
  assert.equal(missing.status, 127, '启动失败按 127 处理');
});

test('用法错误与 lab 脚本都接上了超时器', function () {
  const usage = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(usage.status, 2);

  const lab = ROOT + 'scripts/lab.sh';
  assert.ok(existsSync(lab));
  const text = readFileSync(lab, 'utf8');
  assert.match(text, /TMO="node scripts\/with-timeout\.mjs"/, 'lab.sh 应统一使用超时器');
  // 每个会卡死的调用都必须恰好被包住一次（出现 N 次 → 就有 N 次被 $TMO 包住）
  // 只数"真的会执行"的行：脚本里 echo 出来的安装建议不算调用
  const execText = text.split('\n').filter(function (line) { return line.indexOf('echo') === -1; }).join('\n');
  ['kind version', 'kind get clusters', 'docker version', 'kind create cluster', 'docker image inspect', 'docker pull'].forEach(function (cmd) {
    const escaped = cmd.replace(/ /g, '\\s+');
    const all = (execText.match(new RegExp(escaped, 'g')) || []).length;
    const wrapped = (execText.match(new RegExp('[$]TMO [0-9]+ ' + escaped, 'g')) || []).length;
    assert.ok(all > 0, cmd + ' 在 lab.sh 里应该出现');
    assert.equal(all, wrapped, cmd + ' 必须全部被超时器包住（出现 ' + all + ' 处，包住 ' + wrapped + ' 处）');
  });
});
