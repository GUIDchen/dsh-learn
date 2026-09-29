// 进度文档的护栏：docs/PROGRESS.md 由脚本生成，但只有测试盯着它，才不会某天悄悄过期。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
// 进度文档描述的是随工具发布的题库（生成脚本也用这一份）：用户自己 promote 的包
// 另有一行「用户题库」如实写出，但不改变上面那组数字
import { BUILTIN_TASKS as TASKS, TRACKS, BUILTIN_PACK_IDS as PACK_IDS, levelStats } from '../src/core/tasks.mjs';
import { POINTS, MODULES } from '../src/core/knowledge.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const doc = readFileSync(join(ROOT, 'docs/PROGRESS.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// 我自己用脚本往完成报告里插章节时，替换串里出现了美元符加反引号这种组合——
// String.replace 会把它当成替换模式，于是整篇文档的开头（约 4000 行）被插进了 5.111 的表格行里，
// 报告里出现了两份「## 1. 结论」，而这个错误**七轮都没被发现**：
// 因为所有关于文档的断言都只看“某句话在不在”，没人看结构是否自洽。
// 这条护栏专治这一类：结构重复必须立刻红。
test('完成报告结构自洽：标题唯一、章节不重复（防止拼接事故）', function () {
  const report = readFileSync(join(ROOT, 'docs/COMPLETION-REPORT.md'), 'utf8');
  // 先剥掉围栏代码块：报告里会引用 CLI 输出，而 CLI 输出自带一级标题（例如投递跟进的标题行），
  // 不剥掉就会把引用内容当成文档标题（实测第 10 轮误报过一次）。
  const stripped = report.replace(/```[\s\S]*?```/g, function (block) {
    return block.split(String.fromCharCode(10)).map(function () { return ''; }).join(String.fromCharCode(10));
  });
  const lines = stripped.split(String.fromCharCode(10));

  const tops = lines.filter(function (l) { return l.indexOf('# ') === 0; });
  assert.equal(tops.length, 1, '文档标题只能有一个：' + JSON.stringify(tops));

  const h2 = lines.filter(function (l) { return l.indexOf('## ') === 0; });
  const seen = new Set();
  const dup = [];
  h2.forEach(function (row) {
    if (seen.has(row)) dup.push(row);
    seen.add(row);
  });
  assert.deepEqual(dup, [], '重复的二级标题说明文档被拼接坏了：' + dup.slice(0, 3).join(' / '));

  // 逐轮小节已按 50 轮一卷拆到 docs/report/：轮次唯一性与体量兜底改在**卷**上做。
  // （分卷自身的完整性由 test/report-split.test.mjs 逐个核对：不丢、不重、不跳号、索引计数一致。）
  const volumes = readdirSync(join(ROOT, 'docs/report'))
    .filter(function (name) { return /^rounds-[0-9]{3}-[0-9]{3}\.md$/.test(name); })
    .sort()
    .map(function (name) { return readFileSync(join(ROOT, 'docs/report', name), 'utf8'); });
  assert.ok(volumes.length >= 1, '至少要有一卷逐轮日志');
  const roundText = volumes.join(String.fromCharCode(10));
  const roundLines = roundText.split(String.fromCharCode(10));
  const roundHeads = roundLines.filter(function (l) { return /^## 5\.[0-9]+ /.test(l); });
  const rounds = roundHeads.map(function (row) { return (row.match(/^## 5\.(\d+) /) || [])[1]; }).filter(Boolean);
  const dupRounds = rounds.filter(function (n, i) { return rounds.indexOf(n) !== i; });
  assert.deepEqual(dupRounds, [], '轮次编号重复：' + dupRounds.join('、'));
  assert.ok(rounds.length >= 40, '完成报告应有足够多的轮次记录，实际 ' + rounds.length);
  assert.ok(roundLines.length < roundHeads.length * 60, '卷的行数与章节数不成比例（可能是拼接事故）：' + roundLines.length + ' 行 / ' + roundHeads.length + ' 节');
});

test('进度文档的题库数字与运行时一致', function () {
  assert.ok(doc.indexOf('| 题库 | ' + TASKS.length + ' 题（' + PACK_IDS.length + ' 个数据包 / ' + TRACKS.length + ' 条轨道） |') > -1,
    'docs/PROGRESS.md 的题库规模应为 ' + TASKS.length + ' 题：改完题库请重新跑 node scripts/progress-doc.mjs');
  const levels = levelStats(TASKS);
  assert.ok(doc.indexOf('简单 ' + levels.easy + ' / 中等 ' + levels.medium + ' / 困难 ' + levels.hard) > -1, '难度分布要与运行时一致');
  assert.ok(doc.indexOf('| 知识点 | ' + POINTS.length + ' 个 / ' + MODULES.length + ' 个模块 |') > -1, '知识点数字要与运行时一致');
  assert.ok(doc.indexOf('当前版本：' + pkg.version) > -1, '版本号要与 package.json 一致');
  assert.ok(doc.indexOf('| 题库体检 | 错误 0 / 提醒 0') > -1, '体检应为 0 错 0 提醒');
});

test('进度文档写出了两个阶段的计划与完成度', function () {
  assert.ok(doc.indexOf('第一阶段 · 打磨') > -1 && doc.indexOf('第二阶段 · 继续推进') > -1, '两个阶段都要有');
  assert.match(doc, /\| 第二阶段 · 继续推进 \|[^\n]*(进行中|未开始)/);
  assert.ok(doc.indexOf('每轮必须留下的证据') > -1, '要写清每轮的证据清单');
  assert.ok(doc.indexOf('plan --status') > -1, '要指向学习侧的计划完成情况命令');
  // 最近轮次记录：从完成报告解析出来的，不是手抄的
  assert.ok(doc.indexOf('## 二之补、最近轮次记录') > -1, '要有最近轮次记录');
  assert.ok(/\| 第 \d+ 轮 \| [^|]+\|/.test(doc), '轮次记录要是表格且带内容');
  assert.ok(doc.indexOf('这里是最近 6 轮的标题') > -1, '要写清这段是从报告解析来的');
  // 类型分布与题库增长：也都是脚本统计出来的，不靠人工打标
  assert.ok(doc.indexOf('每轮在做什么：类型分布与题库增长') > -1, '要有轮次类型分布');
  assert.ok(/\| 题库扩充与分类 \| \d+ \|/.test(doc), '类型分布要是表格');
  assert.ok(doc.indexOf('题库增长（每轮标题里报出的数字）') > -1, '要有题库增长曲线');
  assert.ok(/\| 第 \d+ 轮 \| \d+ 题 \|/.test(doc), '增长曲线要逐轮列出数字');
});