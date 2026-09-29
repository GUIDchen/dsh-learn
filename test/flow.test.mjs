// 闭环与简历的护栏：状态从真实数据推出来、匹配度按已通过题算、简历只写真实做过的事。
import test from 'node:test';
import assert from 'node:assert/strict';

const { applicationPack, flowStatus, freshnessRank, matchJobs, recommendJobs, studyPlan, summarizeFlow, STAGES } = await import('../src/core/flow.mjs');
const { buildResume, skillRows, gapTracks } = await import('../src/core/resume.mjs');
const { TASKS } = await import('../src/core/tasks.mjs');

const AT = '2026-03-01T10:00:00.000Z';

function passRecords(count, tasks) {
  return tasks.slice(0, count).map(function (task) {
    return { taskId: task.id, score: 100, verdict: '通过', at: AT, platform: 'darwin' };
  });
}

test('七步闭环：状态与"下一步"都从真实数据推出来', function () {
  const records = passRecords(12, TASKS);
  const empty = flowStatus({ records: [], tasks: TASKS, projects: [], jobs: [] });
  assert.equal(empty.stages.length, 7, '七步');
  assert.equal(empty.stages.map(function (row) { return row.id; }).join(','), STAGES.map(function (row) { return row.id; }).join(','), '顺序固定');
  assert.equal(empty.current, 'learn', '没练过时停在第 1 步');
  assert.ok(empty.stages[0].blocked.indexOf('还没练过') > -1, '要说清为什么卡住');
  assert.ok(empty.nextAction.cli.length > 0, '下一步要给出可执行命令');

  const ready = flowStatus({ records: records, tasks: TASKS, projects: [{ name: 'p', sources: 2 }], jobs: [] });
  assert.equal(ready.stages[0].status, 'done', '12 道通过 → 学习这步算完成');
  assert.equal(ready.stages[1].status, 'done', '有项目 → 第 2 步完成');
  assert.equal(ready.stages[2].status, 'done', '数据够了 → 简历可生成');
  assert.equal(ready.current, 'collect', '卡在第 4 步（还没搜集岗位）');
  assert.ok(summarizeFlow(ready).indexOf('当前：搜集招聘信息') > -1, summarizeFlow(ready));
});

test('岗位匹配：按"这道 JD 能练的题里已通过多少"算，缺的题就是补课清单', function () {
  const records = passRecords(5, TASKS);
  const jdTasks = TASKS.slice(0, 10).map(function (task) { return task.id; });
  const jobs = [{ id: 'j1', company: 'A', position: 'B', status: 'todo', url: 'https://x/y', analysis: { points: ['p1', 'p2'], tasks: jdTasks } }];
  const rows = matchJobs(jobs, TASKS, records);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].coverage, 50, '10 道里过了 5 道 → 覆盖 50%');
  assert.equal(rows[0].covered, 5);
  assert.equal(rows[0].missing.length, 5);
  // 老数据没存硬要求：如实降级成"覆盖 85% + 方向 15%"，并在依据里说明
  assert.ok(rows[0].why.join(' ').indexOf('覆盖 5/10 道') > -1, JSON.stringify(rows[0].why));
  assert.ok(rows[0].why.join(' ').indexOf('没存硬要求') > -1, JSON.stringify(rows[0].why));
  assert.ok(rows[0].match >= 50, '有方向覆盖加成，分数不低于覆盖率：' + rows[0].match);
  // 存了硬要求的岗位：按 55/30/15 加权，并把硬要求那项写进依据
  const withMust = [{ id: 'j3', company: 'A', position: 'B', status: 'todo', analysis: { points: ['p1'], tasks: jdTasks, mustHave: [{ text: '熟悉 Kubernetes 滚动发布', evidence: '熟悉' }] } }];
  const scored = matchJobs(withMust, TASKS, records)[0];
  assert.ok(scored.mustTotal > 0, '硬要求要映射到知识点并挂上题：' + JSON.stringify(scored));
  assert.ok(scored.why.join(' ').indexOf('硬要求对应的题') > -1, JSON.stringify(scored.why));
  assert.notEqual(scored.match, rows[0].match, '有硬要求时权重不同，分数应当不同');
  assert.ok(rows[0].gapTracks.length > 0, '要给出要补的方向');
  // 没分析过 JD 的岗位：不给假匹配度
  const raw = matchJobs([{ id: 'j2', company: 'A', position: 'B', status: 'todo' }], TASKS, records);
  assert.equal(raw[0].match, 0);
  assert.ok(raw[0].why[0].indexOf('还没分析 JD') > -1, raw[0].why[0]);
  // 推荐要能按阈值过滤
  assert.equal(recommendJobs(jobs, TASKS, records, { threshold: 60 }).length, 0);
  assert.equal(recommendJobs(jobs, TASKS, records, { threshold: 40 }).length, 1);
});

test('简历：技能按通过题数排序、亮点带依据、只说真话', function () {
  const records = passRecords(20, TASKS);
  const resume = buildResume(records, TASKS, { projects: [{ name: 'pay-gw', sources: 2, knowledge: 41, tasks: 20 }], now: AT });
  assert.ok(resume.skills.length >= 1, '至少一个方向');
  assert.ok(resume.skills[0].passed >= resume.skills[resume.skills.length - 1].passed, '按通过数降序');
  assert.ok(resume.highlights.length >= 2, '亮点至少两条');
  resume.highlights.forEach(function (row) {
    assert.ok(row.text && row.evidence, '每条亮点都要带依据：' + JSON.stringify(row));
  });
  assert.equal(resume.projects.length, 1);
  assert.ok(resume.learning.passed === 20, '学习数据要对：' + resume.learning.passed);
  assert.ok(resume.markdown.indexOf('不含虚构') > -1, '要写明边界：不编经历');
  assert.ok(resume.markdown.indexOf('| 方向 | 水平 |') > -1, 'markdown 要有技能表');
  // 没练过时不能编数据
  const empty = buildResume([], TASKS, {});
  assert.equal(empty.skills.length, 0);
  assert.ok(empty.headline.indexOf('还没有通过任何题目') > -1, empty.headline);
  assert.ok(empty.markdown.indexOf('通过 0') > -1, empty.markdown);
});

test('短板方向：只报练过的轨道里通过率低的，不瞎猜没碰过的', function () {
  const records = passRecords(3, TASKS);
  const rows = skillRows(records, TASKS);
  assert.ok(rows.length >= 1);
  const gaps = gapTracks(records, TASKS, rows);
  gaps.forEach(function (row) {
    assert.ok(row.percent < 30, '只报通过率低于 30% 的：' + JSON.stringify(row));
  });
});

test('按岗位生成学习计划：要补的知识点 → 题 → 可复制命令，且只算真实记录', function () {
  const records = passRecords(3, TASKS);
  const job = {
    id: 'j-plan', company: '某某科技', position: '高级运维工程师', url: 'https://example.com/jd', status: 'applied', appliedAt: AT,
    analysis: { points: ['k8s.workload', 'ops.prometheus'], tasks: ['k8s.rollout-status', 'ops.prom-query'] }
  };
  const plan = studyPlan(job, TASKS, records, {});
  assert.equal(plan.projectName, '某某科技-高级运维工程师', '项目名用公司-岗位：' + plan.projectName);
  assert.ok(plan.points.length >= 2, '要给出知识点行');
  plan.points.forEach(function (row) {
    assert.ok(row.name && row.tasks.length > 0, '每个知识点都要挂得上题：' + JSON.stringify(row));
    assert.ok(row.missing.length <= row.tasks.length);
  });
  assert.ok(plan.missingTasks.length > 0, '要有待练清单');
  assert.equal(new Set(plan.missingTasks).size, plan.missingTasks.length, '待练清单不能重复');
  assert.ok(plan.markdown.indexOf('# 岗位学习计划') > -1);
  assert.ok(plan.markdown.indexOf('| 知识点 | 待练 |') > -1, 'markdown 要有知识点表');
  assert.ok(plan.markdown.indexOf('drill --tasks=') > -1, '要给出可复制命令');
  assert.ok(plan.markdown.indexOf('不含任何虚构经历') > -1, '要写明边界');
  // 没分析过知识点的岗位：如实说，而不是编一张空表
  const bare = studyPlan({ id: 'j2', company: 'A', position: 'B' }, TASKS, records, {});
  assert.equal(bare.points.length, 0);
  assert.ok(bare.markdown.indexOf('还没分析出知识点') > -1, bare.markdown);
});
test('投递材料：硬要求逐条对得上、要点只挑相关方向、差异主动写出来', function () {
  const records = passRecords(5, TASKS);
  const jdTasks = TASKS.slice(0, 10).map(function (task) { return task.id; });
  const job = {
    id: 'j-pack', company: '某某科技', position: '高级运维工程师', url: 'https://example.com/jd', status: 'todo',
    analysis: {
      points: ['k8s.workload'], tasks: jdTasks, location: '深圳', postedAt: '3 天前',
      salary: { min: 25, max: 40, unit: 'K', text: '25-40K' },
      mustHave: [{ text: '熟悉 Service A 与 container 编排', evidence: '熟悉' }]
    }
  };
  const pack = applicationPack(job, TASKS, records, {});
  assert.equal(pack.company, '某某科技');
  assert.equal(pack.location, '深圳', '地点要带进材料');
  assert.ok(pack.salary && pack.salary.min === 25, '薪资要带进材料');
  assert.equal(pack.mustRows.length, 1);
  assert.ok(pack.mustRows[0].total > 0, '硬要求要能映射到题（字典或技术词兜底）：' + JSON.stringify(pack.mustRows[0]));
  assert.ok(['已覆盖', '部分覆盖', '待补'].indexOf(pack.mustRows[0].status) > -1, pack.mustRows[0].status);
  assert.ok((pack.matchWhy || []).length >= 2, '匹配度依据要带上');
  assert.ok(pack.markdown.indexOf('## 一、逐条对硬要求') > -1);
  assert.ok(pack.markdown.indexOf('## 二、可粘贴的自我介绍要点') > -1);
  assert.ok(pack.markdown.indexOf('## 三、差异自陈') > -1);
  assert.ok(pack.markdown.indexOf('## 四、投递动作') > -1);
  assert.ok(pack.markdown.indexOf('不含虚构经历') > -1, '要写明边界');
  // 老数据没有硬要求：如实说明，不编一张空表
  const bare = applicationPack({ id: 'j2', company: 'A', position: 'B', analysis: { tasks: [] } }, TASKS, records, {});
  assert.equal(bare.mustRows.length, 0);
  assert.ok(bare.markdown.indexOf('没有硬要求') > -1, bare.markdown);
});

test('推荐筛选：地点/薪资下限/只看远程是硬条件（没写薪资的岗位不因查不到被筛掉）', function () {
  const records = passRecords(5, TASKS);
  const jdTasks = TASKS.slice(0, 10).map(function (task) { return task.id; });
  const mk = function (id, extra) {
    return { id: id, company: id.toUpperCase(), position: 'p', status: 'todo', analysis: Object.assign({ tasks: jdTasks, mustHave: [] }, extra) };
  };
  const jobs = [
    mk('a', { location: '深圳', salary: { min: 30, max: 50, unit: 'K', text: '30-50K' } }),
    mk('b', { location: '北京', salary: { min: 15, max: 20, unit: 'K', text: '15-20K' } }),
    mk('c', { remote: true })
  ];
  assert.deepEqual(recommendJobs(jobs, TASKS, records, { location: '深圳' }).map(function (row) { return row.jobId; }), ['a']);
  assert.deepEqual(recommendJobs(jobs, TASKS, records, { minSalary: 25 }).map(function (row) { return row.jobId; }), ['a', 'c'], '没写薪资的 c 不该被筛掉');
  assert.deepEqual(recommendJobs(jobs, TASKS, records, { remoteOnly: true }).map(function (row) { return row.jobId; }), ['c']);
});
test('推荐筛选与新鲜度：地点/薪资区间/远程是硬门槛，发布只在同级里参与排序', function () {
  const jdTasks = TASKS.slice(0, 10).map(function (task) { return task.id; });
  const mk = function (id, extra) {
    return { id: id, company: id, position: 'p', status: 'todo', analysis: Object.assign({ tasks: jdTasks, mustHave: [] }, extra) };
  };
  const jobs = [
    mk('old-good', { postedAt: '10 天前' }),
    mk('new-same', { postedAt: '今天' }),
    mk('shanghai', { location: '上海', salary: { min: 10, max: 15, unit: 'K', text: '10-15K' } }),
    mk('shenzhen', { location: '深圳', salary: { min: 30, max: 50, unit: 'K', text: '30-50K' } }),
    mk('remote-any', { remote: true })
  ];
  assert.equal(freshnessRank('今天'), 2);
  assert.equal(freshnessRank('3 天前'), 2);
  assert.equal(freshnessRank('5 天前'), 1);
  assert.equal(freshnessRank('2 周前'), 0);
  assert.equal(freshnessRank(''), 0);
  // 同级（都全通过）：新发布的排前面
  const order = recommendJobs(jobs, TASKS, [], { limit: 10 }).map(function (row) { return row.jobId; });
  assert.ok(order.indexOf('new-same') < order.indexOf('old-good'), '同匹配度时新发布的靠前：' + order.join(','));
  // 地点是硬门槛
  assert.deepEqual(recommendJobs(jobs, TASKS, [], { location: '深圳' }).map(function (row) { return row.jobId; }), ['shenzhen']);
  // 薪资按区间重叠：期望 25-40K 时 30-50K 与 10-15K 都不该通过（前者重叠，后者不重叠）
  const bySalary = recommendJobs(jobs, TASKS, [], { salaryMin: 25, salaryMax: 40, limit: 10 }).map(function (row) { return row.jobId; });
  assert.ok(bySalary.indexOf('shenzhen') > -1, '重叠的岗位要留：' + bySalary.join(','));
  assert.equal(bySalary.indexOf('shanghai'), -1, '完全不重叠的岗位要筛掉：' + bySalary.join(','));
  assert.ok(bySalary.indexOf('remote-any') > -1, '没写薪资的岗位不因查不到被筛掉：' + bySalary.join(','));
  // 只看远程
  assert.deepEqual(recommendJobs(jobs, TASKS, [], { remoteOnly: true }).map(function (row) { return row.jobId; }), ['remote-any']);
  // 关掉新鲜度排序时回到纯匹配度（同级按公司名，保持稳定）
  const noFresh = recommendJobs(jobs, TASKS, [], { limit: 10, freshFirst: false }).map(function (row) { return row.jobId; });
  assert.ok(noFresh.length === 5, '关掉新鲜度也要给全量');
});