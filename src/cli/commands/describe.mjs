// describe：把一份岗位要求 / 文档 / 截图 / 链接"描述清楚"，再抽全技术栈与知识点。
//   --file / --text / --ocr / --url / stdin 五条输入路径
//   --out=文件 落盘；--json 出结构化结果
import { readFileSync, writeFileSync } from 'node:fs';
import { CliError } from '../context.mjs';
import { describeExtraction } from '../../core/describe.mjs';
import { TASKS } from '../../core/tasks.mjs';
import { PASS_SCORE } from '../../core/judge.mjs';
import { ocrImage } from '../../core/ocr.mjs';
import { fetchText } from '../../core/ingest.mjs';
import { taskStats } from '../../core/progress.mjs';
import { load } from '../../store.mjs';

function passedIds() {
  const stats = taskStats(load().records || [], TASKS);
  return new Set(stats.known.filter(function (row) { return row.best >= PASS_SCORE; }).map(function (row) { return row.taskId; }));
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function describe(ctx) {
  const { args, asJson, out } = ctx;
  let text = typeof args.text === 'string' ? args.text : '';
  let source = '文本参数';
  const filePath = typeof args.file === 'string' ? args.file : '';
  const ocrPath = typeof args.ocr === 'string' ? args.ocr : '';
  const url = typeof args.url === 'string' ? args.url : '';

  if (filePath) {
    try { text = readFileSync(filePath, 'utf8'); } catch (err) { throw new CliError('读文件失败：' + err.message, 3); }
    source = '文件 ' + filePath;
  } else if (ocrPath) {
    const shot = ocrImage(ocrPath, {});
    if (!shot.ok) { console.error('识图失败：' + shot.reason + '（先看 node src/cli.mjs ocr --capabilities）'); return 3; }
    text = shot.text;
    source = '截图 ' + ocrPath + '（本机 OCR）';
  } else if (url) {
    const page = await fetchText(url, { maxBytes: 2 * 1024 * 1024, timeout: 20000 });
    if (!page.ok) {
      console.error('抓取失败：' + page.reason);
      console.error('招聘站点多半要登录：export DSH_LEARN_COOKIE=\'从开发者工具复制的 Cookie\' 再试；或改用截图（--ocr）与粘正文（--file）。');
      return 3;
    }
    text = page.text;
    source = '链接 ' + url;
  } else if (!text.trim()) {
    text = await readStdin();
    source = '标准输入';
  }
  if (!String(text).trim()) throw new CliError('没有内容可描述：用 --file / --text / --ocr / --url，或通过 stdin 喂进来', 2);

  const description = describeExtraction(text, { source: source, tasks: TASKS, passedIds: passedIds() });
  if (asJson) { out(description); return 0; }
  if (typeof args.out === 'string' && args.out.trim()) {
    writeFileSync(args.out, description.markdown);
    console.log('已写入 ' + args.out + '（' + description.markdown.length + ' 字）');
    console.log('提取：技术栈 ' + description.report.stats.terms + ' 项 / ' + description.report.stats.categories + ' 类；知识点 '
      + description.report.stats.points + ' 个；可练题 ' + description.report.stats.tasks + ' 道；未覆盖 ' + description.report.stats.uncovered + ' 项');
    return 0;
  }
  console.log(description.markdown);
  return 0;
}
