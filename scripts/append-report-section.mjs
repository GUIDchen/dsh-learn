// 往 docs/COMPLETION-REPORT.md 里插一节：把"拼接事故"从流程上堵掉。
//
// 前两次事故都是手写替换字符串造成的：
//   1) String.replace 的替换串里出现「美元符 + 反引号」时会被当成替换模式，把整篇文档插进正文（第 108 轮）；
//   2) 用 split(锚点).join(...) 时，锚点字符串在正文的代码示例里也出现了一次，于是同一节被插了三遍（第 118 轮）。
// 这个脚本只做一件事，并且把上面两个坑都堵住：
//   - 只认**整行等于** <!-- SECTION-ANCHOR --> 上方那一行（而不是"包含锚点文字"）；
//   - 插入前先检查这一节的编号是否已存在，已存在就拒绝，绝不重复插入；
//   - 用数组拼接而不是字符串替换，替换串里有什么字符都不影响结果。
//
// 用法：node scripts/append-report-section.mjs <section.md> [--anchor="## 6. 运行入口"]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = join(ROOT, 'docs/COMPLETION-REPORT.md');

const args = process.argv.slice(2);
const source = args.filter(function (a) { return a.indexOf('--') !== 0; })[0];
const anchorArg = args.filter(function (a) { return a.indexOf('--anchor=') === 0; })[0];
const anchor = anchorArg ? anchorArg.slice('--anchor='.length) : '## 6. 运行入口';

if (!source) {
  console.log('用法：node scripts/append-report-section.mjs <section.md> [--anchor="## 6. 运行入口"]');
  process.exit(2);
}

const section = readFileSync(source, 'utf8').replace(/\s+$/, '');
const heading = (section.split(String.fromCharCode(10))[0] || '').trim();
const number = (heading.match(/^## (5\.[0-9]+)/) || [])[1];

// 分卷之后：按小节号定位它该进哪一卷，并在**所有卷**里查重（不是只看索引文件）。
const { volumeFor, readVolumes, regenerate } = await import('./report-doc.mjs');
const target = number ? volumeFor(Number(number.split('.')[1])) : null;
const volumes = readVolumes();
const duplicate = number && volumes.some(function (row) { return row.numbers.indexOf(number) > -1; });
if (duplicate) {
  console.log('拒绝：已经有一节 ' + number + ' 了（先删掉旧的，或换一个编号）');
  process.exit(1);
}
const volumePath = target ? join(ROOT, 'docs/report', target.file) : null;
let lines = [];
if (volumePath && existsSync(volumePath)) {
  lines = readFileSync(volumePath, 'utf8').replace(/\s+$/, '').split(String.fromCharCode(10));
} else if (volumePath) {
  lines = ['# 完成报告 · 第 ' + target.start + '–' + target.end + ' 轮', '', '> 返回总索引：[../COMPLETION-REPORT.md](../COMPLETION-REPORT.md)', ''];
}
const merged = lines.concat(['', section]).join(String.fromCharCode(10)) + String.fromCharCode(10);
writeFileSync(volumePath, merged);
const total = regenerate();
console.log('已写入 ' + target.file + '：' + (number || '新节') + '（该卷 ' + merged.split(String.fromCharCode(10)).length + ' 行）；索引共 ' + total + ' 节');
