// understand：把一段自由文本读成结构化信息（岗位/公司/级别/硬要求/加分项/技术栈/知识点/可练题）。
// 输入方式与 analyze 一致：--text / --file / --ocr / stdin。口径在 core/understand.mjs（三端共用）。
import { readFileSync } from 'node:fs';
import { understandText, summarizeUnderstanding } from '../../core/understand.mjs';
import { ocrImage } from '../../core/ocr.mjs';

async function readInput(args) {
  if (typeof args.text === 'string' && args.text.trim()) return { ok: true, text: args.text, source: '命令行文本' };
  if (typeof args.file === 'string' && args.file.trim()) {
    try { return { ok: true, text: readFileSync(args.file, 'utf8'), source: args.file }; } catch (err) { return { ok: false, reason: '读文件失败：' + err.message }; }
  }
  if (typeof args.ocr === 'string' && args.ocr.trim()) {
    const done = ocrImage(args.ocr, {});
    if (!done.ok) return { ok: false, reason: '识图失败：' + done.reason };
    return { ok: true, text: done.text, source: args.ocr + '（识图）' };
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim()) return { ok: true, text: text, source: '标准输入' };
  return { ok: false, reason: '没有输入：用 --text / --file / --ocr，或从 stdin 喂进来' };
}

export async function understand(ctx) {
  const { args, asJson, out } = ctx;
  const input = await readInput(args);
  if (!input.ok) {
    console.error(input.reason);
    console.error('用法：node src/cli.mjs understand --text / --file jd.md / --ocr 截图.png（也可以从 stdin 读）');
    return 2;
  }
  const result = understandText(input.text, { limit: Number(args.limit) || 20 });
  if (asJson) { out(Object.assign({ source: input.source }, result)); return 0; }
  console.log('输入：' + input.source);
  console.log(summarizeUnderstanding(result));
  console.log('');
  const object = (result.company || result.position) ? ('　对象：' + (result.company || '?') + ' · ' + (result.position || '?')) : '';
  console.log('分类：' + result.kind + object + (result.seniority ? '　级别：' + result.seniority : ''));
  if (result.mustHave.length) {
    console.log('硬要求（' + result.mustHave.length + ' 条，方括号里是判定依据）：');
    result.mustHave.forEach(function (row) { console.log('  - ' + row.text + '　[' + row.evidence + ']'); });
  }
  if (result.niceToHave.length) {
    console.log('加分项（' + result.niceToHave.length + ' 条）：');
    result.niceToHave.forEach(function (row) { console.log('  - ' + row.text + '　[' + row.evidence + ']'); });
  }
  if (result.stack.length) console.log('技术栈：' + result.stack.join('、'));
  if (result.points.length) console.log('知识点：' + result.points.map(function (row) { return row.name; }).join('、'));
  if (result.tasks.length) {
    console.log('可练题 ' + result.tasks.length + ' 道　开练：node src/cli.mjs drill --tasks=' + result.tasks.join(','));
  }
  return 0;
}
