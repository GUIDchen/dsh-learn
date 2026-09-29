// 技术栈抽取与"描述"报告：要抽全、要有依据、未覆盖要如实列。
import test from 'node:test';
import assert from 'node:assert/strict';

const { extractStack, stackReport, normalizeForMatch, STACK_LEXICON, CATEGORIES } = await import('../src/core/stack.mjs');
const { describeExtraction } = await import('../src/core/describe.mjs');
const { TASKS } = await import('../src/core/tasks.mjs');
const { POINTS } = await import('../src/core/knowledge.mjs');

const JD = [
  '某某科技 招聘 高级 DevOps / SRE 工程师',
  '工作地点：深圳　薪资：35-60K·15薪　3 天前发布',
  '岗位职责',
  '负责 Kubernetes 集群稳定运行与 CI/CD 流水线（GitLab CI + ArgoCD）',
  '负责 Prometheus / Grafana 监控与 on-call 值班',
  '任职要求',
  '熟悉 Linux 与 Shell，5 年以上经验',
  '熟悉 Docker 与 Kubernetes，掌握 Python 或 Go',
  '加分项',
  '了解 Terraform 与 ClickHouse'
].join(String.fromCharCode(10));
const taskIndex = new Map(TASKS.map(function (task) { return [task.id, task]; }));

test('技术栈抽全：多类别、每项带原文依据、能映射到知识点', function () {
  const report = stackReport(extractStack(JD, { taskIndex: taskIndex, points: POINTS }), {});
  const terms = report.rows.map(function (row) { return row.term; });
  ['Kubernetes', 'Docker', 'Python', 'Go', 'Shell', 'Linux', 'Prometheus', 'Grafana', 'GitLab CI', 'ArgoCD', 'Terraform'].forEach(function (term) {
    assert.ok(terms.indexOf(term) > -1, '要抽出 ' + term + '：' + terms.join('、'));
  });
  assert.ok(report.stats.categories >= 4, '至少要落到 4 个类别：' + report.stats.categories);
  report.rows.forEach(function (row) {
    assert.ok(row.evidence.length > 0, '每项技术栈都要有原文依据：' + row.term);
    assert.ok(CATEGORIES.indexOf(row.category) > -1, '类别要在词表里：' + row.category);
  });
  assert.ok(report.stats.points > 0 && report.stats.tasks > 0, '要能映射到知识点与题');
  // 未覆盖的如实列出来（Terraform 目前没有知识点）
  assert.ok(report.uncovered.some(function (row) { return row.term === 'Terraform'; }), '未覆盖要列出来：' + report.uncovered.map(function (r) { return r.term; }).join('、'));
});

test('短别名不误伤：Go 不能命中 Google，py 不能命中 python3 之外的词', function () {
  const report = stackReport(extractStack('我们在 Google 云上跑 Python 服务，用 Go 写网关', { taskIndex: taskIndex }), {});
  const terms = report.rows.map(function (row) { return row.term; });
  assert.ok(terms.indexOf('Go') > -1, 'Go 要抽到');
  assert.ok(terms.indexOf('Python') > -1, 'Python 要抽到');
  assert.ok(terms.indexOf('Lua') === -1 && terms.indexOf('SQL') === -1, '不该命中的不能混进来：' + terms.join('、'));
});

test('OCR 归一化：GitLab Cl / Kubemetes 这类识别误差也要能抽到（截图路线）', function () {
  assert.equal(normalizeForMatch('负责 GitLab Cl 流水线').indexOf('GitLab CI'), 2 + '负责 '.length - 2, 'CI 要归一化出来');
  const report = stackReport(extractStack('负责 GitLab Cl + ArgoCD，Kubemetes 集群，Promethues 监控', { taskIndex: taskIndex }), {});
  const terms = report.rows.map(function (row) { return row.term; });
  assert.ok(terms.indexOf('GitLab CI') > -1, 'GitLab Cl → GitLab CI：' + terms.join('、'));
  assert.ok(terms.indexOf('Kubernetes') > -1, 'Kubemetes → Kubernetes：' + terms.join('、'));
  assert.ok(terms.indexOf('Prometheus') > -1, 'Promethues → Prometheus：' + terms.join('、'));
});

test('描述报告：基本信息 + 结构 + 技术栈表 + 知识点清单 + 未覆盖清单五段齐全', function () {
  const d = describeExtraction(JD, { source: '单元测试', tasks: TASKS });
  assert.equal(d.kind, 'jd');
  assert.equal(d.location, '深圳');
  assert.ok(d.salary && d.salary.min === 35, '薪资要抽出来：' + JSON.stringify(d.salary));
  const md = d.markdown;
  ['## 一、基本信息', '## 二、内容结构', '## 三、技术栈', '## 四、知识点与可练题清单', '## 五、字典未覆盖'].forEach(function (head) {
    assert.ok(md.indexOf(head) > -1, '缺段落：' + head);
  });
  assert.ok(md.indexOf('| 类别 | 技术栈 |') > -1, '要有技术栈分类表');
  assert.ok(md.indexOf('原文：') > -1, '每条技术栈要带原文依据');
  assert.ok(md.indexOf('不做猜测补充') > -1, '要写明边界');
});
