#!/usr/bin/env node
// 最小的压测靶机：零依赖，只有一个 /health 接口。
// 用途：让 perf 类题目（wrk / ab / curl 探测）有真的东西可压，而不是对着空气练。
// 用法：node scripts/load-target.mjs [--port 8899] [--host 127.0.0.1]
import { createServer } from 'node:http';

const args = process.argv.slice(2);
function argOf(name, fallback) {
  const hit = args.filter(function (item) { return item.indexOf('--' + name + '=') === 0; })[0];
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}
const HOST = argOf('host', '127.0.0.1');
const PORT = Number(argOf('port', '8899'));

let served = 0;
const server = createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  served += 1;
  if (url.pathname === '/health') {
    const body = JSON.stringify({ status: 'ok', served: served, method: req.method });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  if (url.pathname === '/slow') {
    // 固定 50ms 延迟：给"看 P95 与吞吐"类练习用（不引入随机性，压测结果才可复现）
    setTimeout(function () {
      const body = JSON.stringify({ status: 'slow', served: served });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    }, 50);
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'content-length': 13 });
  res.end('{"error":"404"}');
});

server.listen(PORT, HOST, function () {
  const address = server.address();
  console.log('压测靶机已启动：http://' + HOST + ':' + address.port);
  console.log('TARGET_URL=http://' + HOST + ':' + address.port);
  console.log('接口：/health（立即返回） /slow（固定 50ms 延迟）');
});
