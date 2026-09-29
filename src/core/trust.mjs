// 外部题库包的信任模型（无第三方依赖，纯 node:crypto）。
// 两个层次，分开说清楚，不假装它们等价：
//   1. 签名：用本地密钥做 HMAC-SHA256，能证明"这个包是从持有密钥的人那里来的，且此后没被改过"。
//   2. 哈希锁定（TOFU）：没有签名时只能记住首次看到的哈希，之后变了就报警 —— 防篡改，但不防冒充。
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export function homeDir(options) {
  const opts = options || {};
  return opts.home || process.env.DSH_LEARN_HOME || join(homedir(), '.dsh-learn');
}

export function keyPath(options) {
  return join(homeDir(options), 'keys', 'pack.key');
}

export function trustStorePath(options) {
  return join(homeDir(options), 'trusted-packs.json');
}

export function signaturePath(file) {
  return file + '.sig';
}

export function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function generateKey(options) {
  const opts = options || {};
  const file = keyPath(opts);
  if (existsSync(file) && !opts.force) {
    return { path: file, created: false, reason: '密钥已存在，如需轮换请加 --force' };
  }
  mkdirSync(join(homeDir(opts), 'keys'), { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret + '\n', { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch (err) {
    // Windows 上 chmod 语义不同，忽略即可
  }
  return { path: file, created: true, reason: '已生成新的签名密钥（权限 0600）' };
}

export function readKey(options) {
  const file = keyPath(options);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8').trim();
}

function hmacOf(key, payload) {
  return createHmac('sha256', key).update(payload).digest('hex');
}

function payloadOf(entry) {
  return [entry.sha256, entry.file, entry.signer, entry.signedAt].join('|');
}

export function signFile(file, options) {
  const opts = options || {};
  const key = opts.key || readKey(opts);
  if (!key) {
    return { ok: false, reason: '没有可用密钥，先运行：node src/cli.mjs pack keygen' };
  }
  const target = resolve(file);
  const entry = {
    version: 1,
    alg: 'hmac-sha256',
    file: basename(target),
    sha256: hashFile(target),
    signer: opts.signer || 'local',
    signedAt: new Date().toISOString()
  };
  entry.hmac = hmacOf(key, payloadOf(entry));
  writeFileSync(signaturePath(target), JSON.stringify(entry, null, 2) + '\n');
  return { ok: true, signature: entry, path: signaturePath(target) };
}

export function readSignature(file) {
  const path = signaturePath(file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { broken: true, reason: '签名文件不是合法 JSON' };
  }
}

// 校验顺序：先比对哈希（内容有没有被改），再比对 HMAC（签名是不是伪造的）。
export function verifyFile(file, options) {
  const opts = options || {};
  const target = resolve(file);
  if (!existsSync(target)) return { ok: false, reason: '文件不存在：' + target };
  const sha256 = hashFile(target);
  const signature = (opts.signature !== undefined ? opts.signature : readSignature(target));
  if (!signature) {
    return { ok: false, signed: false, sha256: sha256, reason: '没有签名文件（' + basename(signaturePath(target)) + '），只能做哈希锁定' };
  }
  if (signature.broken) return { ok: false, signed: true, sha256: sha256, reason: signature.reason };
  if (signature.sha256 !== sha256) {
    return { ok: false, signed: true, sha256: sha256, reason: '内容已被修改：签名记录 ' + String(signature.sha256).slice(0, 16) + '...，实际 ' + sha256.slice(0, 16) + '...' };
  }
  const key = opts.key || readKey(opts);
  if (!key) {
    return { ok: false, signed: true, sha256: sha256, signature: signature, reason: '缺少密钥，无法验证签名（换台机器要先导入同一个密钥）' };
  }
  const expected = hmacOf(key, payloadOf(signature));
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(String(signature.hmac || ''), 'hex');
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, signed: true, sha256: sha256, signature: signature, reason: '签名不匹配：内容哈希对得上，但 HMAC 校验失败（签名被伪造或密钥不对）' };
  }
  return { ok: true, signed: true, sha256: sha256, signature: signature, reason: '签名有效，签发者 ' + signature.signer };
}

export function loadTrust(options) {
  const file = trustStorePath(options);
  if (!existsSync(file)) return { version: 1, packs: [] };
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(data.packs)) return { version: 1, packs: [] };
    return data;
  } catch (err) {
    return { version: 1, packs: [], broken: true };
  }
}

function saveTrust(data, options) {
  const file = trustStorePath(options);
  mkdirSync(homeDir(options), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return file;
}

// 信任一个包：有签名就先验签；没签名就只锁定哈希（TOFU），并在返回里明确标注。
export function addTrust(file, options) {
  const opts = options || {};
  const target = resolve(file);
  const check = verifyFile(target, opts);
  const sha256 = check.sha256 || hashFile(target);
  const store = loadTrust(opts);
  const entry = {
    file: basename(target),
    sha256: sha256,
    verified: Boolean(check.ok),
    signer: check.signature ? check.signature.signer : null,
    signedAt: check.signature ? check.signature.signedAt : null,
    trustedAt: new Date().toISOString()
  };
  const index = store.packs.findIndex(function (item) { return item.file === entry.file; });
  if (index > -1) store.packs[index] = entry;
  else store.packs.push(entry);
  saveTrust(store, opts);
  return { entry: entry, store: trustStorePath(opts), verify: check };
}

export function listTrust(options) {
  return loadTrust(options).packs;
}

export function checkFilesTrusted(files, options) {
  const opts = options || {};
  const store = loadTrust(opts);
  const results = (files || []).map(function (file) {
    const target = resolve(file);
    const name = basename(target);
    const sha256 = hashFile(target);
    const entry = store.packs.filter(function (item) { return item.file === name; })[0];
    if (!entry) {
      return { file: name, trusted: false, reason: '未被信任（先运行 pack trust ' + name + '）' };
    }
    if (entry.sha256 !== sha256) {
      return { file: name, trusted: false, reason: '内容与受信任时的哈希不一致，可能被替换过' };
    }
    if (opts.requireSignature && !entry.verified) {
      return { file: name, trusted: false, reason: '要求签名，但该包只有哈希锁定（TOFU）' };
    }
    return { file: name, trusted: true, reason: entry.verified ? '签名已校验且哈希一致' : '哈希锁定一致（TOFU，无签名）' };
  });
  const untrusted = results.filter(function (row) { return !row.trusted; });
  return { ok: untrusted.length === 0, files: results, untrusted: untrusted };
}

export function listPackFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(function (name) { return name.endsWith('.json'); })
    .sort()
    .map(function (name) { return join(dir, name); });
}
