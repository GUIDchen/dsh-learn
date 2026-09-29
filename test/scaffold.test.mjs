// 项目书（scaffold）：按岗位要求生成"可交付"的说明书——硬要求 → 命令 → 题 → 完成标准。
// 边界也一起测：不编经历、没有硬要求时如实说、命令必须来自题库参考答案。
import test from 'node:test';
import assert from 'node:assert/strict';

const { buildScaffold, firstCommand, SCAFFOLD_FILES } = await import('../src/core/scaffold.mjs');
const { TASKS } = await import('../src/core/tasks.mjs');

const AT = '2026-04-01T09:00:00.000Z';

function jobWith(mustHave, extra) {
  return Object.assign({
    id: 'j-scaffold', company: '某某科技', position: '高级运维工程师', url: 'https://example.com/jd', status: 'todo',
    analysis: Object.assign({ tasks: TASKS.slice(0, 10).map(function (task) { return task.id; }), points: ['k8s.workload'], mustHave: mustHave, niceToHave: [] }, extra || {})
  }, {});
}

test('项目书：每条硬要求都要有命令、题号与完成标准', function () {
  const job = jobWith([
    { text: '熟悉 Linux 与 Shell', evidence: '熟悉' },
    { text: '熟悉 Docker 与 Kubernetes 滚动发布', evidence: '熟悉' }
  ]);
  const records = [{ taskId: TASKS[0].id, score: 100, at: AT }];
  const scaffold = buildScaffold(job, TASKS, records, { project: 'demo' });
  assert.equal(scaffold.deliverables.length, 2);
  scaffold.deliverables.forEach(function (row) {
    assert.ok(row.requirement && row.doneWhen, '要有要求与完成标准');
    assert.ok(row.tasks.length > 0, '要挂上题：' + JSON.stringify(row));
    assert.ok(row.commands.length > 0, '要有命令：' + JSON.stringify(row));
  });
  assert.ok(scaffold.commands.length > 0, '要有总命令清单');
  assert.equal(new Set(scaffold.commands).size, scaffold.commands.length, '命令不能重复');
  assert.equal(scaffold.milestones.length, 3, '三个里程碑');
  assert.ok(scaffold.missingTasks.length > 0, '要有待练清单');
  assert.equal(scaffold.tasks.filter(function (id) { return scaffold.missingTasks.indexOf(id) > -1; }).length + (scaffold.tasks.length - scaffold.missingTasks.length), scaffold.tasks.length);
});

test('项目书：文件正文三份都要有，且写清"不替你写代码/不编经历"', function () {
  const scaffold = buildScaffold(jobWith([{ text: '熟悉 Docker 与 Kubernetes 滚动发布', evidence: '熟悉' }]), TASKS, [], { project: 'demo' });
  assert.deepEqual(SCAFFOLD_FILES, ['项目书.md', 'checklist.md', 'notes/命令清单.md']);
  assert.ok(scaffold.book.indexOf('# 项目书') > -1);
  assert.ok(scaffold.book.indexOf('不替你写代码') > -1, '边界要写进项目书');
  assert.ok(scaffold.book.indexOf('没有替你加任何经历') > -1, '简历措辞那段要写明边界');
  assert.ok(scaffold.book.indexOf('## 二、里程碑') > -1);
  assert.ok(scaffold.book.indexOf('## 三、怎么自检') > -1);
  assert.ok(scaffold.checklist.indexOf('- [ ] 命令都跑过一遍') > -1, '验收清单要可勾选');
  assert.ok(scaffold.commandSheet.indexOf('# 命令清单') > -1);
  // 命令清单里的命令必须真的来自题库参考答案（不能凭空造）
  const samples = TASKS.map(function (task) { return String(task.sample || ''); }).join(String.fromCharCode(10));
  scaffold.commands.slice(0, 5).forEach(function (cmd) {
    assert.ok(samples.indexOf(cmd.slice(0, 20)) > -1, '命令要来自题库：' + cmd);
  });
});

test('项目书：没有硬要求时如实说明，不编交付项', function () {
  const bare = buildScaffold({ id: 'j2', company: 'A', position: 'B', analysis: { tasks: [] } }, TASKS, [], {});
  assert.equal(bare.deliverables.length, 0);
  assert.ok(bare.book.indexOf('没有硬要求') > -1, bare.book);
  assert.ok(bare.checklist.indexOf('先把 JD 存进记录') > -1, bare.checklist);
  assert.equal(bare.commands.length, 0);
});

test('firstCommand：从参考答案里取第一条可执行命令，跳过注释与空行', function () {
  assert.equal(firstCommand('# 先看内核\nuname -s'), 'uname -s');
  assert.equal(firstCommand('\n\ndocker ps -a'), 'docker ps -a');
  assert.equal(firstCommand('说明文字：先装好 docker'), '');
  assert.equal(firstCommand(''), '');
});
