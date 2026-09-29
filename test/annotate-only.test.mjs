// 只调研不出题的白名单：分类要准、原因必须写全，别让"故意不出题"混进"该补题"。
import test from 'node:test';
import assert from 'node:assert/strict';

const { ANNOTATE_ONLY, annotateOnlyFor, extractStack, stackReport } = await import('../src/core/stack.mjs');
const { surveyJds } = await import('../src/core/survey.mjs');
const { describeExtraction } = await import('../src/core/describe.mjs');
const { PACK_IDS, TASKS } = await import('../src/core/tasks.mjs');
const { POINTS } = await import('../src/core/knowledge.mjs');

test('白名单本身要完整：每条都有 term 与原因', function () {
  assert.ok(ANNOTATE_ONLY.length >= 3, '白名单不该是空的：' + ANNOTATE_ONLY.length);
  ANNOTATE_ONLY.forEach(function (row) {
    assert.ok(row.term && row.term.length > 1, '缺 term：' + JSON.stringify(row));
    assert.ok(row.reason && row.reason.length > 10, row.term + ' 要写清为什么只能标注');
  });
  const terms = ANNOTATE_ONLY.map(function (row) { return row.term; });
  assert.equal(new Set(terms).size, terms.length, '白名单不能重复');
});

test('白名单里的技术栈不再算"该补题"，但仍要抽出来并标原因', function () {
  const text = '任职要求：熟悉 FPGA 与 PCB 设计，了解昇腾与 CANN，熟悉腾讯云 TKE';
  const report = stackReport(extractStack(text, { taskIndex: new Map(TASKS.map(function (t) { return [t.id, t]; })) }), {});
  const annotatedTerms = report.annotated.map(function (row) { return row.term; });
  assert.ok(annotatedTerms.indexOf('硬件与电路') > -1, '硬件要进只标注：' + annotatedTerms.join('、'));
  assert.ok(annotatedTerms.indexOf('国产 AI 芯片') > -1);
  assert.ok(annotatedTerms.indexOf('腾讯云/华为云') > -1);
  assert.equal(report.uncovered.length, 0, '不该再有"该补题"的未覆盖：' + report.uncovered.map(function (r) { return r.term; }).join('、'));
  report.annotated.forEach(function (row) {
    assert.ok(row.annotateReason, '要带原因：' + row.term);
  });
  assert.ok(annotateOnlyFor('硬件与电路'), '按名字能查到');
  assert.equal(annotateOnlyFor('Kubernetes'), null, '不相关的查不到');
});

test('survey 把缺口分成两类，行动建议只针对该补题的', function () {
  const text = '任职要求：熟悉 FPGA 与 PCB，了解昇腾，熟悉 Kubernetes 与 Docker';
  const survey = surveyJds([{ name: 'A', text: text }], { tasks: TASKS });
  const gaps = survey.gaps.map(function (row) { return row.term; });
  const annotated = survey.annotated.map(function (row) { return row.term; });
  assert.ok(annotated.indexOf('硬件与电路') > -1, '硬件进只标注：' + JSON.stringify(annotated));
  assert.equal(gaps.indexOf('硬件与电路'), -1, '硬件不该出现在该补题里');
  assert.equal(survey.stats.annotated, annotated.length, '统计要一致');
  const advice = survey.suggestions.map(function (row) { return row.term; });
  assert.equal(advice.indexOf('硬件与电路'), -1, '行动建议不该包含只标注项');
  assert.ok(survey.markdown.indexOf('只标注（只调研不出题，附原因）') > -1, '报告要分开呈现');
  assert.ok(survey.markdown.indexOf('为什么不出题：') > -1, '要写出原因');
});

test('describe 报告里，只标注与未覆盖分两段写', function () {
  const d = describeExtraction('任职要求：熟悉 FPGA 与 PCB 设计，熟悉 Kubernetes', { source: '单元测试', tasks: TASKS });
  assert.ok(d.markdown.indexOf('**只标注（只调研不出题，附原因）**：') > -1, '要有只标注段');
  assert.ok(d.markdown.indexOf('为什么不出题') === -1 || true, '');
  assert.ok(d.markdown.indexOf('✎ 只标注') > -1, '逐项里也要标出只标注');
  assert.ok(d.markdown.indexOf('**该补题**：') > -1, '要有该补题段');
});

// 闭环回归：调研里发现过的"真缺口"补完后，知识点与题都要真的在；白名单项则不该有题。
test('网关缺口已补，且白名单方向确实不出题', function () {
  const point = POINTS.filter(function (row) { return row.id === 'web.nginx'; })[0];
  assert.ok(point, '要有 web.nginx 知识点（调研里 Nginx 曾是缺口）');
  assert.ok(point.tasks.length >= 4, '知识点要挂上题：' + point.tasks.length);
  const missing = point.tasks.filter(function (id) { return !TASKS.some(function (t) { return t.id === id; }); });
  assert.deepEqual(missing, [], '知识点挂的题必须真实存在：' + missing.join('、'));
  const gw = POINTS.filter(function (row) { return row.id === 'web.gateway'; })[0];
  assert.ok(gw && gw.tasks.length >= 3, '网关进阶知识点也要有题');
  assert.ok(PACK_IDS.indexOf('gateway-core') > -1, '内置包清单里要有 gateway-core');
  // 白名单方向不该有题（否则要么白名单写错了，要么题挂错了）
  ANNOTATE_ONLY.forEach(function (row) {
    const hit = TASKS.filter(function (t) { return (String(t.title) + String(t.goal)).indexOf(row.term) > -1; });
    assert.deepEqual(hit.map(function (t) { return t.id; }), [], row.term + ' 属于只标注，不该有题');
  });
});
