// 逐文件扫描测试：把「某个测试文件在模块加载阶段挂住」这种问题点名出来。
//
// 为什么需要它：node --test 的 --test-timeout 管不到模块加载阶段的挂起
//（本会话实测：store 拆模块时漏了一个 node:fs 导入，某几个测试文件在 import 阶段就卡死，
//  整个套件只输出 37 条 ✔ 然后永远停住，而 --test-timeout=20000 也救不回来）。
//
// 用法：node scripts/scan-tests.mjs [超时毫秒，默认 25000]
// 输出：HANG / FAIL / slow 三类，最后打印扫描了多少个文件。
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LIMIT = Math.max(2000, Number(process.argv[2]) || 25000);
const files = readdirSync(join(ROOT, 'test')).filter(function (f) { return f.endsWith('.test.mjs'); }).sort();

let hangs = 0;
let fails = 0;
const slow = [];
for (const file of files) {
  const started = Date.now();
  const child = spawn(process.execPath, ['--test', join(ROOT, 'test', file)], { stdio: 'ignore' });
  const outcome = await new Promise(function (resolve) {
    const timer = setTimeout(function () { resolve('hang'); }, LIMIT);
    child.on('exit', function (code) { clearTimeout(timer); resolve(code === 0 ? 'ok' : 'fail'); });
  });
  const ms = Date.now() - started;
  if (outcome === 'hang') { hangs += 1; console.log('HANG\t' + file + '\t>' + ms + 'ms'); child.kill('SIGKILL'); }
  else if (outcome === 'fail') { fails += 1; console.log('FAIL\t' + file + '\t' + ms + 'ms'); }
  else if (ms > 8000) { slow.push(file); console.log('slow\t' + file + '\t' + ms + 'ms'); }
}
console.log('扫描完成：' + files.length + ' 个文件，挂起 ' + hangs + ' 个，失败 ' + fails + ' 个，偏慢 ' + slow.length + ' 个');
process.exit(hangs || fails ? 1 : 0);
