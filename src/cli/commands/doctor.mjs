// 数据体检：项目元数据 / 索引 / 原文 / 草案 / 练习记录 是否自洽；--fix 做保守修复。
import { fixDoctor, runDoctor } from '../../core/doctor.mjs';

export async function doctor(ctx) {
  const { args, asJson, out } = ctx;
  const fix = Boolean(args.fix);
  const result = fix ? fixDoctor({}) : runDoctor({});
  if (asJson) { out(result); return 0; }
  console.log(result.markdown);
  if (fix) {
    console.log('修复前：' + JSON.stringify(result.before) + '　修复后：' + JSON.stringify(result.after));
  }
  return 0;
}
