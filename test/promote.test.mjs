// 草案 → 正式题（pack promote）：机器只做能确定的事，题面必须人写。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promoteDraft } from '../src/cli/commands/packs.mjs';
import { validatePack } from '../src/core/schema.mjs';
import { isAllowed } from '../src/core/exec.mjs';

const validate = function (pack) { return validatePack(pack, { isAllowedCommand: isAllowed }); };

function draftTask(overrides) {
  return Object.assign({
    id: 'draft.demo.build',
    track: 'demo',
    title: '（草案）docker build -t demo:1.0 .',
    goal: '按来源示例完成：docker build -t demo:1.0 .',
    hint: '来自网站示例，请人工确认要素是否合理后改成自己的话',
    sample: 'docker build -t demo:1.0 .',
    require: [
      { p: '^\\s*docker', tip: '应使用 docker build' },
      { p: '-t\\s+demo:1\\.0', tip: '缺少 -t demo:1.0' }
    ],
    forbid: []
  }, overrides || {});
}

function draftPack(tasks) {
  return { id: 'repo-demo', name: '（草案）来自 demo 的题库', track: 'docker', version: 1, tasks: tasks };
}

test('promote 会按难度口径补 level，并把可改可不改的地方列成提醒', function () {
  const result = promoteDraft(draftPack([draftTask()]), { dryRun: true, validate: validate });
  assert.deepEqual(result.errors, []);
  assert.equal(result.levelsAdded.length, 1, '没有 level 的草案要自动补上');
  assert.equal(result.levelsAdded[0].level, 'easy', '2 个要素、无禁止项、无变体 → 简单');
  assert.ok(result.warnings.some(function (msg) { return msg.indexOf('草案') > -1; }), '标题还是草案字样要提醒');
  assert.ok(result.warnings.some(function (msg) { return msg.indexOf('占位话') > -1; }), '提示是占位话要提醒');
  assert.ok(result.warnings.some(function (msg) { return msg.indexOf('只有 2 个要素') > -1; }), '要素太少要提醒');
});

test('dry-run 不写文件，正式 promote 写进 packs 并通过 schema 校验', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-learn-promote-'));
  const target = join(home, 'packs/repo-demo.json');
  const dry = promoteDraft(draftPack([draftTask()]), { dryRun: true, into: target, validate: validate });
  assert.equal(dry.dryRun, true);
  assert.throws(function () { readFileSync(target, 'utf8'); }, 'dry-run 不应写文件');

  const written = promoteDraft(draftPack([draftTask()]), { into: target, validate: validate });
  assert.deepEqual(written.errors, []);
  const saved = JSON.parse(readFileSync(target, 'utf8'));
  assert.equal(saved.tasks[0].level, 'easy', '落盘的包里要有 level');
  assert.deepEqual(validatePack(saved, { isAllowedCommand: isAllowed }).errors, [], '落盘的包必须通过 schema 校验');

  // 二次 promote 不该悄悄覆盖
  const again = promoteDraft(draftPack([draftTask()]), { into: target, validate: validate });
  assert.ok(again.errors.some(function (msg) { return msg.indexOf('目标已存在') > -1; }), '已存在要拦住，除非 --force');
  rmSync(home, { recursive: true, force: true });
});

test('目标路径必须落在允许的根之内（--into 是调用方给的字符串，不能当路径随便写）', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-learn-promote-'));
  try {
    const outside = join(home, 'escaped.json');
    const escape = promoteDraft(draftPack([draftTask()]), { baseDir: join(home, 'work'), into: '../escaped.json', validate: validate });
    assert.ok(escape.errors.some(function (msg) { return msg.indexOf('目标必须写在') > -1; }),
      '相对路径越界要被拦住：' + escape.errors.join('；'));
    assert.throws(function () { readFileSync(outside, 'utf8'); }, '越界目标不该被写出来');

    const absolute = promoteDraft(draftPack([draftTask()]), { baseDir: join(home, 'work'), into: '/tmp/dsh-learn-escape.json', validate: validate });
    assert.ok(absolute.errors.some(function (msg) { return msg.indexOf('目标必须写在') > -1; }), '绝对路径越界同样要拦住');

    // 根内的正常写法不受影响
    const inside = promoteDraft(draftPack([draftTask()]), { baseDir: join(home, 'work'), into: 'packs/repo-demo.json', validate: validate });
    assert.deepEqual(inside.errors, [], '根内写入应正常：' + inside.errors.join('；'));
    assert.ok(readFileSync(join(home, 'work/packs/repo-demo.json'), 'utf8').indexOf('repo-demo') > -1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('schema 不合法的草案不会被 promote 出去', function () {
  const broken = draftPack([draftTask({ require: [] })]);
  const result = promoteDraft(broken, { dryRun: true, validate: validate });
  assert.ok(result.errors.length > 0, '没有要素的题不该通过校验');
});