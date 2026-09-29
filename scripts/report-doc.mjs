// 生成 docs/COMPLETION-REPORT.md —— 它现在是**总索引**：头部章节 + 分卷目录 + 尾部章节。
//
// 逐轮日志（5.x 小节）按每 50 轮一卷放在 docs/report/rounds-XXX-YYY.md。
// 为什么这么拆：单文件到 9.7k 行以后已经读不动；分卷后每卷 1–3k 行，检索与 diff 都轻。
// 这个文件、卷头目录都由脚本生成，**不要手改**：新增小节用 scripts/append-report-section.mjs。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = join(ROOT, 'docs/report');
const INDEX = join(ROOT, 'docs/COMPLETION-REPORT.md');
const PER_VOLUME = 50;

function pad(n) { return String(n).padStart(3, '0'); }

// 某一节号属于哪一卷（append 与守卫都用它，避免两边各写一套区间计算）
export function volumeFor(number) {
  const start = Math.floor((number - 1) / PER_VOLUME) * PER_VOLUME + 1;
  return { start: start, end: start + PER_VOLUME - 1, file: 'rounds-' + pad(start) + '-' + pad(start + PER_VOLUME - 1) + '.md' };
}

export function readVolumes() {
  if (!existsSync(REPORT_DIR)) return [];
  return readdirSync(REPORT_DIR)
    .filter(function (name) { return /^rounds-[0-9]{3}-[0-9]{3}\.md$/.test(name); })
    .sort()
    .map(function (name) {
      const text = readFileSync(join(REPORT_DIR, name), 'utf8');
      return { name: name, text: text, numbers: sectionNumbers(text) };
    });
}

// 逐轮小节的编号（## 5.x 开头），按出现顺序
export function sectionNumbers(text) {
  const out = [];
  const re = /^## (5\.[0-9]+) /gm;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

export function renderIndex() {
  const head = readFileSync(join(REPORT_DIR, '00-head.md'), 'utf8').replace(/\s+$/, '');
  const tail = readFileSync(join(REPORT_DIR, '99-tail.md'), 'utf8').replace(/\s+$/, '');
  const volumes = readVolumes();
  const out = [head, '', '## 逐轮日志（分卷）', '', '> 本目录由 node scripts/report-doc.mjs 生成：每 ' + PER_VOLUME + ' 轮一卷；新增小节用 scripts/append-report-section.mjs（自动写进对应卷并刷新本索引）。', '', '| 卷 | 覆盖编号 | 小节数 | 文件 |', '| --- | --- | --- | --- |'];
  volumes.forEach(function (row, i) {
    const first = row.numbers[0] || '';
    const last = row.numbers[row.numbers.length - 1] || '';
    out.push('| ' + (i + 1) + ' | ' + first + ' – ' + last + ' | ' + row.numbers.length + ' | [' + row.name + '](report/' + row.name + ') |');
  });
  const total = volumes.reduce(function (sum, row) { return sum + row.numbers.length; }, 0);
  out.push('');
  out.push('共 **' + total + '** 节逐轮记录；小节编号唯一、不跳号（守卫 test/report-split.test.mjs 逐个核对）。');
  out.push('');
  out.push(tail);
  out.push('');
  return out.join(String.fromCharCode(10));
}

export function regenerate() {
  writeFileSync(INDEX, renderIndex());
  return readVolumes().reduce(function (sum, row) { return sum + row.numbers.length; }, 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const total = regenerate();
  console.log('已生成 docs/COMPLETION-REPORT.md（索引）：' + total + ' 节，分 ' + readVolumes().length + ' 卷');
}
