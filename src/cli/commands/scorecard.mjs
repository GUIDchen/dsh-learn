// 成绩单：默认打印趋势与总览，--out 写文件（.csv 后缀出 CSV），--json 给程序用。
import { writeFileSync } from 'node:fs';
import { asciiChart, scorecard, scorecardCsv, scorecardMarkdown } from '../../core/trend.mjs';
import { load, readGoals } from '../../store.mjs';

export async function scorecardCommand(ctx) {
  const { args, asJson, out } = ctx;
  const days = Number(args.days) || 14;
  const card = scorecard(load().records, { days: days });
  card.goal = readGoals();
  const file = typeof args.out === 'string' ? args.out : null;

  if (file) {
    const isCsv = file.toLowerCase().endsWith('.csv');
    writeFileSync(file, isCsv ? scorecardCsv(card) : scorecardMarkdown(card));
    if (asJson) { out({ ok: true, file: file, format: isCsv ? 'csv' : 'markdown', totals: card.totals }); return 0; }
    console.log('成绩单已写入：' + file + '（' + (isCsv ? 'CSV' : 'Markdown') + '）');
    console.log('练习 ' + card.totals.attempts + ' 次，通过 ' + card.totals.passed + ' 次（' + (card.totals.passRate * 100).toFixed(1) + '%），连续 ' + card.totals.streak + ' 天');
    return 0;
  }

  if (asJson) { out(card); return 0; }
  console.log('最近 ' + days + ' 天：练习 ' + card.totals.attempts + ' 次，通过 ' + card.totals.passed + ' 次（' + (card.totals.passRate * 100).toFixed(1) + '%）');
  console.log('有练习的天数 ' + card.totals.activeDays + ' / ' + days + '　连续 ' + card.totals.streak + ' 天　涉及题 ' + card.totals.tasks);
  if (card.totals.attempts) {
    console.log('');
    console.log(asciiChart(card.series, { height: 4 }));
    console.log(card.series.map(function (row) { return row.date.slice(5); }).join(' '));
  }
  console.log('');
  console.log('导出：node src/cli.mjs scorecard --out=成绩单.md（或 .csv）');
  return 0;
}
