// 知识点掌握度：最弱的先补，并给出每日该练的题。
import { masteryReport } from '../../core/mastery.mjs';
import { TASKS } from '../../core/tasks.mjs';
import { load } from '../../store.mjs';

export async function mastery(ctx) {
  const { args, asJson, out } = ctx;
  const report = masteryReport(load().records || [], TASKS, {
    limit: Number(args.limit) || 5,
    now: args.now || undefined
  });
  if (asJson) { out(report); return 0; }
  console.log(report.markdown);
  if (args.tasks) {
    const ids = [];
    report.weakest.forEach(function (row) {
      const point = TASKS.filter(function (t) { return t.id === row.id; })[0];
      void point;
    });
    console.log('（--tasks 需要 core/knowledge 的知识点挂题，暂以 markdown 为准）');
  }
  return 0;
}
