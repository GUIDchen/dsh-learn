// GitHub / git 仓库导入的"地址归一化 + 克隆候选链"测试。
// 这段逻辑全是纯函数，所以不连网也能把分支覆盖到：简写、镜像、本机 git 改写、复用上次克隆。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeRepoInput, cloneCandidates, parseGitRewrites, applyGitRewrites, findExistingClone, resolveRepoDir } from '../src/core/repo-learn.mjs';

test('地址归一化：owner/repo 简写、带 .git 的 https、ssh 都算远程', function () {
  assert.deepEqual(normalizeRepoInput('gin-gonic/gin'), { kind: 'remote', url: 'https://github.com/gin-gonic/gin', label: 'gin' });
  assert.equal(normalizeRepoInput('https://github.com/gin-gonic/gin.git').url, 'https://github.com/gin-gonic/gin.git');
  assert.equal(normalizeRepoInput('https://github.com/gin-gonic/gin.git').label, 'gin');
  assert.equal(normalizeRepoInput('git@github.com:owner/repo.git').kind, 'remote');
  assert.equal(normalizeRepoInput('git@github.com:owner/repo.git').label, 'repo');
  assert.deepEqual(normalizeRepoInput(''), { kind: 'empty', url: '', label: '' });
});

test('地址归一化：本地目录不会被当成 owner/repo', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-repo-local-'));
  try {
    const dir = join(home, 'nested');
    mkdirSync(dir, { recursive: true });
    const result = normalizeRepoInput(dir);
    assert.equal(result.kind, 'local');
    assert.equal(result.label, 'nested');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('解析本机 git 的 insteadOf 改写，并算出真正会被访问的地址', function () {
  const text = [
    'url.https://ghproxy.net/https://github.com/.insteadof https://github.com/',
    'url.https://ghproxy.net/https://github.com/.insteadof http://github.com/',
    ''
  ].join('\n');
  const rewrites = parseGitRewrites(text);
  assert.equal(rewrites.length, 2);
  assert.deepEqual(rewrites[0], { base: 'https://ghproxy.net/https://github.com/', prefix: 'https://github.com/' });
  assert.equal(
    applyGitRewrites('https://github.com/octocat/Hello-World', rewrites),
    'https://ghproxy.net/https://github.com/octocat/Hello-World'
  );
  assert.equal(applyGitRewrites('https://example.com/x', rewrites), 'https://example.com/x', '不匹配的前缀不该被动过');
  assert.deepEqual(parseGitRewrites(''), []);
});

test('克隆候选链：默认直连打头，镜像在后；被本机改写时如实标注', function () {
  const plain = cloneCandidates('https://github.com/gin-gonic/gin');
  assert.equal(plain[0].via, 'direct');
  assert.equal(plain[0].effective, 'https://github.com/gin-gonic/gin');
  assert.ok(plain.length >= 2 && plain[1].via.indexOf('mirror:') === 0, '直连之后应有镜像候选');
  assert.equal(new Set(plain.map(function (c) { return c.effective; })).size, plain.length, '候选地址不该重复');

  const rewrites = parseGitRewrites('url.https://ghproxy.net/.insteadof https://github.com/');
  const rewritten = cloneCandidates('https://github.com/gin-gonic/gin', {}, rewrites);
  assert.ok(rewritten[0].via.indexOf('改写') > -1, '被改写时要说出来，否则用户看到"直连失败"里写着镜像域名会一头雾水');
  assert.equal(rewritten[0].effective, 'https://ghproxy.net/gin-gonic/gin');
});

test('克隆候选链：DSH_LEARN_GIT_MIRROR 设置后只用它', function () {
  const pinned = cloneCandidates('https://github.com/gin-gonic/gin', { DSH_LEARN_GIT_MIRROR: 'https://ghfast.top/' });
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].via, 'mirror:https://ghfast.top');
  assert.equal(pinned[0].effective, 'https://ghfast.top/gin-gonic/gin');
});

test('复用上次克隆：目录不存在/没有匹配/有多个时各取所需', function () {
  assert.equal(findExistingClone('/definitely/not/here', 'gin'), '');
  const home = mkdtempSync(join(tmpdir(), 'dsh-repo-reuse-'));
  try {
    assert.equal(findExistingClone(home, 'gin'), '', '空目录没有可复用的克隆');
    mkdirSync(join(home, 'gin-111111'));
    mkdirSync(join(home, 'gin-222222'));
    mkdirSync(join(home, 'other-333333'));
    const found = findExistingClone(home, 'gin');
    assert.equal(found, join(home, 'gin-222222'), '多个克隆取最新的那个（按名字排序）');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
// resolveRepoDir 是 CLI 与网页版**共用**的那一份实现（克隆路线全在这里），
// runClone 可注入，所以下面这些分支不连网也能跑。
test('resolveRepoDir：直连成功就用它，且不碰镜像', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-resolve-'));
  try {
    const tried = [];
    const out = resolveRepoDir(normalizeRepoInput('octocat/Hello-World'), {
      baseDir: home,
      runClone: function (args) { tried.push(args[args.length - 2]); return { status: 0, stderr: '' }; }
    });
    assert.equal(out.ok, true);
    assert.equal(out.via, 'direct');
    assert.equal(tried.length, 1, '直连成功就不该再试镜像');
    assert.ok(out.dir.indexOf(home) === 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveRepoDir：直连失败会依次试镜像，每条尝试都有记录', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-resolve-'));
  try {
    const notes = [];
    const out = resolveRepoDir(normalizeRepoInput('owner/repo'), {
      baseDir: home,
      note: function (kind, text) { notes.push(kind + ':' + text); },
      runClone: function (args) {
        if (args.indexOf('https://github.com/owner/repo') > -1) return { status: 128, stderr: 'fatal: nope' };
        return { status: 0, stderr: '' };
      }
    });
    assert.equal(out.ok, true);
    assert.ok(out.via.indexOf('mirror:') === 0, '第二条候选应当是镜像，实际 ' + out.via);
    assert.ok(notes.some(function (line) { return line.indexOf('try:') === 0; }), '每条候选都要有尝试记录');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveRepoDir：复用上次克隆，--refresh 才重新拉', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-resolve-'));
  try {
    mkdirSync(join(home, 'repo-111111'));
    const reuse = resolveRepoDir(normalizeRepoInput('owner/repo'), { baseDir: home, runClone: function () { throw new Error('复用不该触发克隆'); } });
    assert.equal(reuse.ok, true);
    assert.equal(reuse.via, 'reuse');
    assert.equal(reuse.dir, join(home, 'repo-111111'));

    let cloned = 0;
    const refreshed = resolveRepoDir(normalizeRepoInput('owner/repo'), {
      baseDir: home,
      refresh: true,
      runClone: function () { cloned += 1; return { status: 0, stderr: '' }; }
    });
    assert.equal(refreshed.ok, true);
    assert.equal(cloned, 1, '--refresh 必须真的重新拉一次');
    assert.equal(refreshed.via, 'direct');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveRepoDir：全部候选失败要列原因，且不留半个目录', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-resolve-'));
  try {
    const out = resolveRepoDir(normalizeRepoInput('owner/repo'), {
      baseDir: home,
      runClone: function () { return { status: 128, stderr: 'fatal: could not read Username' }; }
    });
    assert.equal(out.ok, false);
    assert.equal(out.code, 3);
    assert.ok(out.failure.length >= 2, '直连与镜像的原因都要留着');
    assert.ok(out.failure[0].reason.indexOf('could not read Username') > -1);
    assert.deepEqual(readdirSync(home), [], '失败的半成品目录要被清掉');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveRepoDir：本地目录不存在时给 3 号退出码', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-resolve-'));
  try {
    const out = resolveRepoDir(normalizeRepoInput('/definitely/not/here'), { baseDir: home });
    assert.equal(out.ok, false);
    assert.equal(out.kind, 'local');
    assert.ok(out.error.indexOf('目录不存在') > -1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
