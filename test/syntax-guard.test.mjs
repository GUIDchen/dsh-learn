// 语法守卫：每个测试文件与源码文件都必须能通过 node --check。
//
// 为什么需要它：非 async 的 test 回调里写 await import(...) 会让**整个文件**报 SyntaxError
// （错误信息只说 "Unexpected reserved word"，很难定位），我被绊了三次。
// 逐文件 node --check 是最可靠的拦法：语法问题在跑用例之前就暴露，且不用自己写扫描器（写过，误报一堆）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function collect(dir, out) {
  readdirSync(dir).forEach(function (name) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { collect(full, out); return; }
    if (name.endsWith('.mjs')) out.push(full);
  });
  return out;
}

test('所有 .mjs 文件都能通过 node --check（语法错误不等到跑用例）', function () {
  const files = collect(join(ROOT, 'test'), []).concat(collect(join(ROOT, 'src'), []));
  assert.ok(files.length >= 40, '文件数量看起来不对：' + files.length);
  const bad = [];
  files.forEach(function (file) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      const first = String(result.stderr || '').split(String.fromCharCode(10)).filter(Boolean).slice(0, 3).join(' ');
      bad.push(file.replace(ROOT, '') + ' :: ' + first.slice(0, 120));
    }
  });
  assert.deepEqual(bad, [], '有语法错误的文件：' + bad.join(' | '));
});
