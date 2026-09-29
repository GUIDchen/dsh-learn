import test from 'node:test';
import { EXPECT } from './expected.mjs';
import assert from 'node:assert/strict';
import { validatePack, validateTask, assertPack } from '../src/core/schema.mjs';
import { mergePacks, loadPackDir, loadAll, PACK_DIR } from '../src/core/packs.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TASKS, TRACKS, BUILTIN_PACK_IDS, findTask, listTasks } from '../src/core/tasks.mjs';
// 「内置题库包全部通过校验」这条对的是随工具发布的 packs/ 目录，用内置包清单比对
const PACK_IDS = BUILTIN_PACK_IDS;
import { isAllowed } from '../src/core/exec.mjs';
import { addTrust } from '../src/core/trust.mjs';

const opts = { isAllowedCommand: isAllowed };

test('内置题库包全部通过校验', function () {
  const packs = loadPackDir(PACK_DIR);
  assert.ok(packs.length >= 2, '至少应有 linux-core 与 docker-core 两个包');
  packs.forEach(function (pack) {
    const result = validatePack(pack, opts);
    assert.deepEqual(result.errors, [], '包 ' + pack.id + ' 校验失败: ' + result.errors.join('; '));
    assert.ok(result.taskCount > 0);
  });
  assert.deepEqual(PACK_IDS.slice().sort(), packs.map(function (p) { return p.id; }).sort());
});

test('任务表可由包合并而来，且轨道可枚举', function () {
  assert.ok(TASKS.length >= EXPECT.tasks, '内置任务至少 ' + EXPECT.tasks + ' 条，实际 ' + TASKS.length);
  assert.ok(TRACKS.indexOf('linux') > -1 && TRACKS.indexOf('docker') > -1);
  assert.equal(listTasks('linux').length, listTasks('linux').filter(function (t) { return t.track === 'linux'; }).length);
  assert.ok(findTask('docker.run-web'));
  assert.equal(findTask('not.exist'), null);
  assert.ok(TASKS.every(function (task) { return task.packId; }), '每个任务都应带来源包 id');
});

test('校验器拦住缺要素、坏正则与不在白名单的验证命令', function () {
  const bad = {
    id: 'demo-bad',
    track: 'demo',
    tasks: [
      { id: 'demo.empty', track: 'demo', title: 't', goal: 'g', require: [] },
      { id: 'demo.badre', track: 'demo', title: 't', goal: 'g', require: [{ p: '([', tip: 'x' }] },
      { id: 'demo.unsafe', track: 'demo', title: 't', goal: 'g', require: [{ p: 'x', tip: 'x' }], verify: { cmd: 'rm -rf /', expect: '.*' } }
    ]
  };
  const result = validatePack(bad, opts);
  assert.ok(result.errors.some(function (m) { return m.indexOf('require 要素') > -1; }));
  assert.ok(result.errors.some(function (m) { return m.indexOf('正则无法编译') > -1; }));
  assert.ok(result.errors.some(function (m) { return m.indexOf('白名单') > -1; }));
  assert.throws(function () { assertPack(bad, opts); }, /题库包校验失败/);
});

test('severity 只接受 warn 与 block', function () {
  const badSeverity = {
    id: 'demo-sev',
    track: 'demo',
    tasks: [{ id: 'demo.sev', track: 'demo', title: 't', goal: 'g', require: [{ p: 'x', tip: 'x' }], forbid: [{ p: 'y', tip: 'y', severity: 'boom' }] }]
  };
  const result = validatePack(badSeverity, opts);
  assert.ok(result.errors.some(function (m) { return m.indexOf('severity') > -1; }));
  const ok = validateTask({ id: 'demo.ok', track: 'demo', title: 't', goal: 'g', require: [{ p: 'x', tip: 'x' }], forbid: [{ p: 'y', tip: 'y', severity: 'block' }] }, opts);
  assert.deepEqual(ok.errors, []);
});

test('校验器认难度标注：只接受 easy/medium/hard', function () {
  const base = { id: 'demo.level', track: 'demo', title: 't', goal: 'g', require: [{ p: 'x', tip: 'x' }] };
  assert.deepEqual(validateTask(Object.assign({ level: 'hard' }, base), opts).errors, []);
  assert.deepEqual(validateTask(base, opts).errors, [], '不写 level 也合法（外部包兼容）');
  const bad = validateTask(Object.assign({ level: '超难' }, base), opts);
  assert.ok(bad.errors.some(function (m) { return m.indexOf('level 只能是') > -1; }), '非法难度要报错：' + bad.errors.join('；'));
});

test('校验器拦住未知平台变体与任务 id 重复', function () {
  const bad = {
    id: 'demo-bad2',
    track: 'demo',
    tasks: [
      { id: 'demo.variants', track: 'demo', title: 't', goal: 'g', variants: { plan9: { require: [{ p: 'x', tip: 'x' }] } } },
      { id: 'demo.variants', track: 'demo', title: 't', goal: 'g', require: [{ p: 'x', tip: 'x' }] }
    ]
  };
  const result = validatePack(bad, opts);
  assert.ok(result.errors.some(function (m) { return m.indexOf('不在已知平台') > -1; }));
  assert.ok(result.errors.some(function (m) { return m.indexOf('id 重复') > -1; }));
});

// platforms 是新加的口径：它决定这道题在哪些平台上参与体检。写错平台名（macos）不会报错、
// 只会让那道题在真平台上悄悄逃过体检——所以必须在校验层拦住。
test('校验器认 platforms 声明，写错平台名要拦住', function () {
  const base = { id: 'demo.plat', track: 'demo', title: 't', goal: 'g', sample: 'x', require: [{ p: 'x', tip: 'x' }] };
  assert.deepEqual(validateTask(Object.assign({ platforms: ['darwin'] }, base), opts).errors, []);
  assert.deepEqual(validateTask(Object.assign({ platforms: ['darwin', 'linux'] }, base), opts).errors, []);
  const typo = validateTask(Object.assign({ platforms: ['macos'] }, base), opts);
  assert.ok(typo.errors.some(function (m) { return m.indexOf('未知平台 macos') > -1; }), JSON.stringify(typo.errors));
  const empty = validateTask(Object.assign({ platforms: [] }, base), opts);
  assert.ok(empty.errors.some(function (m) { return m.indexOf('非空数组') > -1; }), JSON.stringify(empty.errors));
});
test('单任务校验给出可定位的错误', function () {
  const result = validateTask({ id: 'Bad Id', require: [] }, opts);
  assert.ok(result.errors.length >= 3);
  assert.ok(result.errors.some(function (m) { return m.indexOf('小写字母数字') > -1; }));
});

test('外部包目录：新增题库并覆盖同 id 的内置题', function () {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-learn-packs-'));
  const custom = {
    id: 'custom-pack',
    name: '自定义包',
    track: 'demo',
    version: 1,
    tasks: [
      { id: 'demo.hi', track: 'demo', title: '自定义题', goal: 'g', hint: 'h', sample: 'echo hi', require: [{ p: 'echo', tip: 'x' }] },
      { id: 'docker.logs-follow', track: 'docker', title: '被覆盖的题', goal: 'g', require: [{ p: 'changed', tip: '已覆盖' }] }
    ]
  };
  writeFileSync(join(dir, 'custom-pack.json'), JSON.stringify(custom), 'utf8');

  const loaded = loadAll({ extraDir: dir });
  const added = loaded.tasks.filter(function (task) { return task.id === 'demo.hi'; })[0];
  assert.ok(added, '外部包的新任务应被加载');
  assert.equal(added.packId, 'custom-pack');
  assert.ok(loaded.tracks.indexOf('demo') > -1);

  const overridden = loaded.tasks.filter(function (task) { return task.id === 'docker.logs-follow'; })[0];
  assert.equal(overridden.title, '被覆盖的题', '同 id 任务应被外部包覆盖');
  assert.equal(overridden.packId, 'custom-pack');

  const builtinOnly = loadAll();
  assert.equal(builtinOnly.tasks.filter(function (task) { return task.id === 'docker.logs-follow'; })[0].title, '持续跟踪容器日志');

  rmSync(dir, { recursive: true, force: true });
});

test('信任门禁：默认关闭，打开后未信任的外部包不会被加载', function () {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-learn-gatepacks-'));
  const home = mkdtempSync(join(tmpdir(), 'dsh-learn-gatehome-'));
  const file = join(dir, 'gate.json');
  writeFileSync(file, JSON.stringify({
    id: 'gate-pack',
    track: 'demo',
    version: 1,
    tasks: [{ id: 'demo.gate', track: 'demo', title: '门禁题', goal: 'g', require: [{ p: 'echo', tip: 'x' }] }]
  }), 'utf8');

  // 默认不设门禁：直接加载
  assert.ok(loadAll({ extraDir: dir }).tasks.some(function (task) { return task.id === 'demo.gate'; }));

  // 打开门禁且未信任：拒绝加载
  assert.throws(function () { loadAll({ extraDir: dir, requireTrust: true, home: home }); }, /未通过信任检查/);

  // 记录信任后可加载
  addTrust(file, { home: home });
  const gated = loadAll({ extraDir: dir, requireTrust: true, home: home });
  assert.ok(gated.tasks.some(function (task) { return task.id === 'demo.gate'; }));

  // 内容被改后再次被拦下
  writeFileSync(file, JSON.stringify({
    id: 'gate-pack',
    track: 'demo',
    version: 1,
    tasks: [{ id: 'demo.gate', track: 'demo', title: '偷偷改过', goal: 'g', require: [{ p: 'echo', tip: 'x' }] }]
  }), 'utf8');
  assert.throws(function () { loadAll({ extraDir: dir, requireTrust: true, home: home }); }, /哈希不一致/);

  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('坏包在加载时就被拒绝，而不是带病运行', function () {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-learn-badpacks-'));
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ id: 'bad', track: 'demo', tasks: [{ id: 'bad.x', track: 'demo', title: 't', goal: 'g', require: [] }] }), 'utf8');
  assert.throws(function () { loadAll({ extraDir: dir }); }, /题库包校验失败/);
  rmSync(dir, { recursive: true, force: true });
});

test('mergePacks 允许外部包覆盖同 id 任务', function () {
  const base = { id: 'a', track: 'demo', tasks: [{ id: 'demo.x', track: 'demo', title: 'base', goal: 'g', require: [{ p: 'x', tip: 'x' }] }] };
  const override = { id: 'b', track: 'demo', tasks: [{ id: 'demo.x', track: 'demo', title: 'override', goal: 'g', require: [{ p: 'y', tip: 'y' }] }] };
  const merged = mergePacks([base, override]);
  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.tasks[0].title, 'override');
  assert.equal(merged.tasks[0].packId, 'b');
});
