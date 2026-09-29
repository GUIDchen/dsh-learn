// 命令面板的命令行一侧：打印同一份命令表（含快捷键），保证「界面能做，命令行也做得到」。
import { COMMANDS, renderCommands, searchCommands } from '../../core/commands.mjs';

export async function commands(ctx) {
  const { args, asJson, out } = ctx;
  const query = typeof args.query === 'string' ? args.query : '';
  const rows = query ? searchCommands(query) : COMMANDS;
  if (asJson) { out({ ok: true, query: query, count: rows.length, commands: rows }); return 0; }
  if (query) {
    console.log('匹配「' + query + '」：' + rows.length + ' 条');
    rows.forEach(function (row) { console.log('  ' + row.id + '　' + row.title + '　node src/cli.mjs ' + row.cli); });
    return 0;
  }
  process.stdout.write(renderCommands());
  return 0;
}
