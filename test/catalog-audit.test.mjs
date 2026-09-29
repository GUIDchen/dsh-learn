// 题库体检自身的测试：它必须能抓出坏题，也不能对好题乱报。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECT } from './expected.mjs';
import { auditTask, auditCatalog, auditStructure, MIN_TASKS_PER_TRACK, MAIN_PLATFORMS } from '../src/core/catalog-audit.mjs';
import { TASKS } from '../src/core/tasks.mjs';

function taskOf(overrides) {
  return Object.assign({
    id: 'demo.thing',
    track: 'demo',
    title: '演示题',
    goal: '目标',
    sample: 'echo hi',
    require: [{ p: 'echo', tip: '要用 echo' }],
    forbid: []
  }, overrides || {});
}

// 实测踩到的死路：把一份「从真仓库学出来的草案」推广成外部包后跑 audit，
// 7 道题全被判错，理由都是「请把 draft.k8s.start 加进 src/core/knowledge.mjs」——
// 可 knowledge.mjs 是随工具发布的源码，用户不该为了练自己仓库的题去改它。
test('知识点对账只管内置题：外部包的题不判错，但要如实统计', function () {
  // 字典里挂了一道题（否则会先撞上"知识点没挂任何题"那条规则，测不到这里要测的东西）
  const points = [{ id: 'demo.point', module: 'demo', name: '演示', level: '基础', patterns: ['x'], tasks: ['demo.inside'] }];
  const inside = taskOf({ id: 'demo.inside' });
  const unlisted = taskOf({ id: 'demo.unlisted' });

  const strict = auditCatalog([inside, unlisted], { points: points, builtinTaskIds: ['demo.inside', 'demo.unlisted'] });
  assert.equal(strict.ok, false, '内置题没挂知识点必须判错（护栏不放水）');
  assert.equal(strict.errors.length, 1, '只报没挂的那一道：' + JSON.stringify(strict.errors));
  assert.match(strict.errors[0].message, /knowledge\.mjs/);

  // 同一批题，只把 demo.unlisted 当外部包：不该判错，但要在 externalOrphans 里说清楚
  const loose = auditCatalog([inside, unlisted], { points: points, builtinTaskIds: ['demo.inside'] });
  assert.equal(loose.ok, true, '外部包不该被判错：' + JSON.stringify(loose.errors));
  assert.equal(loose.externalOrphans.length, 1, '但要统计出来：' + JSON.stringify(loose.externalOrphans));
  assert.equal(loose.externalOrphans[0].taskId, 'demo.unlisted');

  // 不传 builtinTaskIds 的老调用方保持原来的严格口径
  const legacy = auditCatalog([inside, unlisted], { points: points });
  assert.equal(legacy.ok, false, '不传 builtinTaskIds 时按内置口径处理，行为不变');
});
// 实测踩到的盲区：MAIN_PLATFORMS 只有 darwin/linux，而 platformsOf() 对「有变体的题」只返回变体自己声明的平台——
// 于是一道只有 darwin+linux 变体的题，win32 从来没被审过：Windows 学员拿到的是顶层兜底规则、连参考答案都没有。
// 现在三个主平台全审，缺参考答案记成平台缺口（扩充信号），不是提醒、更不是错误。
test('平台缺口：有变体但缺某些主平台的题会被列出来，而不是悄悄跳过', function () {
  // 顶层没有 sample（没有兜底答案）但留了兜底规则：win32 就是真缺口
  const task = taskOf({
    id: 'demo.variants',
    sample: '',
    require: [{ p: 'a\\.txt', tip: '要针对 a.txt' }],
    variants: {
      darwin: { sample: 'stat -f %z a.txt', require: [{ p: 'stat\\s+-f', tip: 'BSD 用 -f' }] },
      linux: { sample: 'stat -c %s a.txt', require: [{ p: 'stat\\s+-c', tip: 'GNU 用 -c' }] }
    }
  });
  const findings = auditTask(task);
  const gaps = findings.filter(function (item) { return item.level === 'gap'; });
  assert.deepEqual(gaps.map(function (item) { return item.platform; }), ['win32'], '缺的应该是 win32：' + JSON.stringify(findings));
  assert.match(gaps[0].message, /变体只写了 darwin \/ linux/);
  assert.equal(findings.some(function (item) { return item.level === 'warn'; }), false, '平台缺口不是提醒，别混进 warnings');

  const full = taskOf({
    id: 'demo.full',
    sample: '',
    require: [{ p: 'a\\.txt', tip: '要针对 a.txt' }],
    variants: {
      darwin: { sample: 'stat -f %z a.txt', require: [{ p: 'stat\\s+-f', tip: 'BSD' }] },
      linux: { sample: 'stat -c %s a.txt', require: [{ p: 'stat\\s+-c', tip: 'GNU' }] },
      win32: { sample: '(Get-Item a.txt).Length', require: [{ p: 'Get-Item', tip: 'PowerShell' }] }
    }
  });
  assert.deepEqual(auditTask(full).filter(function (item) { return item.level === 'gap'; }), [], '平台齐了就不该有缺口');

  const report = auditCatalog([task], { builtin: true });
  assert.equal(report.platformGaps.length, 1);
  // 缺口既不进 errors 也不进 warnings（warnings 是给题目本身提意见的，缺口是给出题人派活的）
  assert.equal(report.errors.filter(function (item) { return item.message.indexOf('参考答案') > -1; }).length, 0);
  assert.equal(report.warnings.filter(function (item) { return item.message.indexOf('参考答案') > -1; }).length, 0);
});

// 声明 platforms 之后，那道题不该再被当成「欠了 Windows 参考答案」：
// 「还没写」和「本来就不适用」混在一起，缺口数永远清不到零，看的人就不看了。
test('声明 platforms 的题不再算平台缺口，其他平台也不参与体检', function () {
  const task = taskOf({
    id: 'demo.darwin-only',
    sample: '',
    platforms: ['darwin'],
    require: [{ p: 'a\\.txt', tip: '要针对 a.txt' }],
    variants: { darwin: { sample: 'stat -f %z a.txt', require: [{ p: 'stat\\s+-f', tip: 'BSD 用 -f' }] } }
  });
  const findings = auditTask(task);
  assert.deepEqual(findings.filter(function (item) { return item.level === 'gap'; }), [], '声明过平台的题不该报缺口');
  assert.equal(findings.length, 0, '只声明 darwin 的题不该在 linux/win32 上被体检：' + JSON.stringify(findings));

  // 声明了 platforms 就等于承诺：既然说「不适用 Windows」，就不该又给 Windows 变体——那是自相矛盾
  const contradictory = taskOf({
    id: 'demo.contradiction',
    platforms: ['darwin'],
    variants: {
      darwin: { sample: 'stat -f %z a.txt', require: [{ p: 'stat\\s+-f', tip: 'BSD' }] },
      win32: { sample: '(Get-Item a.txt).Length', require: [{ p: 'Get-Item', tip: 'PowerShell' }] }
    }
  });
  const errors = auditTask(contradictory).filter(function (item) { return item.level === 'error'; });
  assert.equal(errors.length, 1, JSON.stringify(auditTask(contradictory)));
  assert.match(errors[0].message, /platforms 没写 win32，却给了 win32 变体/);
});
test('参考答案拿不到满分就是错误（这正是它抓到的第一个真问题）', function () {
  const wrong = taskOf({ sample: 'printf hi', require: [{ p: 'echo', tip: '要用 echo' }] });
  const findings = auditTask(wrong);
  const errors = findings.filter(function (item) { return item.level === 'error'; });
  assert.equal(errors.length, MAIN_PLATFORMS.length, '每个主平台各报一次');
  assert.match(errors[0].message, /参考答案只拿到 0 分/);
});

test('参考答案正确时不报错', function () {
  assert.deepEqual(auditTask(taskOf()).filter(function (item) { return item.level === 'error'; }), []);
});

test('没有参考答案只算提醒', function () {
  const findings = auditTask(taskOf({ sample: '' }));
  assert.ok(findings.every(function (item) { return item.level === 'warn'; }));
  assert.match(findings[0].message, /没有参考答案/);
});

test('验证命令不在白名单内是错误', function () {
  const bad = taskOf({ verify: { cmd: 'docker system prune -a', expect: '.*' } });
  const errors = auditTask(bad).filter(function (item) { return item.level === 'error'; });
  assert.equal(errors.length, MAIN_PLATFORMS.length, '没有变体的题会在每个主平台上各检查一次');
  assert.ok(errors.every(function (item) { return item.message.indexOf('不在只读白名单内') > -1; }));
});

test('同一题内要素提示重复会提醒', function () {
  const dup = taskOf({
    sample: 'echo a && echo b',
    require: [{ p: 'echo\\s+a', tip: '要用 echo' }, { p: 'echo\\s+b', tip: '要用 echo' }]
  });
  const warnings = auditTask(dup).filter(function (item) { return item.level === 'warn'; });
  assert.ok(warnings.some(function (item) { return item.message.indexOf('要素提示重复') > -1; }));
});

test('变体缺另一半：顶层有兜底规则就不提醒，没有才提醒', function () {
  const withBase = taskOf({ variants: { win32: { sample: 'echo hi', require: [{ p: 'echo', tip: '要用 echo' }] } } });
  assert.equal(auditTask(withBase).filter(function (item) { return item.message.indexOf('缺') > -1; }).length, 0);

  const withoutBase = taskOf({ require: [], variants: { win32: { sample: 'echo hi', require: [{ p: 'echo', tip: '要用 echo' }] } } });
  const warnings = auditTask(withoutBase).filter(function (item) { return item.message.indexOf('顶层没有兜底规则') > -1; });
  assert.equal(warnings.length, 1);
});

test('变体之间没有区分度会提醒', function () {
  const same = taskOf({
    require: [{ p: 'echo', tip: '要用 echo' }],
    variants: {
      darwin: { sample: 'echo hi', require: [{ p: 'echo', tip: '要用 echo' }] },
      linux: { sample: 'echo hi', require: [{ p: 'echo', tip: '要用 echo' }] }
    }
  });
  const warnings = auditTask(same).filter(function (item) { return item.message.indexOf('无区分度') > -1; });
  assert.equal(warnings.length, 2, '两个平台互相都能满分，各提醒一次');
});

test('真实题库必须体检通过（这是出题门禁）', function () {
  const report = auditCatalog(TASKS);
  assert.deepEqual(report.errors, [], '题库里不允许有错误：' + JSON.stringify(report.errors));
  assert.equal(report.ok, true);
  assert.ok(report.tasks >= EXPECT.tasks, '题库应至少 ' + EXPECT.tasks + ' 题，实际 ' + report.tasks);
  assert.ok(report.variants >= 21, '平台变体题应至少 21 道，实际 ' + report.variants);
  assert.ok(report.withSample >= EXPECT.withSample * 0.9, '大部分题应带参考答案，实际 ' + report.withSample);
  assert.ok(Object.keys(report.tracks).length >= 8);
});

test('结构体检：轨道题数下限只对内置题库生效，verify 覆盖 0 会给提醒', function () {
  const tiny = [taskOf({ id: 'demo.a', track: 'demo' }), taskOf({ id: 'demo.b', track: 'demo' })];
  // 别人的自制小包：不该因为"题少"被判不合格
  const custom = auditStructure(tiny, {});
  assert.deepEqual(custom.findings.filter(function (f) { return f.level === 'error'; }), [], '非内置题库不套用题数下限');
  assert.equal(custom.findings.filter(function (f) { return f.level === 'warn'; }).length, 1, '没有 verify 的轨道应提醒');
  assert.equal(custom.findings[0].track, 'demo');
  assert.equal(custom.findings[0].message.indexOf('verify 覆盖率 0') > -1, true);

  // 内置题库：题数低于下限要报错
  const builtin = auditStructure(tiny, { builtin: true });
  const errors = builtin.findings.filter(function (f) { return f.level === 'error'; });
  assert.equal(errors.length, 1, '内置题库应报题数不足');
  assert.match(errors[0].message, new RegExp('低于下限 ' + MIN_TASKS_PER_TRACK));

  // 知识点必须挂题，且指向的题必须存在
  const withPoints = auditStructure([taskOf({ id: 'demo.a', track: 'demo' })], {
    points: [{ id: 'demo.point', tasks: [] }, { id: 'demo.point2', tasks: ['demo.a'] }, { id: 'demo.point3', tasks: ['nope.x'] }]
  });
  const messages = withPoints.findings.map(function (f) { return f.message; }).join(' | ');
  assert.match(messages, /知识点 demo.point 没有挂任何题/);
  assert.match(messages, /指向了不存在的题/);
});

test('难度标注与口径不符会提醒（标注不能凭手感写）', function () {
  const rules = [{ p: 'a', tip: 'a' }, { p: 'b', tip: 'b' }];
  const wrong = auditStructure([
    taskOf({ id: 'demo.wrong', level: 'hard', require: rules, sample: 'echo a b' })
  ], {});
  const warnings = wrong.findings.filter(function (f) { return f.level === 'warn'; });
  assert.ok(warnings.some(function (f) {
    return f.taskId === 'demo.wrong' && f.message.indexOf('标了 hard，按要素与禁止项应为 easy') > -1;
  }), '标错难度要指出来：' + warnings.map(function (f) { return f.message; }).join(' | '));

  // 标注正确时不该报；不标也不报（level 是可选的，外部包可以不写）
  const ok = auditStructure([taskOf({ id: 'demo.ok', level: 'easy', require: rules, sample: 'echo a b' })], {});
  assert.deepEqual(ok.findings.filter(function (f) { return f.taskId === 'demo.ok'; }), []);
  const unlabeled = auditStructure([taskOf({ id: 'demo.none', require: rules, sample: 'echo a b' })], {});
  assert.deepEqual(unlabeled.findings.filter(function (f) { return f.taskId === 'demo.none'; }), []);
});

test('内置题库真的满足结构下限（这是防退化护栏本身的自检）', function () {
  const report = auditCatalog(TASKS, { builtin: true });
  const structural = report.errors.filter(function (item) { return item.message.indexOf('低于下限') > -1; });
  assert.deepEqual(structural, [], '每个轨道都应有 ' + MIN_TASKS_PER_TRACK + ' 道以上题目');
  assert.ok(Object.keys(report.verifyByTrack).length >= 20, '每个轨道都要有 verify 覆盖统计');
});

test('薄轨道是"扩充建议"而不是"提醒"（体检通过不代表题库均衡）', function () {
  const many = [];
  for (let i = 0; i < 12; i += 1) many.push(taskOf({ id: 'big.' + i, track: 'big' }));
  many.push(taskOf({ id: 'small.a', track: 'small' }));
  many.push(taskOf({ id: 'small.b', track: 'small' }));
  const report = auditCatalog(many);
  assert.deepEqual(report.thin, [{ track: 'small', tasks: 2 }], '少于阈值的轨道要单独列出来');
  assert.equal(report.thinLimit, 10);
  // 关键：薄轨道不混进 warnings——否则"0 条提醒"这个体检结论就没意义了
  assert.deepEqual(report.warnings.filter(function (item) { return /薄|少于/.test(item.message); }), []);

  const strict = auditCatalog(many, { thinLimit: 20 });
  assert.deepEqual(strict.thin.map(function (row) { return row.track; }).sort(), ['big', 'small'], '阈值可调');
});

test('auditCatalog 汇总统计与轨道分布', function () {
  const report = auditCatalog([
    taskOf({ id: 'demo.a', track: 'demo' }),
    taskOf({ id: 'demo.b', track: 'other', sample: 'printf x', require: [{ p: 'echo', tip: '要用 echo' }] })
  ]);
  assert.equal(report.tasks, 2);
  assert.deepEqual(report.tracks, { demo: 1, other: 1 });
  assert.equal(report.ok, false);
  assert.equal(report.errors.length, MAIN_PLATFORMS.length, 'demo.b 在每个主平台都判错一次');
  assert.equal(report.withSample, 2);
});
