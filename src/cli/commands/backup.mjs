// 整机备份 / 恢复：CLI 入口（核心逻辑在 core/backup.mjs，接口与体检共用）。
import { join } from 'node:path';
import { createBackup, planBackup, planRestore, restoreBackup, verifyBackup, backupStatus } from '../../core/backup.mjs';
import { homeDir } from '../../store.mjs';

export async function backup(ctx) {
  const { args, asJson, out } = ctx;
  const home = homeDir();
  const dryRun = Boolean(args['dry-run']);
  const result = createBackup(home, { out: typeof args.out === 'string' ? args.out : undefined, dryRun: dryRun });
  if (asJson) { out(result); return 0; }
  console.log((dryRun ? '（--dry-run）会备份 ' : '已备份 ') + result.fileCount + ' 个文件 / ' + result.totalBytes + ' 字节');
  if (dryRun) {
    result.files.slice(0, 10).forEach(function (row) { console.log('  ' + row.rel + '　' + row.size + ' 字节'); });
    if (result.files.length > 10) console.log('  …共 ' + result.files.length + ' 个');
    console.log('将写到：' + result.out);
    return 0;
  }
  console.log('写到：' + result.out);
  const check = verifyBackup(result.out);
  console.log('自校验：' + (check.ok ? '通过' : ('失败 ' + check.broken.join('、'))) + '（' + check.fileCount + ' 个文件）');
  return 0;
}

export async function restore(ctx) {
  const { args, asJson, out } = ctx;
  const file = args._[1];
  if (typeof file !== 'string') { console.error('用法：node src/cli.mjs restore <备份文件> [--dry-run] [--json]'); return 2; }
  const home = typeof args.home === 'string' ? args.home : homeDir();
  const dryRun = Boolean(args['dry-run']);
  if (dryRun) {
    const plan = planRestore(file, home);
    if (asJson) { out(plan); return 0; }
    console.log('（--dry-run）会恢复 ' + plan.rows.length + ' 个文件到 ' + home + '：新建 ' + plan.create + ' / 覆盖 ' + plan.overwrite);
    plan.rows.filter(function (row) { return row.action === 'overwrite'; }).slice(0, 10).forEach(function (row) { console.log('  覆盖 ' + row.rel); });
    return 0;
  }
  const result = restoreBackup(file, { home: home });
  if (asJson) { out(result); return 0; }
  console.log('已恢复 ' + result.rows.length + ' 个文件到 ' + home + '（新建 ' + result.create + ' / 覆盖 ' + result.overwrite + '）');
  if (result.safetyDir) console.log('覆盖前的内容留在：' + result.safetyDir + '（' + result.safetyCount + ' 个文件）');
  const status = backupStatus(home);
  if (status.exists) console.log('最近备份：' + status.latest.at + '（' + status.latest.fileCount + ' 个文件）');
  return 0;
}
