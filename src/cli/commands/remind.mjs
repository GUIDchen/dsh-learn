// 目标提醒：今天练了没、还差几题（与网页/原生端同一份 core/reminder.mjs）。
import { reminder, renderReminder } from '../../core/reminder.mjs';
import { load, readGoals } from '../../store.mjs';

export async function remind(ctx) {
  const { args, asJson, out } = ctx;
  const result = reminder(load().records, readGoals(), typeof args.now === 'string' ? { now: args.now } : {});
  if (asJson) { out(result); return result.level === 'warn' ? 1 : 0; }
  console.log(renderReminder(result));
  return result.level === 'warn' ? 1 : 0;
}
