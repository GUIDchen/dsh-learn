// 体量守卫：单文件超过预算就必须拆。
//
// 背景：评审量到 web/app.mjs 3.4k 行、NativeUI.swift 2.9k 行、api.mjs 1.1k 行；
// 大文件的具体代价已经出现过——NativeUI.swift 让 SwiftUI 类型检查超时（本会话咬了 6 次），
// app.mjs 让"改一处要滚很久"。这个守卫把预算钉住，只允许变小、不允许继续长。
//
// 拆分路线图（下一轮按这个做，纯搬运）：
//   1. web/app.mjs → web/pages/{repo,learn,jobs,flow}.mjs + web/api.mjs + web/format.mjs
//      （模块加载链路已在本轮打通：服务端 /xx.mjs 通用分支 + sw.js 清单 + 本守卫）
//   2. app/macos/NativeUI.swift → RepoPage/LearnPage/JobsPage/FlowPage.swift
//      （注意构建脚本是显式列文件的，且 3 条守卫直接扫 NativeUI.swift 内容，要一起改）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUDGETS = [
  { file: 'web/app.mjs', max: 2750, note: '学习/投递面板 + 引导/⌘K/主题/i18n/趋势/提醒 + 项目渲染组已拆出' },
  { file: 'web/repo.mjs', max: 450, note: '项目/仓库渲染组：项目结果、项目列表、来源详情、草案' },
  { file: 'web/panels.mjs', max: 450, note: '学习页支撑面板（9 个面板）' },
  { file: 'web/format.mjs', max: 200, note: '纯工具别塞业务' },
  { file: 'web/jobs.mjs', max: 420, note: '投递页；再大就按"列表/表单"再分' },
  { file: 'web/pack.mjs', max: 200, note: '题包面板' },
  { file: 'app/macos/Panels.swift', max: 420, note: '叶子视图 + 首次运行引导卡片（从 NativeUI 拆出）' },
  { file: 'app/macos/NativeUI.swift', max: 2750, note: '叶子视图已拆出；整页拆分不可行（见报告 5.201），继续按子区块拆' },
  { file: 'app/macos/VerdictPanel.swift', max: 300, note: '判定 / 笔记 / 验证三块' },
  { file: 'src/store.mjs', max: 240, note: '组合层（导出/导入/迁移/reset）+ barrel；五个子模块已拆出' },
  { file: 'src/store/progress.mjs', max: 220, note: '进度域：快照 + 追加日志 + 归档 + 健康检查' },
  { file: 'src/store/settings.mjs', max: 140, note: '偏好 / 目标 / 笔记' },
  { file: 'src/store/jobs.mjs', max: 240, note: '投递域：快照 + 操作日志 + 归档' },
  { file: 'src/store/home.mjs', max: 120, note: 'home 位置与文件名的唯一来源' },
  { file: 'src/store/atomic.mjs', max: 160, note: '原子写、损坏留档、写锁' },
  { file: 'src/web/api.mjs', max: 140, note: '保序路由表 + 域移交：实现都在 routes/* 与 api-routes.mjs' },
  { file: 'src/web/api-routes.mjs', max: 400, note: '小路由实现（review/goal/note/knowledge/doctor/pack/mastery/corpus/draft/probe + probeServer）' },
  { file: 'src/web/routes/learn.mjs', max: 120, note: '学习域**分发器**：ROUTES 表键「方法 + 路径」' },
  { file: 'src/web/routes/learn-actions.mjs', max: 400, note: '学习域动作实现（13 个动作 + 变体题 helper）+ ROUTES 表' },
  { file: 'src/web/routes/research.mjs', max: 240, note: '调研/理解域路由' },
  { file: 'src/web/routes/ops.mjs', max: 200, note: '运维域路由（存储/备份/指标/引导）' },
  { file: 'web/onboarding.mjs', max: 120, note: '网页版首次运行引导卡片' },
  { file: 'web/palette.mjs', max: 260, note: '网页版命令面板（⌘K）' },
  { file: 'web/theme.mjs', max: 160, note: '网页版深浅色（读三端共享的外观偏好）' },
  { file: 'web/trend.mjs', max: 200, note: '网页版进度趋势与成绩单下载' },
  { file: 'web/reminder.mjs', max: 140, note: '网页版目标提醒条' },
  { file: 'src/web/routes/flow.mjs', max: 260, note: '流程域路由 + 装载函数' },
  { file: 'src/web/routes/jobs.mjs', max: 220, note: '投递域路由' },
  { file: 'src/web/routes/project.mjs', max: 120, note: '项目域分发器：GET 调 handleProjectGet、POST 查 ACTIONS 表' },
  { file: 'src/web/routes/project-actions.mjs', max: 400, note: '项目域动作实现（每个 action 一个函数）+ ACTIONS 表' },
  { file: 'src/core/project.mjs', max: 800, note: '索引/来源/草案可再分' }
];

test('单文件体量不得超预算（防止继续膨胀）', function () {
  const over = [];
  BUDGETS.forEach(function (row) {
    const text = readFileSync(join(ROOT, row.file), 'utf8');
    const lines = text.split(String.fromCharCode(10)).length;
    if (lines > row.max) over.push(row.file + '：' + lines + ' 行 > 预算 ' + row.max + '（' + row.note + '）');
  });
  assert.deepEqual(over, [], '这些文件超预算了：' + over.join(' | '));
});

test('网页端的模块链路已打通（app.mjs 通过 import 用纯工具，SW 也缓存了它）', function () {
  const app = readFileSync(join(ROOT, 'web/app.mjs'), 'utf8');
  const sw = readFileSync(join(ROOT, 'web/sw.js'), 'utf8');
  assert.ok(app.indexOf("from './format.mjs'") > -1, 'app.mjs 要从 format.mjs 引入纯工具');
  assert.equal(app.indexOf('function escapeText'), -1, 'escapeText 应当已经搬走，不该还有第二份');
  assert.equal(app.indexOf('function baseName'), -1, 'baseName 同上');
  assert.ok(sw.indexOf('/format.mjs') > -1, 'Service Worker 清单要带上新模块（断网也能用）');
});
