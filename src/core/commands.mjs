// 命令面板的**单一事实源**：网页版 ⌘K、原生端菜单、CLI 的 commands 都读这一份表。
//
// 为什么放 core：命令清单最容易三端各写一份然后走样（本会话已经见过类似情况：引导内容、能力对照表）。
// 每条命令都带：id、标题、分组、CLI 等价命令（保证「界面上能做，命令行也一定做得到」）、
// 网页/原生的动作名（界面侧只认这几个动作，不去猜）。
export const COMMANDS = [
  { id: 'page.learn', title: '去学习页', group: '页面', shortcut: '⌘1', action: 'page:learn', cli: 'list' },
  { id: 'page.projects', title: '去项目页', group: '页面', shortcut: '⌘2', action: 'page:projects', cli: 'project list' },
  { id: 'page.jobs', title: '去投递页', group: '页面', shortcut: '⌘3', action: 'page:jobs', cli: 'jobs' },
  { id: 'page.flow', title: '去流程页', group: '页面', shortcut: '⌘4', action: 'page:flow', cli: 'flow' },
  { id: 'practice.daily', title: '练今天这一题', group: '学习', shortcut: '', action: 'api:/api/daily', cli: 'daily' },
  { id: 'practice.review', title: '看复习队列', group: '学习', shortcut: '', action: 'api:/api/review', cli: 'review' },
  { id: 'practice.mastery', title: '看最弱知识点', group: '学习', shortcut: '', action: 'api:/api/mastery', cli: 'mastery' },
  { id: 'practice.progress', title: '看学习进度', group: '学习', shortcut: '', action: 'api:/api/progress', cli: 'progress' },
  { id: 'start.guide', title: '从这里开始（首次运行引导）', group: '引导', shortcut: '⌘⇧G', action: 'api:/api/onboarding', cli: 'start' },
  { id: 'data.doctor', title: '数据体检', group: '维护', shortcut: '⌘D', action: 'api:/api/doctor', cli: 'doctor' },
  { id: 'data.metrics', title: '运行指标', group: '维护', shortcut: '', action: 'api:/api/metrics', cli: 'metrics' },
  { id: 'data.backup', title: '整机备份', group: '维护', shortcut: '⌘B', action: 'api:/api/backup', cli: 'backup' },
  { id: 'data.migrate', title: '迁移存储 schema', group: '维护', shortcut: '', action: 'api:/api/storage', cli: 'storage migrate' },
  { id: 'data.export', title: '导出进度', group: '维护', shortcut: '', action: 'api:/api/export', cli: 'export' }
];

export function commandById(id) {
  return COMMANDS.filter(function (row) { return row.id === id; })[0] || null;
}

// 极简匹配：标题/ID/分组任意命中即可，空格分词（够用，且好测）
export function searchCommands(query) {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return COMMANDS.slice();
  const words = text.split(/\s+/);
  return COMMANDS.filter(function (row) {
    const hay = (row.title + ' ' + row.id + ' ' + row.group).toLowerCase();
    return words.every(function (word) { return hay.indexOf(word) > -1; });
  });
}

// 分组后的清单（界面用这个渲染，顺序稳定）
export function groupedCommands(rows) {
  const list = rows || COMMANDS;
  const groups = [];
  list.forEach(function (row) {
    let group = groups.filter(function (item) { return item.name === row.group; })[0];
    if (!group) { group = { name: row.group, commands: [] }; groups.push(group); }
    group.commands.push(row);
  });
  return groups;
}

// 快捷键表（CLI 打印、界面显示、README 都用它，避免"三处各写一份"）
export function shortcutRows() {
  return COMMANDS.filter(function (row) { return row.shortcut; })
    .map(function (row) { return { shortcut: row.shortcut, title: row.title, id: row.id }; });
}

export function renderCommands() {
  const out = ['命令面板（网页版按 ⌘K / Ctrl+K 打开；原生端菜单「命令面板」）', ''];
  groupedCommands().forEach(function (group) {
    out.push(group.name + '：');
    group.commands.forEach(function (row) {
      out.push('  ' + (row.shortcut || '　　').padEnd(4) + ' ' + row.title + '　（CLI：node src/cli.mjs ' + row.cli + '）');
    });
    out.push('');
  });
  return out.join(String.fromCharCode(10));
}
