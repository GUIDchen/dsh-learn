// 岗位描述 → 练习清单：JD 没有命令，所以它生成的是"计划"而不是新题；每条都要有出处。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { buildJdPlan } = await import('../src/core/jdplan.mjs');
const { buildProjectIndex, createProject, writeProjectFile } = await import('../src/core/project.mjs');

test('JD 计划：技术点映射到已有题，每条带原文依据与理由', function () {
  const text = ['岗位职责：负责视觉算法开发', '任职要求：', '- 熟悉 YOLO 目标检测与训练调参', '- 熟悉 Python 与 Linux 环境', '- 有 Docker 部署经验'].join(String.fromCharCode(10));
  const plan = buildJdPlan({ name: 'demo', sources: [{ index: 1, source: 'demo/jd.txt', text: text }] }, { max: 5 });
  assert.equal(plan.kind, 'plan', '计划草案要标 kind=plan（不可入总题库）');
  assert.equal(plan.sources, 1);
  assert.ok(plan.points.length > 0, '要命中知识点：' + JSON.stringify(plan.points));
  assert.ok(plan.total > 0, '要能映射出可练题');
  assert.ok(plan.nextUp.length > 0 && plan.nextUp.length <= 5, '先练清单不超过 max');
  plan.nextUp.forEach(function (row) {
    assert.ok(row.taskId, '要有题号');
    assert.ok(row.reason && row.reason.length > 6, '要有理由：' + JSON.stringify(row));
  });
  const withEvidence = plan.nextUp.filter(function (row) { return row.evidence; });
  assert.ok(withEvidence.length > 0, '至少有一条能给出原文依据');
  assert.ok(plan.markdown.indexOf('| # | 题号 | 方向 | 难度 | 为什么练它 | 原文依据 |') > -1, '清单要成表');
  assert.ok(plan.command.indexOf('drill --tasks=') > -1, '要给出开练命令');
});

test('JD 计划：没有技术点的文本要如实说明，不硬凑', function () {
  const plan = buildJdPlan({ name: 'sales', sources: [{ index: 1, source: 'x.txt', text: '岗位职责：负责门店销售与客户接待，要求普通话标准' }] }, {});
  assert.equal(plan.total, 0, '不该硬凑出题：' + plan.total);
  assert.ok(plan.markdown.indexOf('没有命中任何知识点') > -1, '要如实说明：' + plan.markdown.slice(0, 80));
});

test('项目索引把计划草案标成 plan 并带上清单题号（界面据此隐藏加入总题库）', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-jdplan-home-'));
  process.env.DSH_LEARN_HOME = home;
  createProject('jdproj', {});
  const plan = { kind: 'plan', id: 'jd-plan-jdproj', project: 'jdproj', rows: [{ taskId: 'go.env-check' }, { taskId: 'go.doc-preview' }], nextUp: [{ taskId: 'go.env-check' }], markdown: '# 计划' };
  writeProjectFile('jdproj', 'drafts/jd-plan-jdproj.json', JSON.stringify(plan));
  const index = buildProjectIndex('jdproj');
  const row = (index.drafts || []).filter(function (item) { return item.packId === 'jd-plan-jdproj'; })[0];
  assert.ok(row, '索引里要有这份草案');
  assert.equal(row.kind, 'plan', '要标成 plan');
  assert.deepEqual(row.planTasks, ['go.env-check'], '要带清单题号');
  assert.equal(row.tasks.length, 2, '计划里的题也要进索引清单');
  rmSync(home, { recursive: true, force: true });
});
