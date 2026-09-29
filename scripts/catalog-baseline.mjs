// 题库基线：把"当前有哪些题"钉成一份独立的数据文件。
//
// 为什么需要它：test/expected.mjs 的期望值全部从运行时题库推导，所以
// "题库只该变大不该变小" 这句话实际上**没人执行**——一份包文件被误删/被半截写入后，
// 断言照样通过（TASKS.length 变多少，EXPECT.tasks 就跟着变多少）。
// 这个项目已经因为"静默丢数据"吃过两次亏（项目元数据被覆盖、完成报告被插入两份）。
//
// 用法：
//   node scripts/catalog-baseline.mjs            只看差异（不改文件）
//   node scripts/catalog-baseline.mjs --check    差异不为空就以退出码 1 结束（给 CI 用）
//   node scripts/catalog-baseline.mjs --update   明确更新基线（删题、改题号时必须手动做一次）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TASKS, TRACKS, PACK_IDS } from '../src/core/tasks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'docs/catalog-baseline.json');

function snapshot() {
  const byTrack = {};
  const byLevel = { easy: 0, medium: 0, hard: 0, unlabeled: 0 };
  const byPack = {};
  TASKS.forEach(function (task) {
    byTrack[task.track] = (byTrack[task.track] || 0) + 1;
    const level = task.level || 'unlabeled';
    byLevel[level] = (byLevel[level] || 0) + 1;
    byPack[task.packId] = (byPack[task.packId] || 0) + 1;
  });
  return {
    generatedAt: new Date().toISOString(),
    tasks: TASKS.length,
    tracks: TRACKS.length,
    packs: PACK_IDS.length,
    byTrack: byTrack,
    byLevel: byLevel,
    byPack: byPack,
    ids: TASKS.map(function (task) { return task.id; }).sort()
  };
}

function readBaseline() {
  if (!existsSync(FILE)) return null;
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch (err) { return null; }
}

const current = snapshot();
const args = process.argv.slice(2);
if (args.indexOf('--update') > -1) {
  writeFileSync(FILE, JSON.stringify(current, null, 2) + String.fromCharCode(10));
  console.log('已更新题库基线：' + current.tasks + ' 题 / ' + Object.keys(current.byTrack).length + ' 条轨道（docs/catalog-baseline.json）');
  process.exit(0);
}

const baseline = readBaseline();
if (!baseline) {
  console.log('还没有基线文件。确认当前题库是对的，再跑：node scripts/catalog-baseline.mjs --update');
  process.exit(args.indexOf('--check') > -1 ? 1 : 0);
}

const have = new Set(current.ids);
const missing = (baseline.ids || []).filter(function (id) { return !have.has(id); });
const added = current.ids.filter(function (id) { return (baseline.ids || []).indexOf(id) === -1; });
const shrunkTracks = Object.keys(baseline.byTrack || {}).filter(function (track) {
  return (current.byTrack[track] || 0) < baseline.byTrack[track];
}).map(function (track) {
  return track + ' ' + baseline.byTrack[track] + ' → ' + (current.byTrack[track] || 0);
});

console.log('基线：' + baseline.tasks + ' 题（' + String(baseline.generatedAt).slice(0, 10) + '）　当前：' + current.tasks + ' 题');
if (added.length) console.log('新增 ' + added.length + ' 题：' + added.slice(0, 5).join('、') + (added.length > 5 ? ' …' : ''));
if (missing.length) console.log('**少了 ' + missing.length + ' 题**：' + missing.slice(0, 5).join('、') + (missing.length > 5 ? ' …' : ''));
if (shrunkTracks.length) console.log('**轨道缩水**：' + shrunkTracks.join('、'));
if (!missing.length && !shrunkTracks.length) {
  console.log('没有题被删（基线是下限：只加题不需要动它）');
  process.exit(0);
}
console.log('如果这是有意的（改名、删题、拆包），确认后跑：node scripts/catalog-baseline.mjs --update');
process.exit(1);
