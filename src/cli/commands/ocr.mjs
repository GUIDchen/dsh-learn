// ocr：把截图里的文字识别出来（与「项目 / 分析」里的截图入口同一份 core/ocr.mjs）。
// 附带 --capabilities：这台机器能用哪个识别引擎、缺什么、怎么开——能力矩阵可以直接自查。
import { ocrCapabilities, ocrImage } from '../../core/ocr.mjs';

export async function ocr(ctx) {
  const { args, asJson, out } = ctx;

  if (args.capabilities) {
    const caps = ocrCapabilities({});
    if (asJson) { out(caps); return 0; }
    console.log('识图能力（平台 ' + caps.platform + '）：');
    caps.engines.forEach(function (row) {
      console.log('  [' + (row.available ? '可用' : '不可用') + '] ' + row.name);
      console.log('        ' + row.detail);
      if (!row.available) console.log('        开启方式：' + row.enable);
    });
    console.log('当前会用的引擎：' + (caps.chosen || '（无，识图不可用）'));
    console.log('支持的格式：' + caps.formats.join(' / ') + '　上限 ' + Math.round(caps.limits.maxBytes / 1024 / 1024) + 'MB');
    caps.advice.forEach(function (line) { console.log('提示：' + line); });
    return 0;
  }

  const image = typeof args.ocr === 'string' && args.ocr ? args.ocr : String(args._[1] || '');
  if (!image) {
    console.error('用法：node src/cli.mjs ocr <图片路径> [--json]　|　node src/cli.mjs ocr --capabilities');
    return 2;
  }
  const done = ocrImage(image, {});
  if (!done.ok) {
    console.error('识图失败：' + done.reason);
    console.error('先看这台机器能用什么：node src/cli.mjs ocr --capabilities');
    return 3;
  }
  if (asJson) { out({ image: image, text: done.text, lines: done.lines, helper: done.helper, compiled: Boolean(done.compiled) }); return 0; }
  console.log('图片：' + image + '　引擎：' + done.helper + (done.compiled ? '（本次自动编译）' : ''));
  console.log('识别出 ' + done.lines + ' 行：');
  console.log('');
  console.log(done.text);
  return 0;
}
