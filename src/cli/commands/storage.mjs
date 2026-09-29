// 存储 schema：看现状与迁移（CLI / 接口 / 体检共用 store.mjs 里那一份口径）。
import { storageStatus, migrateStorage } from '../../store.mjs';

export async function storage(ctx) {
  const { args, asJson, out } = ctx;
  const sub = args._[1] || 'status';

  if (sub === 'status') {
    const report = storageStatus();
    if (asJson) { out(report); return report.ok ? 0 : 1; }
    console.log('存储 schema：' + report.summary);
    report.rows.forEach(function (row) {
      console.log('  ' + row.name + '　v' + (row.exists ? row.version : '（无文件）') + ' → v' + row.target + '　' + row.shape + '　' + row.note);
    });
    if (!report.ok) {
      console.log('需要迁移：' + report.needsMigration.join('、'));
      console.log(report.hint);
      return 1;
    }
    console.log(report.hint);
    return 0;
  }

  if (sub === 'migrate') {
    const result = migrateStorage({ dryRun: Boolean(args['dry-run']) });
    if (asJson) { out(result); return 0; }
    result.steps.forEach(function (row) {
      console.log('  ' + row.name + '：' + row.action + (row.from !== undefined ? ('　v' + row.from + ' → v' + row.to) : '') + (row.backup ? '　备份 ' + row.backup : ''));
    });
    console.log(result.dryRun ? '（--dry-run：只出计划，没有落盘）' : ('迁移完成，日志：' + result.log));
    return 0;
  }

  console.error('用法：node src/cli.mjs storage status|migrate [--dry-run] [--json]');
  return 2;
}
