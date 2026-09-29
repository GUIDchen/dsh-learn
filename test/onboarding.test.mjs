// 首次运行引导：六步判定、下一步命令、以及「只读本地事实」的口径。
import test from 'node:test';
import assert from 'node:assert/strict';

const { onboardingState, ONBOARDING_STEPS } = await import('../src/core/onboarding.mjs');

test('全新用户：只有平台那步算完成，下一步是练第一道题', function () {
  const state = onboardingState({ records: 0, projects: 0, projectsWithSources: 0, dailyTasks: 0, backupExists: false, platform: 'darwin' });
  assert.equal(state.total, ONBOARDING_STEPS.length);
  assert.equal(state.done, 1);
  assert.equal(state.finished, false);
  assert.equal(state.next.id, 'first-check');
  assert.equal(state.command, 'node src/cli.mjs drill --limit=1', '要给可以直接跑的命令');
  assert.ok(state.markdown.indexOf('现在做第 2 步') > -1);
  assert.ok(state.markdown.indexOf('drill --limit=1') > -1);
});

test('每补齐一项事实，就多完成一步（口径只看本地事实，不猜）', function () {
  // 注意：onboardingState 返回的是**状态**（含 steps/done），不是事实；链条要接在事实对象上
  const facts = { platform: 'darwin', records: 0, projects: 0, projectsWithSources: 0, dailyTasks: 0, backupExists: false };
  assert.equal(onboardingState(facts).done, 1);
  facts.records = 1;
  assert.equal(onboardingState(facts).done, 2);
  facts.projects = 1;
  assert.equal(onboardingState(facts).done, 3);
  facts.projectsWithSources = 1;
  assert.equal(onboardingState(facts).done, 4);
  facts.dailyTasks = 3;
  const withGoal = onboardingState(facts);
  assert.equal(withGoal.done, 5);
  assert.equal(withGoal.next.id, 'backup');
});

test('六步走完：finished 为真、没有 next、markdown 不再催', function () {
  const state = onboardingState({ platform: 'darwin', records: 5, projects: 2, projectsWithSources: 2, dailyTasks: 3, backupExists: true });
  assert.equal(state.finished, true);
  assert.equal(state.next, null);
  assert.equal(state.percent, 100);
  assert.equal(state.command, null);
  assert.ok(state.headline.indexOf('都走过了') > -1);
});

test('每一步都带「为什么」与可跑命令（离线可用，不发请求）', function () {
  ONBOARDING_STEPS.forEach(function (row) {
    assert.ok(row.why && row.why.length > 4, row.id + ' 缺 why');
    assert.ok(row.cli && row.cli.indexOf('node src/cli.mjs') === 0, row.id + ' 的命令要能直接跑：' + row.cli);
  });
});
