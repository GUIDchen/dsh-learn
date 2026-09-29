// 命令面板的单一事实源：id 唯一、每条都有 CLI 等价命令、搜索与分组可用。
import test from 'node:test';
import assert from 'node:assert/strict';

const { COMMANDS, commandById, searchCommands, groupedCommands, shortcutRows } = await import('../src/core/commands.mjs');

test('命令表：id 唯一、字段齐全、每条都能在命令行里做到', function () {
  const ids = COMMANDS.map(function (row) { return row.id; });
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复：' + ids.join(','));
  COMMANDS.forEach(function (row) {
    assert.ok(row.title && row.title.length > 1, row.id + ' 缺标题');
    assert.ok(row.group, row.id + ' 缺分组');
    assert.ok(row.cli && row.cli.indexOf('node') === -1, row.id + ' 的 cli 应当只写子命令，便于拼接');
    assert.ok(row.action.indexOf('page:') === 0 || row.action.indexOf('api:') === 0, row.id + ' 的动作只有 page:/api: 两种');
    if (row.action.indexOf('api:') === 0) {
      assert.ok(row.action.slice(4).indexOf('/api/') === 0, row.id + ' 的接口动作要以 /api/ 开头：' + row.action);
    }
  });
});

test('搜索：标题/ID/分组任意命中，空格分词，空查询返回全部', function () {
  assert.equal(searchCommands('').length, COMMANDS.length);
  assert.ok(searchCommands('备份').some(function (row) { return row.id === 'data.backup'; }));
  assert.ok(searchCommands('page jobs').some(function (row) { return row.id === 'page.jobs'; }));
  assert.deepEqual(searchCommands('这个词肯定没有'), []);
});

test('分组与快捷键：分组顺序稳定，快捷键只给常用命令', function () {
  const groups = groupedCommands();
  assert.deepEqual(groups.map(function (g) { return g.name; }), ['页面', '学习', '引导', '维护']);
  const shortcuts = shortcutRows();
  assert.ok(shortcuts.length >= 4 && shortcuts.length < COMMANDS.length, '快捷键应当是精选：' + shortcuts.length);
  assert.ok(shortcuts.some(function (row) { return row.id === 'page.learn'; }));
  assert.equal(commandById('page.learn').shortcut, '⌘1');
  assert.equal(commandById('不存在'), null);
});
