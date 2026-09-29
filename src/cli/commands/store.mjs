// 进度落盘相关命令：board / export / import。
import { board, exportProgress, importProgress } from '../../store.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

export async function boardCommand(ctx) {
  const { asJson, out } = ctx;
  const rows = board();
  if (asJson) {
    out(rows);
  } else if (!rows.length) {
    console.log('还没有记录。先跑一次 check，例如：node src/cli.mjs check docker.run-web "docker run -d -p 8080:80 --name web nginx:1.25"');
  } else {
    console.log('客户端\t提交\t通过\t最高分\t均分\t平台');
    rows.forEach(function (r) {
      console.log([r.client, r.attempts, r.passed, r.best, r.avg, r.platform].join('\t'));
    });
  }
}

export async function exportCommand(ctx) {
  const { args } = ctx;
  const file = typeof args._[1] === 'string' ? args._[1] : 'dsh-learn-progress.json';
  const payload = exportProgress();
  writeFileSync(file, JSON.stringify(payload, null, 2));
  // 备份是"整份搬走"：记录、笔记、学习目标都要报出来，用户才知道换机器不会丢东西
  console.log('已导出 ' + payload.records.length + ' 条记录、'
    + Object.keys(payload.notes || {}).length + ' 条笔记、'
    + ((payload.goals && (payload.goals.dailyTasks || payload.goals.dailyMinutes)) ? '学习目标' : '无目标')
    + ' 到 ' + file);
}

export async function importCommand(ctx) {
  const { args } = ctx;
  const file = args._[1];
  if (typeof file !== 'string') {
    console.error('用法：node src/cli.mjs import <file.json>');
    return 2;
  }
  const result = importProgress(JSON.parse(readFileSync(file, 'utf8')));
  console.log('导入完成：新增 ' + result.added + ' 条，跳过重复 ' + result.skipped + ' 条，当前共 ' + result.total + ' 条'
    + (result.notes ? '；笔记 +' + result.notes + ' 条' : '')
    + (result.goals ? '；学习目标已采纳' : ''));
}
