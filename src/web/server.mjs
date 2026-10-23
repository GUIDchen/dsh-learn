// 客户端二：本机/局域网 Web 服务。
// 这个文件只做 HTTP 外壳：解析请求 → 静态资源 → API → 404。
// 静态资源实现在 ./static.mjs，接口实现在 ./api.mjs，两边都不需要知道对方存在。
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { detectPlatform, getProfile } from '../core/platform.mjs';
import { listTasks } from '../core/tasks.mjs';
import { parseArgs } from '../core/args.mjs';
import { serveStatic } from './static.mjs';
import { handleApi } from './api.mjs';
import { sendSmart } from './compress.mjs';
import { logEvent } from '../core/log.mjs';
import { isMain } from '../core/runtime.mjs';

// --help 只打印用法：之前它会真的起服务（端口被占时报 EADDRINUSE，看起来像自己配错了端口）
const argv = process.argv.slice(2);
// isMain(import.meta.url) 是函数声明（会提升），所以能在这里用；被当库 import 时即使命令行里有 --help 也不该打印用法
if (isMain(import.meta.url) && (argv.indexOf('--help') > -1 || argv.indexOf('-h') > -1)) {
  console.log('用法：node src/web/server.mjs [--host=127.0.0.1] [--port=8787]');
  console.log('');
  console.log('启动网页版（三栏界面 + PWA + 离线判定）。默认只监听回环，跨机访问必须显式 --host。');
  console.log('  DSH_LEARN_HOME  进度与笔记写哪儿（默认 ~/.dsh-learn）');
  console.log('  DSH_LEARN_PACKS 额外的题库目录（默认只加载内置包）');
  process.exit(0);
}
const args = parseArgs(process.argv.slice(2), ['host', 'port']);
const HOST = typeof args.host === 'string' ? args.host : (process.env.HOST || '127.0.0.1');
const PORT = Number(typeof args.port === 'string' ? args.port : (process.env.PORT || 8787));
const SERVER_PLATFORM = detectPlatform();
const MAX_BODY = 65536;
// 截图分析要传 base64 图片，单独给一条更大的上限；其他路由仍然是 64 KB（保住小请求体的安全属性）
// 大请求体：图片（base64 后动辄上百 KB）与批量数据（导入备份、离线队列一次性补传）都走它
const MAX_LARGE_BODY = 8 * 1024 * 1024;

// JSON 一律走 gzip 协商：题库 bootstrap 从 170KB 降到 20KB 上下
function sendJson(req, res, code, data) {
  const body = JSON.stringify(data);
  sendSmart(req, res, code, body, 'application/json; charset=utf-8');
}

function readBody(req, limit) {
  const max = limit || MAX_BODY;
  return new Promise(function (resolveBody, reject) {
    let size = 0;
    let aborted = false;
    const chunks = [];
    req.on('data', function (chunk) {
      if (aborted) return; // 已经拒绝，继续把剩余数据读掉，避免半截连接把响应也带走
      size += chunk.length;
      if (size > max) {
        aborted = true;
        const err = new Error('请求体过大（上限 ' + max + ' 字节）');
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch (err) {
        const bad = new Error('请求体不是合法 JSON');
        bad.statusCode = 400;
        reject(bad);
      }
    });
    req.on('error', reject);
  });
}

// 导出工厂函数：CLI 启动与测试都在同一份实现上运行，避免"测试里的服务端"和真实服务端分家。
export function createAppServer() {
  return createServer(async function (req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    // 请求埋点：记一行就能回答「哪条接口最慢、错误率多少」（/api/metrics 聚合它）
    const startedAt = Date.now();
    res.on('finish', function () {
      logEvent('info', 'http', { method: req.method, path: pathname, status: res.statusCode, ms: Date.now() - startedAt });
    });
    const context = {
      req: req,
      res: res,
      url: url,
      pathname: pathname,
      sendJson: function (res2, code, data) { return sendJson(req, res2, code, data); },
      readBody: readBody,
      readLargeBody: function () { return readBody(req, MAX_LARGE_BODY); },
      serverPlatform: SERVER_PLATFORM
    };

    try {
      // 静态资源与 API 都用 headersSent 判断"是否已经处理"，因为它们的内部实现里用的是裸 return
      serveStatic(context);
      if (res.headersSent) return;

      await handleApi(context);
      if (res.headersSent) return;

      sendJson(req, res, 404, { error: 'no route ' + pathname });
    } catch (err) {
      if (!res.headersSent) sendJson(req, res, err.statusCode || 400, { error: err.message });
    }
  });
}

// 父进程看门狗：桌面壳把父进程 pid 传进来（DSH_LEARN_PARENT_PID）。
// 父进程被 kill -9 或崩溃时不会走正常的清理逻辑，服务就会变成没人管的孤儿进程占着端口。
// 每 2 秒问一次"父进程还在吗"，不在了就自己退出。只在环境变量存在时启用，
// 免得有人把服务当守护进程跑时被误杀。
export function watchParent(pidValue, exit) {
  const pid = Number(pidValue);
  if (!pid || pid <= 0) return null;
  const timer = setInterval(function () {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (err) {
      alive = false;
    }
    if (!alive) {
      clearInterval(timer);
      exit();
    }
  }, 2000);
  timer.unref();
  return timer;
}

if (isMain(import.meta.url)) {
  // PORT 传 0 时让内核挑一个空闲端口，并把最终地址打印成机器可解析的一行：
  // macOS 桌面壳（app/macos）就是靠这行拿到地址的，避免两端各写一套找端口逻辑。
  const server = createAppServer().listen(PORT, HOST, function () {
    const address = this.address();
    const url = 'http://' + HOST + ':' + address.port;
    console.log('dsh-learn Web 客户端已启动：' + url);
    console.log('DSH_LEARN_URL=' + url);
    console.log('平台：' + getProfile(SERVER_PLATFORM).name + '　任务数：' + listTasks().length);
    if (HOST === '0.0.0.0') console.log('已监听所有网卡，局域网内其他设备可直接访问该地址（多客户端共用同一份进度）。');
  });
  watchParent(process.env.DSH_LEARN_PARENT_PID, function () {
    console.log('父进程已退出，服务随之停止。');
    server.close(function () { process.exit(0); });
  });
}
