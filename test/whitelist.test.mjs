// 白名单安全测试：它是唯一的安全边界，所以要有人守着"越权"和"腐烂"两件事。
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWLIST, MUST_STAY_BLOCKED, whitelistEntries, matchWhitelistEntry, auditWhitelist, isAllowed } from '../src/core/exec.mjs';
import { TASKS } from '../src/core/tasks.mjs';

test('每条白名单都必须锚定首尾，避免写成过宽的前缀匹配', function () {
  whitelistEntries().forEach(function (entry) {
    // pattern 是 String(regex)，形如 /^docker\s+ps$/，先剥掉斜杠与 flags 再检查锚定
    const body = entry.pattern.replace(/^\//, '').replace(/\/[a-z]*$/, '');
    assert.ok(body.indexOf('^') === 0, entry.id + ' 的模式应以 ^ 开头：' + entry.pattern);
    assert.ok(body.lastIndexOf('$') === body.length - 1, entry.id + ' 的模式应以 $ 结尾：' + entry.pattern);
    assert.ok(entry.examples.length > 0, entry.id + ' 应给出示例');
    assert.ok(entry.family, entry.id + ' 应归属某个 family');
  });
});

test('危险命令必须继续被拒绝（含元字符与写操作）', function () {
  MUST_STAY_BLOCKED.forEach(function (cmd) {
    assert.equal(isAllowed(cmd), false, cmd + ' 不该被放行');
  });
  ['docker ps; rm -rf /', 'docker ps | tee /tmp/x', 'docker ps > /tmp/x', 'uname -s && whoami', 'echo hi'].forEach(function (cmd) {
    assert.equal(isAllowed(cmd), false, cmd + ' 含元字符或不在白名单，必须拒绝');
  });
});

test('受限压测的边界：只允许打本机回环，且请求数/并发数有上限', function () {
  assert.equal(isAllowed('ab -n 50 -c 5 http://127.0.0.1:8899/health'), true, '受限压测应被放行');
  assert.equal(isAllowed('ab -n 200 -c 20 http://127.0.0.1:8899/health'), true, '刚好到上限也应放行');

  // 超上限、打外网、打别的路径、带参数变体，一律拒绝
  [
    'ab -n 100000 -c 5 http://127.0.0.1:8899/health',
    'ab -n 50 -c 200 http://127.0.0.1:8899/health',
    'ab -n 500 -c 5 http://127.0.0.1:8899/health',
    'ab -n 50 -c 5 http://example.com/health',
    'ab -n 50 -c 5 http://127.0.0.1:8899/',
    'ab -n 50 -c 5 http://127.0.0.1:8899/health -k',
    'ab -n 50 -c 5 http://10.0.0.5:8899/health'
  ].forEach(function (cmd) {
    assert.equal(isAllowed(cmd), false, cmd + ' 超出受限压测的边界，必须拒绝');
  });
});

test('白名单与题库对账通过：无阻塞、无闲置条目、无泄漏', function () {
  const audit = auditWhitelist(TASKS);
  assert.deepEqual(audit.blocked, [], '题库声明的验证命令必须都能跑');
  assert.deepEqual(audit.leaked, [], '本该被拒绝的命令不允许被放行');
  assert.deepEqual(audit.unused, [], '白名单里不该有人没用的条目（要加就同时加用它的题）');
  assert.equal(audit.ok, true);
  assert.ok(audit.entries.length >= 14, '白名单条目数应与题库规模匹配');
  assert.ok(audit.entries.every(function (entry) { return entry.used; }), '每条都应被题库或工具内部使用');
});

test('对账能发现"题库声明了但白名单没有"的命令', function () {
  const fake = [{ id: 'demo.bad', verify: { cmd: 'docker system prune -a', expect: 'x' } }];
  const audit = auditWhitelist(fake);
  assert.equal(audit.ok, false);
  assert.equal(audit.blocked.length, 1);
  assert.match(audit.blocked[0].reason, /不在白名单内/);
  assert.deepEqual(audit.tasksWithoutVerify, []);
});

test('没有验证项的题会被单独列出来（不是错误）', function () {
  const audit = auditWhitelist([{ id: 'demo.noverify', require: [] }]);
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.tasksWithoutVerify, ['demo.noverify']);
});

test('matchWhitelistEntry 只返回命中的那一条', function () {
  assert.equal(matchWhitelistEntry('uname -s').id, 'uname');
  assert.equal(matchWhitelistEntry('docker ps -a').id, 'docker-ps');
  assert.equal(matchWhitelistEntry('docker ps -a --format json'), null, '超出手写范围就应落到白名单外');
  assert.equal(matchWhitelistEntry(''), null);
  assert.equal(matchWhitelistEntry(null), null);
  assert.equal(ALLOWLIST.length, whitelistEntries().length);
});
