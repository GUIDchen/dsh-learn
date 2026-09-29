// 信任模型测试：签名、哈希锁定、篡改检测、加载门禁。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateKey, readKey, keyPath, signFile, verifyFile, readSignature,
  addTrust, listTrust, trustStorePath, checkFilesTrusted, hashFile
} from '../src/core/trust.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-learn-trust-'));
const opts = { home: HOME };
const PACK_DIR = mkdtempSync(join(tmpdir(), 'dsh-learn-trustpacks-'));
const PACK = join(PACK_DIR, 'demo.json');

function packJson(taskTitle) {
  return JSON.stringify({
    id: 'demo-pack',
    name: '演示',
    track: 'demo',
    version: 1,
    tasks: [{ id: 'demo.echo', track: 'demo', title: taskTitle, goal: 'g', require: [{ p: 'echo', tip: 'x' }] }]
  });
}

// 每次写包都先清掉旧签名，避免上一个用例的 .sig 影响下一个用例的判断。
function writePack(taskTitle) {
  rmSync(PACK + '.sig', { force: true });
  writeFileSync(PACK, packJson(taskTitle), 'utf8');
}

test('keygen 生成密钥且权限为 0600（POSIX）', function () {
  const first = generateKey(opts);
  assert.equal(first.created, true);
  assert.ok(readKey(opts), '密钥内容应可读');
  const again = generateKey(opts);
  assert.equal(again.created, false, '默认不覆盖已有密钥');
  assert.equal(generateKey(Object.assign({}, opts, { force: true })).created, true);
  if (process.platform !== 'win32') {
    const mode = statSync(keyPath(opts)).mode & 0o777;
    assert.equal(mode, 0o600, '密钥权限应为 0600，实际 ' + mode.toString(8));
  }
});

test('签名与验签闭环', function () {
  writePack('第一版');
  const signed = signFile(PACK, Object.assign({ signer: 'alice' }, opts));
  assert.equal(signed.ok, true);
  const sig = readSignature(PACK);
  assert.equal(sig.signer, 'alice');
  assert.equal(sig.alg, 'hmac-sha256');
  assert.equal(sig.sha256, hashFile(PACK));

  const verified = verifyFile(PACK, opts);
  assert.equal(verified.ok, true);
  assert.equal(verified.signed, true);
  assert.match(verified.reason, /alice/);
});

test('内容被改后哈希不匹配，签名被改后 HMAC 不匹配', function () {
  writePack('第一版');
  signFile(PACK, opts);
  // 攻击者只改内容、保留原签名：这正是签名要拦住的场景
  writeFileSync(PACK, packJson('被篡改的第二版'), 'utf8');
  const tampered = verifyFile(PACK, opts);
  assert.equal(tampered.ok, false);
  assert.match(tampered.reason, /内容已被修改/);

  // 攻击者改动签名字段（内容没变）：哈希对得上，HMAC 必须失败
  writePack('第一版');
  signFile(PACK, opts);
  const sig = JSON.parse(readFileSync(PACK + '.sig', 'utf8'));
  sig.file = 'evil.json';
  writeFileSync(PACK + '.sig', JSON.stringify(sig), 'utf8');
  const faked = verifyFile(PACK, opts);
  assert.equal(faked.ok, false);
  assert.match(faked.reason, /签名不匹配|内容已被修改/);
});

test('没有密钥时无法验签，但哈希仍可比对', function () {
  writePack('第一版');
  signFile(PACK, opts);
  const noKey = verifyFile(PACK, { home: mkdtempSync(join(tmpdir(), 'dsh-learn-nokey-')) });
  assert.equal(noKey.ok, false);
  assert.match(noKey.reason, /缺少密钥/);
  assert.equal(noKey.sha256, hashFile(PACK));
});

test('未签名包只能做哈希锁定，明确标注 trusted 与 verified', function () {
  writePack('第一版');
  const unsigned = verifyFile(PACK, opts);
  assert.equal(unsigned.ok, false);
  assert.equal(unsigned.signed, false);
  assert.match(unsigned.reason, /没有签名文件/);

  const added = addTrust(PACK, opts);
  assert.equal(added.entry.verified, false);
  assert.equal(added.entry.sha256, hashFile(PACK));
  assert.ok(listTrust(opts).length === 1);
  assert.ok(readFileSync(trustStorePath(opts), 'utf8').indexOf('demo.json') > -1);

  const gate = checkFilesTrusted([PACK], opts);
  assert.equal(gate.ok, true);
  assert.match(gate.files[0].reason, /TOFU/);
});

test('受信任后内容再变会被门禁拦下', function () {
  writePack('第一版');
  addTrust(PACK, opts);
  assert.equal(checkFilesTrusted([PACK], opts).ok, true);
  writePack('偷偷改过的版本');
  const gate = checkFilesTrusted([PACK], opts);
  assert.equal(gate.ok, false);
  assert.match(gate.untrusted[0].reason, /哈希不一致/);
});

test('要求签名时，只有哈希锁定的包不算通过', function () {
  writePack('第一版');
  addTrust(PACK, opts);
  const strict = checkFilesTrusted([PACK], Object.assign({ requireSignature: true }, opts));
  assert.equal(strict.ok, false);
  assert.match(strict.untrusted[0].reason, /要求签名/);

  signFile(PACK, opts);
  addTrust(PACK, opts);
  const signedGate = checkFilesTrusted([PACK], Object.assign({ requireSignature: true }, opts));
  assert.equal(signedGate.ok, true);
  assert.match(signedGate.files[0].reason, /签名已校验/);
});

test('未信任的包被点名', function () {
  const other = join(PACK_DIR, 'other.json');
  writeFileSync(other, JSON.stringify({ id: 'other', track: 'demo', tasks: [] }), 'utf8');
  const gate = checkFilesTrusted([other], opts);
  assert.equal(gate.ok, false);
  assert.match(gate.untrusted[0].reason, /未被信任/);
});

test.after(function () {
  rmSync(HOME, { recursive: true, force: true });
  rmSync(PACK_DIR, { recursive: true, force: true });
});
