// 进程入口判断：node src/x.mjs 直接跑，还是被当库 import。
//
// 为什么单独一个模块：这个函数原来在 cli.mjs / server.mjs / agent.mjs 里各有一份，
// **三份完全相同**。复制出来的实现最怕「改一处忘另外两处」，所以收成一份。
// 注意：必须由调用方传 import.meta.url——函数自己拿不到调用者的模块地址。
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isMain(entryUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(entryUrl || import.meta.url);
  } catch (err) {
    return false;
  }
}
