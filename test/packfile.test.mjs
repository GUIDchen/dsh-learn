// 题包脚手架与深度校验：生成即通过校验，坏包必须被逐条点名。
//
// 为什么需要深度校验：core/schema.mjs 只查结构，而「难度必须等于口径」「参考答案必须自测满分」
// 以前只在 CI 的 catalog-audit 里查——作者本地 validate 通过、CI 才红。这里把两条口径下沉。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { packTemplate, deepValidate, deriveRequire } = await import('../src/core/packfile.mjs');
const { judge } = await import('../src/core/judge.mjs');

test('pack new 生成的模板开箱即通过深度校验（结构 + 口径 + 参考答案自测）', function () {
  const pack = packTemplate({ id: 'demo-pg', name: 'PostgreSQL 排障', track: 'database', sample: 'psql -c "select version()"' });
  const check = deepValidate(pack);
  assert.equal(check.ok, true, '不该有错误：' + check.errors.join(' | '));
  assert.equal(check.errors.length, 0);
  assert.equal(check.packId, 'demo-pg');
  assert.equal(check.taskCount, 1);
  // 难度是按口径算的，不是手填的
  const task = pack.tasks[0];
  assert.equal(task.level, 'easy', '1 个要素、无禁止项、无变体 → easy，实际 ' + task.level);
  // 参考答案必须真的自测满分（这是模板"开箱可用"的核心保证）
  assert.equal(judge(task, task.sample, 'darwin').score, 100, '模板的参考答案应当自测满分');
  // 未填的占位必须被提醒，不能被当成正式包混过去
  assert.ok(check.warnings.some(function (m) { return m.indexOf('TODO') > -1; }), '要提醒 TODO 没填：' + check.warnings.join(' | '));
});

test('要素从参考答案推导；没有 sample 时如实提醒', function () {
  const derived = deriveRequire('docker run --rm --gpus all nvidia-smi -L');
  assert.ok(derived.length >= 2, JSON.stringify(derived));
  assert.equal(derived[0].p, 'docker');
  assert.ok(derived.some(function (row) { return row.p.indexOf('--gpus') > -1; }), JSON.stringify(derived));
  assert.deepEqual(deriveRequire(''), []);
  const pack = packTemplate({ id: 'no-sample', name: 'x', track: 'linux' });
  const check = deepValidate(pack);
  assert.ok(check.warnings.some(function (m) { return m.indexOf('没有参考答案') > -1; }), check.warnings.join(' | '));
});

test('坏包被逐条点名：难度口径、参考答案自测、白名单', function () {
  const level = packTemplate({ id: 'x-level', track: 'linux', name: 'x', sample: 'uname -s' });
  level.tasks[0].level = 'hard';
  const levelCheck = deepValidate(level);
  assert.equal(levelCheck.ok, false);
  assert.ok(levelCheck.errors[0].indexOf('难度声明与口径不符') > -1, levelCheck.errors.join(' | '));
  assert.ok(levelCheck.errors[0].indexOf('easy') > -1, '要说清应当是什么：' + levelCheck.errors[0]);

  const sample = packTemplate({ id: 'x-sample', track: 'linux', name: 'x', sample: 'uname -s' });
  sample.tasks[0].require.push({ p: 'uname\\s+-a', tip: '要输出全部信息' });
  const sampleCheck = deepValidate(sample);
  assert.equal(sampleCheck.ok, false);
  assert.ok(sampleCheck.errors.some(function (m) { return m.indexOf('参考答案只拿到') > -1; }), sampleCheck.errors.join(' | '));

  const verify = packTemplate({ id: 'x-verify', track: 'linux', name: 'x', sample: 'uname -s', verifyCmd: 'rm -rf /tmp/x' });
  const verifyCheck = deepValidate(verify);
  assert.equal(verifyCheck.ok, false);
  assert.ok(verifyCheck.errors.some(function (m) { return m.indexOf('只读白名单') > -1; }), verifyCheck.errors.join(' | '));
});

test('真实题库包在深度校验下零错误（钉在真实数据上，防误报）', function () {
  const dir = join(ROOT, 'packs');
  const files = readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).sort().slice(0, 6);
  assert.ok(files.length > 0, '要能读到题库包');
  const problems = [];
  let tasks = 0;
  files.forEach(function (name) {
    const check = deepValidate(JSON.parse(readFileSync(join(dir, name), 'utf8')));
    tasks += check.taskCount;
    if (!check.ok) problems.push(name + '：' + check.errors.slice(0, 2).join('；'));
  });
  assert.deepEqual(problems, [], '真实包不该报错（否则是校验器口径错）：' + problems.join(' | '));
  assert.ok(tasks > 10, '至少覆盖几十道题：' + tasks);
});

test('CLI：pack new 落盘后能被 pack validate --deep 校验通过', function () {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-new-'));
  const created = spawnSync(process.execPath, [join(ROOT, 'src/cli.mjs'), 'pack', 'new', 'demo-cli', '--name=演示包', '--track=linux', '--sample=uname -s', '--dir=' + dir], { encoding: 'utf8' });
  assert.equal(created.status, 0, '建包应当成功：' + created.stderr + created.stdout);
  const file = join(dir, 'demo-cli.json');
  assert.ok(existsSync(file), '要落盘：' + file);
  assert.ok(created.stdout.indexOf('深度校验通过') > -1, created.stdout);
  const checked = spawnSync(process.execPath, [join(ROOT, 'src/cli.mjs'), 'pack', 'validate', file, '--deep'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, '深度校验应当通过：' + checked.stderr + checked.stdout);
  assert.ok(checked.stdout.indexOf('深度校验通过') > -1, checked.stdout);
  // 不允许静默覆盖既有包
  const again = spawnSync(process.execPath, [join(ROOT, 'src/cli.mjs'), 'pack', 'new', 'demo-cli', '--dir=' + dir], { encoding: 'utf8' });
  assert.equal(again.status, 3, '重复建包要拦下来：' + again.stdout);
  rmSync(dir, { recursive: true, force: true });
});
