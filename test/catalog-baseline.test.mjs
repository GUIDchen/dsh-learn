// 题库基线护栏：这份文件独立于运行时题库，专门拦"题被静默删掉/包被写坏"。
// 背景：test/expected.mjs 的期望值全是从运行时题库推导的，题库少 50 道题它也照样通过；
// 而这个项目已经因为"静默丢数据"吃过两次亏（项目元数据被覆盖、完成报告被插成两份）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { TASKS, PACK_IDS } from '../src/core/tasks.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = join(ROOT, 'docs/catalog-baseline.json');
const baseline = JSON.parse(readFileSync(FILE, 'utf8'));

test('题库基线文件本身是完整的（有 id 清单与各类计数）', function () {
  assert.ok(Array.isArray(baseline.ids) && baseline.ids.length >= 500, '基线里要有题号清单：' + (baseline.ids || []).length);
  assert.ok(baseline.byTrack && Object.keys(baseline.byTrack).length >= 20, '基线里要有按轨道的计数');
  assert.ok(typeof baseline.tasks === 'number' && baseline.tasks > 0, '基线里要有总题数');
  assert.ok(baseline.generatedAt, '要记录基线生成时间，便于判断它有多旧');
  assert.equal(new Set(baseline.ids).size, baseline.ids.length, '基线里的题号不能重复');
});

test('基线里的每一道题都还在（题号不许静默消失）', function () {
  const have = new Set(TASKS.map(function (task) { return task.id; }));
  const missing = baseline.ids.filter(function (id) { return !have.has(id); });
  assert.deepEqual(missing, [],
    '有 ' + missing.length + ' 道题从题库里消失了：' + missing.slice(0, 8).join('、')
    + '（如果是有意删题/改名，确认后跑 node scripts/catalog-baseline.mjs --update）');
});

test('每条轨道、每个难度、每个包的题数都不许缩水', function () {
  const byTrack = {};
  const byLevel = {};
  const byPack = {};
  TASKS.forEach(function (task) {
    byTrack[task.track] = (byTrack[task.track] || 0) + 1;
    const level = task.level || 'unlabeled';
    byLevel[level] = (byLevel[level] || 0) + 1;
    byPack[task.packId] = (byPack[task.packId] || 0) + 1;
  });

  const check = function (label, now, was) {
    const shrunk = Object.keys(was || {}).filter(function (key) { return (now[key] || 0) < was[key]; })
      .map(function (key) { return key + ' ' + was[key] + '→' + (now[key] || 0); });
    assert.deepEqual(shrunk, [], label + '缩水：' + shrunk.join('、'));
  };
  check('轨道', byTrack, baseline.byTrack);
  check('难度', byLevel, baseline.byLevel);
  check('数据包', byPack, baseline.byPack);

  assert.ok(TASKS.length >= baseline.tasks, '总题数不能少于基线：' + TASKS.length + ' < ' + baseline.tasks);
  assert.ok(PACK_IDS.length >= baseline.packs, '数据包数量不能少于基线：' + PACK_IDS.length + ' < ' + baseline.packs);
});
