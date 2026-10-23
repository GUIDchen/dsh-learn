// 测试卫生：启动了服务端的测试文件必须注册 test.after 收尾。
//
// 为什么需要这条：本会话尝试把 server.test.mjs 按域拆成两个文件，domain 文件一开始忘了 test.after，
// 结果 15 条用例全部通过、进程却永远不退出（HTTP server 句柄把事件循环挂住），
// 表现出来就是 CI/验收卡死而不是测试失败——最坏的一类失败（不报错、只是挂着）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST_DIR = join(ROOT, 'test');

test('启动服务端的测试文件必须注册 test.after 收尾（否则进程会挂着）', function () {
  const files = readdirSync(TEST_DIR).filter(function (name) { return name.endsWith('.test.mjs'); });
  const problems = [];
  files.forEach(function (name) {
    const text = readFileSync(join(TEST_DIR, name), 'utf8');
    const bootsServer = text.indexOf('createAppServer') > -1 || text.indexOf('helpers/server.mjs') > -1;
    if (!bootsServer) return;
    if (text.indexOf('test.after') === -1) problems.push(name);
  });
  assert.deepEqual(problems, [], '这些测试文件启动了服务端却没写 test.after（进程会挂住）：' + problems.join(', '));
});
