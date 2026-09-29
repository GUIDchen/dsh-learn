// 文字理解与识图能力的护栏：结构化分档、证据可查、能力矩阵如实报告。
import test from 'node:test';
import assert from 'node:assert/strict';

const { understandText, summarizeUnderstanding } = await import('../src/core/understand.mjs');
const { ocrCapabilities } = await import('../src/core/ocr.mjs');

const JD = [
  '某某科技 招聘 高级运维工程师',
  '',
  '岗位职责',
  '负责 Kubernetes 集群的稳定运行与滚动发布',
  '负责 Prometheus 告警规则与容量规划',
  '',
  '任职要求',
  '熟悉 Linux 与 Shell，5 年以上经验',
  '掌握 Python 或 Go 中至少一种',
  '',
  '加分项',
  '了解 Terraform 与 ArgoCD',
  '有大规模集群经验优先'
].join(String.fromCharCode(10));

test('文字理解：岗位描述被读成结构化信息（公司/岗位/级别/硬要求/加分项/技术栈）', function () {
  const u = understandText(JD);
  assert.equal(u.kind, 'jd');
  assert.equal(u.company, '某某科技', '第一行的「公司 招聘 岗位」要拆开：' + u.company);
  assert.equal(u.position, '高级运维工程师');
  assert.equal(u.seniority, '高级');
  assert.equal(u.years, 5, '要读得出年数：' + u.years);
  assert.equal(u.stack.indexOf('kubernetes') > -1, true, '技术栈要认出 kubernetes');
  assert.equal(u.stack.indexOf('terraform') > -1, true);
  assert.ok(u.points.length > 0, '要挂上知识点');
  assert.ok(u.tasks.length > 0, '要给出可练题');
  assert.ok(u.responsibilities.length >= 2, '职责段落要单独拿出来');
});

test('文字理解：硬要求与加分项分档，且每条都带判定依据；小标题不参与分档', function () {
  const u = understandText(JD);
  const mustTexts = u.mustHave.map(function (row) { return row.text; });
  assert.ok(mustTexts.some(function (line) { return line.indexOf('熟悉 Linux') > -1; }), JSON.stringify(mustTexts));
  assert.ok(mustTexts.some(function (line) { return line.indexOf('掌握 Python') > -1; }));
  assert.equal(mustTexts.some(function (line) { return line === '任职要求'; }), false, '小标题不该被当成一条要求');
  assert.ok(u.niceToHave.some(function (row) { return row.text.indexOf('Terraform') > -1; }));
  assert.ok(u.niceToHave.some(function (row) { return row.text.indexOf('优先') > -1; }));
  u.mustHave.concat(u.niceToHave).forEach(function (row) {
    assert.ok(row.evidence && row.evidence.length, '每条都要给依据：' + JSON.stringify(row));
  });
  assert.ok(u.why.length >= 3, 'why 里要能解释分类/公司/岗位/级别的来源');
});

test('文字理解：不是 JD 的文本要如实分类（文档 / 笔记）', function () {
  const doc = understandText('docker run -d --name web nginx' + String.fromCharCode(10) + 'kubectl get pods -A');
  assert.equal(doc.kind, 'doc', '有命令的当文档：' + doc.kind);
  const notes = understandText('今天看了下 K8s 的滚动发布，感觉还要再练练');
  assert.equal(notes.kind, 'notes', '随手笔记就归笔记：' + notes.kind);
  assert.equal(notes.mustHave.length, 0);
  assert.ok(summarizeUnderstanding(notes).indexOf('随手笔记') > -1, '摘要要说清这是什么');
});

test('识图能力矩阵：每个引擎都要说清可用性与开启方式，未安装时不能假装能用', function () {
  const caps = ocrCapabilities({ home: '/tmp/dsh-ocr-cap-test' });
  assert.ok(caps.platform, '要报出平台');
  assert.equal(caps.engines.length, 3, '三个引擎：自定义 / Vision / tesseract');
  caps.engines.forEach(function (row) {
    assert.ok(row.id && row.name, '引擎要有名字');
    assert.equal(typeof row.available, 'boolean');
    assert.ok(row.detail && row.detail.length, row.id + ' 要说清当前状态');
    assert.ok(row.enable && row.enable.length, row.id + ' 要说清怎么开启');
  });
  if (caps.chosen) {
    const picked = caps.engines.filter(function (row) { return row.id === caps.chosen; })[0];
    assert.equal(picked.available, true, '选中的引擎必须是可用的：' + caps.chosen);
  } else {
    assert.ok(caps.advice.join(' ').indexOf('不能识图') > -1, '一个都用不了时要如实说：' + caps.advice.join('；'));
  }
  assert.ok(caps.formats.indexOf('png') > -1 && caps.limits.maxBytes > 0);
});

test('岗位名抽取：分段小标题与职责动词都不能被当成岗位名', function () {
  // 回归：这一条把材料标题污染成「某某科技 · 职责」（原生自检抓到的）
  const u1 = understandText(['某某科技 招聘 高级运维工程师', '岗位职责', '负责 Kubernetes 集群稳定运行', '任职要求', '熟悉 Linux'].join(String.fromCharCode(10)));
  assert.equal(u1.position, '高级运维工程师', '第一行的公司+招聘+岗位要拆开：' + JSON.stringify(u1.position));
  assert.equal(u1.company, '某某科技');
  const u2 = understandText(['岗位：SRE 工程师', '任职要求', '熟悉 Prometheus'].join(String.fromCharCode(10)));
  assert.equal(u2.position, 'SRE 工程师', '带冒号的标签要取冒号后面的：' + JSON.stringify(u2.position));
  const u3 = understandText(['岗位职责', '负责集群运维', '任职要求', '熟悉 Linux'].join(String.fromCharCode(10)));
  assert.equal(u3.position, '', '只有分段头时不能瞎猜岗位名：' + JSON.stringify(u3.position));
  const u4 = understandText(['高级运维工程师', '岗位职责', '负责集群运维'].join(String.fromCharCode(10)));
  assert.equal(u4.position, '高级运维工程师', '像标题的第一行要认：' + JSON.stringify(u4.position));
  // 跨行的岗位名要折成一行（否则材料标题会带出一整段正文）
  assert.equal(u1.position.indexOf(String.fromCharCode(10)), -1, '岗位名不能带换行');
});