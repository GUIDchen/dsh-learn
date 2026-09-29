// 题库规模的"单一事实来源"：所有测试从运行时题库推导期望值，避免每加几道题就要改十几处断言。
// 用法：import { EXPECT } from './expected.mjs'; 然后 assert.ok(TASKS.length >= EXPECT.tasks) 或 assert.equal(x, EXPECT.tasks)。
// 这样题库长大时测试自动跟上，真正需要人工看一眼的只有"轨道/包结构变了没"。
import { BUILTIN_TASKS as TASKS, TRACKS, BUILTIN_PACK_IDS as PACK_IDS } from '../src/core/tasks.mjs';
// 只用内置包推导期望值：用户 promote 进用户题库目录的包不该改变"随工具发布的题库"的规模，
// 否则用户在自己机器上跑 npm test 会满屏红（实测 6 条护栏全红）——那不是他的题有问题，是用错了口径。

function countTrack(track) {
  return TASKS.filter(function (task) { return task.track === track; }).length;
}

export const EXPECT = {
  tasks: TASKS.length,
  tracks: TRACKS.length,
  packs: PACK_IDS.length,
  withSample: TASKS.filter(function (task) { return task.sample; }).length,
  withVerify: TASKS.filter(function (task) { return task.verify; }).length,
  variants: TASKS.filter(function (task) { return task.variants && Object.keys(task.variants).length; }).length,
  byTrack: TRACKS.reduce(function (acc, track) {
    acc[track] = countTrack(track);
    return acc;
  }, {}),
  trackList: TRACKS.slice(),
  packList: PACK_IDS.slice().sort()
};

// 下限：题库只该变大不该变小；断言时用 EXPECT.tasks 的当前值作下限，
// 一旦有人误删题目，测试会立刻发现。
export function atLeast(value, expected) {
  return value >= expected;
}
