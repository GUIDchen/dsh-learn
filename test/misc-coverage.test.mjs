// 补几条覆盖：静态资源 404 分支、以及 show --json 带「其他平台写法」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-learn-misc-'));
process.env.DSH_LEARN_HOME = HOME;
const { createAppServer } = await import('../src/web/server.mjs');
const server = createAppServer();
await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
const BASE = 'http://127.0.0.1:' + server.address().port;

test('静态资源：不存在的路径给 404，且不泄露目录', async function () {
  const res = await fetch(BASE + '/no/such/file.js');
  assert.equal(res.status, 404);
  const text = await res.text();
  assert.equal(/\/Users\//.test(text), false, '404 页面不该带本机绝对路径：' + text.slice(0, 80));
});

test('show --json：变体题要带其他平台写法', async function () {
  const { createContext } = await import('../src/cli/context.mjs');
  const { show } = await import('../src/cli/commands/tasks.mjs');
  const logs = [];
  const original = console.log;
  console.log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  try {
    await show(createContext(['show', 'linux.stat-size', '--json']));
  } finally {
    console.log = original;
  }
  const payload = JSON.parse(logs.join('\n'));
  const others = payload.otherPlatforms;
  // 形状是 {平台: 参考答案} 的对象：与网页版 bootstrap 的 task.others、以及命令行三处保持一致
  assert.equal(Array.isArray(others), false, 'otherPlatforms 应是对象而不是数组：' + JSON.stringify(others));
  assert.ok(others && Object.keys(others).length > 0, '变体题应带其他平台写法：' + JSON.stringify(others));
  assert.equal(others[payload.platform], undefined, '不该把自己平台的写法列进去');
  Object.keys(others).forEach(function (platform) {
    assert.equal(typeof others[platform], 'string');
    assert.ok(others[platform].length > 0, platform + ' 的参考答案不能为空');
  });
});

test.after(function () {
  server.close();
  rmSync(HOME, { recursive: true, force: true });
});
