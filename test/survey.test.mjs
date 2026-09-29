// 多岗位调研：热度、通用技能、缺口、建议都要能算对，且不虚报覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';

const { surveyGroups, surveyJds } = await import('../src/core/survey.mjs');
const { TASKS } = await import('../src/core/tasks.mjs');

const A = ['某某科技 招聘 后端工程师', '任职要求', '熟悉 Go 与 Kubernetes', '熟悉 PostgreSQL', '熟悉 Linux'].join(String.fromCharCode(10));
const B = ['某厂 招聘 运维工程师', '任职要求', '熟悉 Kubernetes 与 Docker', '熟悉 Linux 与 Shell'].join(String.fromCharCode(10));
const C = ['某公司 招聘 数据工程师', '任职要求', '熟悉 Python 与 Kubernetes', '了解 ClickHouse'].join(String.fromCharCode(10));

test('多岗位调研：热度按出现岗位数算，通用技能取 ≥50%', function () {
  const s = surveyJds([{ name: 'A', text: A }, { name: 'B', text: B }, { name: 'C', text: C }], { tasks: TASKS });
  assert.equal(s.stats.jobs, 3);
  const k8s = s.terms.filter(function (row) { return row.term === 'Kubernetes'; })[0];
  assert.equal(k8s.jobs, 3, 'Kubernetes 三份都提到');
  assert.equal(k8s.share, 100);
  const go = s.terms.filter(function (row) { return row.term === 'Go'; })[0];
  assert.equal(go.jobs, 1);
  assert.ok(s.common.every(function (row) { return row.share >= 50; }), '通用技能必须 ≥50%');
  assert.ok(s.common.some(function (row) { return row.term === 'Kubernetes'; }));
});

test('多岗位调研：缺口与建议要指向没覆盖的技术栈', function () {
  const s = surveyJds([{ name: 'C', text: C }], { tasks: TASKS });
  const gaps = s.gaps.map(function (row) { return row.term; });
  assert.ok(gaps.indexOf('ClickHouse') > -1, 'ClickHouse 应当是缺口（字典没有对应题）：' + gaps.join('、'));
  assert.ok(s.suggestions.some(function (row) { return row.kind === 'lexicon-and-tasks' && row.term === 'ClickHouse'; }), '要给出补词库/补题建议');
  assert.ok(s.suggestions.some(function (row) { return row.kind === 'priority-practice'; }), '要有优先练的建议');
});

test('多岗位调研：来源与逐份摘要要如实反映输入', function () {
  const s = surveyJds([{ name: 'A 岗位', text: A }, { name: 'B 岗位', text: B }], { tasks: TASKS });
  assert.equal(s.perJob.length, 2);
  assert.equal(s.perJob[0].name, 'A 岗位');
  assert.ok(s.perJob.every(function (row) { return row.terms.length > 0; }), '每份都要抽到技术栈');
  assert.ok(s.markdown.indexOf('## 一、需求热度排行') > -1);
  assert.ok(s.markdown.indexOf('## 三、缺口') > -1);
  assert.ok(s.markdown.indexOf('不做猜测') > -1, '要写明边界');
  // 空输入不该崩
  const empty = surveyJds([], { tasks: TASKS });
  assert.equal(empty.stats.jobs, 0);
  assert.ok(empty.markdown.indexOf('0 份') > -1);
});
// 分方向调研：矩阵要按方向分别计数，共性与专有要分得清。

test('分方向调研：矩阵按方向计数，共性/专有分类正确', function () {
  const groups = [
    { name: '视觉', items: [
      { name: 'v1', text: '任职要求：熟悉 YOLO 与 OpenCV，熟悉 Python 和 Docker' },
      { name: 'v2', text: '任职要求：熟悉 YOLO 与图像处理，熟悉 Python' }
    ] },
    { name: '运维', items: [
      { name: 'o1', text: '任职要求：熟悉 Kubernetes 与 Docker，熟悉 Python' },
      { name: 'o2', text: '任职要求：熟悉 Kubernetes 与 Prometheus' }
    ] },
    { name: '嵌入式', items: [
      { name: 'e1', text: '任职要求：熟悉 RTOS 与 C 语言，熟悉 Docker' }
    ] }
  ];
  const result = surveyGroups(groups, { tasks: TASKS });
  assert.equal(result.stats.groups, 3);
  assert.equal(result.stats.jobs, 5, '五份岗位：' + result.stats.jobs);
  const row = result.matrix.filter(function (item) { return item.term === 'Docker'; })[0];
  assert.ok(row, 'Docker 应该在矩阵里');
  assert.equal(row.byGroup['视觉'], 1);
  assert.equal(row.byGroup['运维'], 1);
  assert.equal(row.byGroup['嵌入式'], 1);
  assert.equal(row.total, 3);
  const yolo = result.matrix.filter(function (item) { return item.term === '视觉'; })[0];
  assert.ok(yolo, '视觉应该被抽到');
  assert.equal(yolo.byGroup['视觉'], 2, '两份视觉岗位都提到');
  assert.equal(yolo.byGroup['运维'], undefined, '运维方向不该算进去');
  // 专有：只在单一方向出现（视觉出现在视觉方向 2 次 → 只 1 个方向 → 专有）
  const uniqueTerms = result.unique.map(function (item) { return item.term; });
  assert.ok(uniqueTerms.indexOf('视觉') > -1, '视觉应是方向专有：' + uniqueTerms.join('、'));
  // 共性：Docker 三个方向都有 → 必进共性
  const sharedTerms = result.shared.map(function (item) { return item.term; });
  assert.ok(sharedTerms.indexOf('Docker') > -1, 'Docker 应是跨方向共性：' + sharedTerms.join('、'));
  assert.ok(result.markdown.indexOf('| 技术栈 | 类别 | 视觉 | 运维 | 嵌入式 |') > -1, '矩阵表头要带方向名');
  assert.ok(result.markdown.indexOf('## 四、逐方向画像') > -1);
});
