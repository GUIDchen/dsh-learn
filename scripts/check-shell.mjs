#!/usr/bin/env node
// 守住一个真实的坑：macOS 自带 bash 3.2 在解析变量后紧跟中文时，会把多字节字节吃进变量名，
// 于是 echo "集群 $NAME（…" 会报 unbound variable。检查所有 shell 脚本，发现就报错（--fix 补空格）。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIX = process.argv.indexOf('--fix') > -1;
const candidates = [];
readdirSync(join(ROOT, 'scripts')).filter(function (name) { return name.endsWith('.sh'); })
  .forEach(function (name) { candidates.push(join('scripts', name)); });
['app/macos/build.sh', 'app/macos/install.sh'].forEach(function (name) {
  if (existsSync(join(ROOT, name))) candidates.push(name);
});

const PATTERN = new RegExp('[$]([A-Za-z_][A-Za-z0-9_]*)(?=[^\\x00-\\x7F])', 'g');
let problems = 0;
let fixed = 0;

candidates.forEach(function (relative) {
  const file = join(ROOT, relative);
  const text = readFileSync(file, 'utf8');
  const hits = [];
  text.split(String.fromCharCode(10)).forEach(function (line, index) {
    PATTERN.lastIndex = 0;
    if (PATTERN.test(line)) hits.push({ line: index + 1, text: line.trim().slice(0, 80) });
  });
  if (!hits.length) return;
  problems += hits.length;
  if (FIX) {
    const repaired = text.replace(PATTERN, function (m, name) { return String.fromCharCode(36) + name + ' '; });
    writeFileSync(file, repaired);
    fixed += hits.length;
    console.log('已修复 ' + relative + '：' + hits.length + ' 处');
  } else {
    hits.forEach(function (hit) { console.log(relative + ':' + hit.line + '　变量后面紧跟非 ASCII 字符（bash 3.2 会把中文吃进变量名）：' + hit.text); });
  }
});

if (FIX) {
  console.log('合计修复 ' + fixed + ' 处');
  process.exit(0);
}
if (problems) {
  console.error('发现 ' + problems + ' 处；修法：node scripts/check-shell.mjs --fix');
  process.exit(1);
}
console.log('shell 脚本检查通过：没有「变量紧跟非 ASCII」的写法');
