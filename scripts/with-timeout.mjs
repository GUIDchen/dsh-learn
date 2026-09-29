#!/usr/bin/env node
// 给 shell 脚本用的"带超时执行"：macOS 自带 bash 3.2 没有 timeout 命令，
// 而 kind / kubectl / docker 在守护进程卡死时会一直不返回（实测挂过 20 分钟）。
// 用法：node scripts/with-timeout.mjs <秒> <命令> [参数...]
// 超时会按进程组 SIGKILL，退出码 124（与 GNU timeout 一致）。
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const seconds = Number(args[0]);
const command = args[1];
const commandArgs = args.slice(2);
if (!seconds || !command) {
  console.error('用法：node scripts/with-timeout.mjs <秒> <命令> [参数...]');
  process.exit(2);
}

const child = spawn(command, commandArgs, { stdio: ['ignore', 'inherit', 'inherit'], detached: true });
let timedOut = false;
const timer = setTimeout(function () {
  timedOut = true;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (err) {
    try { child.kill('SIGKILL'); } catch (err2) { /* 已经退出 */ }
  }
}, seconds * 1000);

child.on('error', function (err) {
  clearTimeout(timer);
  console.error('[with-timeout] 无法启动 ' + command + '：' + err.message);
  process.exit(127);
});

child.on('close', function (code, signal) {
  clearTimeout(timer);
  if (timedOut) {
    console.error('[with-timeout] ' + command + ' 超过 ' + seconds + ' 秒未返回，已终止');
    process.exit(124);
  }
  if (signal) process.exit(1);
  process.exit(typeof code === 'number' ? code : 1);
});
