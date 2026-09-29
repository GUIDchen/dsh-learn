// 平台变体的不变式：变体必须真的和基础答案不同，且在"自己的平台"满分、"别的平台"拿不到满分。
// 加变体题最容易犯的两个错：变体和基础几乎一样（等于没区分），或者把答案写反了（mac 的答案在 linux 上也满分）。
// 注意本题库的写法有两种：darwin/linux 成对，或"基础 = mac/linux，win32 单独覆盖"（如 git.autocrlf-cross-platform）。
// 所以这里不要求平台数 ≥ 2，只要求**每个变体都比基础更具体**，并且换到别的平台判不过。
import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS } from '../src/core/tasks.mjs';
import { judge } from '../src/core/judge.mjs';
import { EXPECT } from './expected.mjs';

const VARIANT_TASKS = TASKS.filter(function (task) {
  return task.variants && Object.keys(task.variants).length;
});

test('每道变体题都有参考答案，且与基础答案确实不同', function () {
  assert.ok(VARIANT_TASKS.length >= EXPECT.variants, '变体题数应不少于 ' + EXPECT.variants);
  VARIANT_TASKS.forEach(function (task) {
    const platforms = Object.keys(task.variants);
    assert.ok(platforms.length >= 1, task.id + ' 没有平台变体');
    platforms.forEach(function (platform) {
      const variant = task.variants[platform];
      assert.ok(variant.sample, task.id + ' 的 ' + platform + ' 变体缺少参考答案（sample）');
      assert.ok(variant.require && variant.require.length, task.id + ' 的 ' + platform + ' 变体缺少要素');
      assert.notDeepEqual(
        variant.require,
        task.require,
        task.id + ' 的 ' + platform + ' 变体要素与基础一样——变体没有存在意义'
      );
    });
  });
});

// 只在"题目声明过的平台"之间比较：未声明的平台走基础口径（resolveTask 的兜底），
// 这是有意的设计（如 darwin/linux 成对的题在 win32 上按基础答案判），不算数据错误。
test('变体答案在自己平台满分，换到别的平台必须判不过', function () {
  const problems = [];
  VARIANT_TASKS.forEach(function (task) {
    const platforms = Object.keys(task.variants);
    platforms.forEach(function (platform) {
      const sample = task.variants[platform].sample;
      const own = judge(task, sample, platform);
      if (own.score !== 100) {
        problems.push(task.id + ' 的 ' + platform + ' 参考答案在自己平台上只有 ' + own.score + ' 分（应为 100）');
      }
      platforms.forEach(function (other) {
        if (other === platform) return;
        const cross = judge(task, sample, other);
        if (cross.score === 100) {
          problems.push(task.id + ' 的 ' + platform + ' 答案在 ' + other + ' 平台上也是满分——两个变体没区分度');
        }
      });
    });
  });
  assert.deepEqual(problems, [], problems.join('\n'));
});
