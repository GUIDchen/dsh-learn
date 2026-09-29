// 平台自检的元测试：探针集合的完整性，以及"在本机真的跑一遍"。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROBES, PLATFORM_SHELL, listProbes, runSelftest, buildContainerScript, parseContainerOutput, detectWsl } from '../src/core/selftest.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('探针集合结构完整，id 在同一平台内唯一', function () {
  Object.keys(PROBES).forEach(function (platform) {
    const probes = PROBES[platform].probes;
    assert.ok(probes.length >= 6, platform + ' 的探针太少');
    const ids = new Set();
    probes.forEach(function (probe) {
      assert.ok(probe.id && probe.desc && probe.script && probe.why, platform + ' 的探针字段不全');
      assert.ok(['ok', 'fail'].indexOf(probe.expect) > -1, probe.id + ' 的 expect 只能是 ok 或 fail');
      assert.ok(!ids.has(probe.id), platform + ' 探针 id 重复: ' + probe.id);
      ids.add(probe.id);
    });
    assert.ok(listProbes(platform).length === probes.length);
  });
  assert.deepEqual(listProbes('plan9'), []);
});

test('每个平台都有明确的执行 shell（Windows 用 cmd）', function () {
  Object.keys(PROBES).forEach(function (platform) {
    assert.ok(Array.isArray(PLATFORM_SHELL[platform]) && PLATFORM_SHELL[platform].length === 2, platform + ' 缺少 shell 定义');
  });
  assert.deepEqual(PLATFORM_SHELL.win32, ['cmd', '/c']);
  assert.deepEqual(PLATFORM_SHELL.darwin, ['sh', '-c']);
});

test('Windows 探针断言的是 POSIX 工具的缺席', function () {
  const win = new Map(PROBES.win32.probes.map(function (probe) { return [probe.id, probe.expect]; }));
  assert.equal(win.get('where-sed'), 'fail', '原生 Windows 没有 sed');
  assert.equal(win.get('where-stat'), 'fail');
  assert.equal(win.get('where-systemctl'), 'fail', 'Windows 没有 systemd');
  assert.equal(win.get('where-wsl'), 'ok', 'Win10/11 自带 wsl');
  assert.equal(win.get('node-version'), 'ok');
  const dry = runSelftest({ platform: 'win32', runner: 'local', run: false });
  assert.equal(dry.ran, false);
  assert.equal(dry.probes.length, PROBES.win32.probes.length);
});

test('WSL2 探测只看 /proc/version 的内容', function () {
  assert.equal(detectWsl({ procVersion: 'Linux version 5.15.90.1-microsoft-standard-WSL2 (gcc ...)' }), true);
  assert.equal(detectWsl({ procVersion: 'Linux version 6.6.0-generic #1 SMP' }), false);
  assert.equal(detectWsl({ procVersion: 'wsl' }), true);
  assert.equal(detectWsl({ procVersion: '' }), false);
});

test('BSD 与 GNU 的预期互为镜像', function () {
  const darwin = new Map(PROBES.darwin.probes.map(function (probe) { return [probe.id, probe.expect]; }));
  const linux = new Map(PROBES.linux.probes.map(function (probe) { return [probe.id, probe.expect]; }));
  ['sed-plain', 'sed-empty-suffix', 'stat-gnu', 'stat-bsd', 'date-gnu', 'date-bsd'].forEach(function (id) {
    assert.ok(darwin.has(id) && linux.has(id), id + ' 应同时存在于两个平台');
    assert.notEqual(darwin.get(id), linux.get(id), id + ' 在两个平台的预期应当相反');
  });
});

test('默认 dry-run：不跑任何探针', function () {
  const result = runSelftest({ platform: 'darwin', runner: 'local', run: false });
  assert.equal(result.ran, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.probes.length, PROBES.darwin.probes.length);
});

test('未知平台与未知后端给出可读结果', function () {
  const bad = runSelftest({ platform: 'plan9', runner: 'local', run: true });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /未知平台/);
});

test('容器脚本带标记，输出可解析', function () {
  const script = buildContainerScript('linux');
  assert.match(script, /@@linux\.sed-plain/);
  const parsed = parseContainerOutput('linux', '@@linux.sed-plain:0\n@@linux.stat-bsd:1\n');
  const plain = parsed.filter(function (row) { return row.id === 'sed-plain'; })[0];
  assert.equal(plain.actual, 'ok');
  assert.equal(plain.ok, true);
  const bsd = parsed.filter(function (row) { return row.id === 'stat-bsd'; })[0];
  assert.equal(bsd.actual, 'fail');
  assert.equal(bsd.ok, true);
  const missing = parsed.filter(function (row) { return row.id === 'uname'; })[0];
  assert.equal(missing.actual, 'missing');
  assert.equal(missing.ok, false);
});

// 真机自检：这台机器上的工具链必须和题库假设一致。Windows 上跳过（建议在 WSL2 里跑 linux profile）。
const posix = process.platform === 'darwin' || process.platform === 'linux';
test('本机平台自检全部通过', { skip: posix ? false : '仅 POSIX 平台执行' }, function () {
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const workdir = mkdtempSync(join(tmpdir(), 'dsh-learn-selftest-'));
  const result = runSelftest({ platform: platform, runner: 'local', run: true, cwd: workdir });
  rmSync(workdir, { recursive: true, force: true });
  assert.equal(result.ran, true);
  const failed = result.probes.filter(function (probe) { return !probe.ok; });
  assert.deepEqual(failed.map(function (probe) { return probe.id + '（预期 ' + probe.expect + ' 实际 ' + probe.actual + '）'; }), [], '本机工具链与题库假设不符');
});
