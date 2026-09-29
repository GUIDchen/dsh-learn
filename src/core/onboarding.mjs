// 首次运行引导：把「从零到第一题」拆成可判定的步骤，并给出**下一步的确切动作**。
//
// 为什么放 core：CLI、网页版、原生端要看到同一份引导（这是三端对齐最容易走样的一类内容），
// 而且它必须**离线可用**——只读本地状态，不发任何请求。
//
// 判定口径（全部来自本地事实，不猜）：
//   1. 环境：平台探测成功
//   2. 练过第一题：有练习记录
//   3. 建过项目：项目数 > 0
//   4. 从岗位描述出过练习清单：有项目带来源
//   5. 设过学习目标：dailyTasks > 0
//   6. 备份过一次：整机备份存在
import { detectPlatform } from './platform.mjs';

export const ONBOARDING_STEPS = [
  { id: 'platform', title: '确认本机平台与工具链', cli: 'node src/cli.mjs probe', why: '题目按平台判分，先知道自己在哪一档' },
  { id: 'first-check', title: '练第一道题（写一条命令并判定）', cli: 'node src/cli.mjs drill --limit=1', why: '判定是这套工具的核心：写下来才知道对不对' },
  { id: 'first-project', title: '建一个项目（把岗位描述粘进来）', cli: 'node src/cli.mjs project init 我的岗位', why: '项目会把岗位描述变成知识点与可练题' },
  { id: 'first-plan', title: '从岗位描述生成练习清单', cli: 'node src/cli.mjs project jdplan 我的岗位', why: '先练哪几道，按你的岗位算出来' },
  { id: 'goal', title: '设一个学习目标（每日几题 / 几分钟）', cli: 'node src/cli.mjs goal --tasks=3 --minutes=30', why: '目标决定每日一题与进度口径' },
  { id: 'backup', title: '做一次整机备份', cli: 'node src/cli.mjs backup', why: '进度 / 项目 / 笔记 / 投递一起备一份，换机器不丢' }
];

export function onboardingState(facts) {
  const f = facts || {};
  const platform = f.platform || detectPlatform();
  const records = Number(f.records) || 0;
  const projects = Number(f.projects) || 0;
  const projectsWithSources = Number(f.projectsWithSources) || 0;
  const dailyTasks = Number(f.dailyTasks) || 0;
  const backupExists = Boolean(f.backupExists);
  const doneMap = {
    platform: Boolean(platform),
    'first-check': records > 0,
    'first-project': projects > 0,
    'first-plan': projectsWithSources > 0,
    goal: dailyTasks > 0,
    backup: backupExists
  };
  const steps = ONBOARDING_STEPS.map(function (row) {
    const done = Boolean(doneMap[row.id]);
    return Object.assign({}, row, { done: done, action: done ? null : row.cli });
  });
  const done = steps.filter(function (row) { return row.done; }).length;
  const next = steps.filter(function (row) { return !row.done; })[0] || null;
  const state = {
    platform: platform,
    steps: steps,
    done: done,
    total: steps.length,
    percent: Math.round((done / steps.length) * 100),
    finished: !next,
    next: next,
    headline: next ? ('下一步：' + next.title) : '六步都走过了：可以开始每天练几道、定期备份',
    command: next ? next.cli : null
  };
  state.markdown = renderOnboarding(state);
  return state;
}

export function renderOnboarding(state) {
  const fence = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
  const out = [];
  out.push('# 从这里开始');
  out.push('');
  out.push('已经走了 ' + state.done + ' / ' + state.total + ' 步（' + Math.round((state.done / state.total) * 100) + '%）。');
  out.push('');
  state.steps.forEach(function (row, index) {
    out.push('- [' + (row.done ? 'x' : ' ') + '] ' + (index + 1) + '. ' + row.title + (row.done ? '' : ('　→ ' + row.cli)));
  });
  if (state.next) {
    out.push('');
    out.push('**现在做第 ' + (state.done + 1) + ' 步**：' + state.next.title);
    out.push('');
    out.push('为什么：' + state.next.why);
    out.push('');
    out.push(fence);
    out.push(state.next.cli);
    out.push(fence);
  }
  return out.join(String.fromCharCode(10)) + String.fromCharCode(10);
}
