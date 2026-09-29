// 静态资源：网页外壳、PWA 资源、判定内核模块。
// 与 API 分开，是为了让"浏览器要什么文件"和"接口返回什么数据"各自独立可读。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendSmart } from './compress.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// 网页外壳的缓存名带版本号：发版即换桶，旧缓存由 SW 的 activate 清掉。
// 注意要放在 HERE 之后：常量在定义之前读会被 TDZ 拦住，兜底成 dev 就悄悄失去了版本语义。
export const APP_VERSION = (function () {
  try {
    return JSON.parse(readFileSync(join(HERE, '../../package.json'), 'utf8')).version || 'dev';
  } catch (err) {
    return 'dev';
  }
})();
export const WEB_DIR = join(HERE, '../../web');
const PAGE = join(WEB_DIR, 'index.html');

// 返回 true 表示这个请求已经被静态资源处理掉了。
export function serveStatic(c) {
  const { req, res, url, pathname, sendJson } = c;
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      sendSmart(req, res, 200, readFileSync(PAGE), 'text/html; charset=utf-8');
      return;
    }

    // 网页版的逻辑（web/app.mjs）：单独一个文件，便于语法检查与复用。
    // 把版本号注入进去：Service Worker 会优先用缓存里的外壳，页面因此能自己发现
    // "我这份脚本是旧版本的"（缓存里的脚本说 0.45.0、服务端已经 0.46.0），进而主动更新并重载。
    // web/ 下的所有模块（app.mjs 是入口，format.mjs 等是可复用模块）：浏览器原生 ESM，不需要打包器。
    // 之前只特判了 app.mjs，新增 format.mjs 后直接 404——页面整个模块加载失败、任务列表空白；
    // 现在按"路径就是文件名"统一服务，新增模块不用再改这里。
    if (req.method === 'GET' && /^\/[a-z0-9-]+\.mjs$/.test(pathname)) {
      const name = pathname.slice(1);
      const file = join(WEB_DIR, name);
      if (!existsSync(file)) {
        sendJson(res, 404, { error: 'no such module' });
        return;
      }
      // 版本号注入：SW 靠它发现"缓存里的脚本是旧版本的"并主动更新
      const body = readFileSync(file, 'utf8').replace(/__VERSION__/g, APP_VERSION);
      sendSmart(req, res, 200, body, 'text/javascript; charset=utf-8', { 'cache-control': 'no-cache' });
      return;
    }

    // PWA 资源：网页版可安装到桌面 / 主屏幕；sw.js 决定离线行为
    if (req.method === 'GET' && pathname === '/manifest.webmanifest') {
      sendSmart(req, res, 200, readFileSync(join(WEB_DIR, 'manifest.webmanifest')), 'application/manifest+json; charset=utf-8');
      return;
    }

    // 判定内核直接以 ES 模块提供给浏览器：断网时页面用同一份 judge.mjs 本地判分
    if (req.method === 'GET' && pathname.indexOf('/core/') === 0) {
      const name = pathname.slice('/core/'.length);
      if (!/^[a-z-]+\.mjs$/.test(name)) {
        sendJson(res, 404, { error: 'no such module' });
        return;
      }
      const file = join(HERE, '../core', name);
      if (!existsSync(file)) {
        sendJson(res, 404, { error: 'no such module' });
        return;
      }
      sendSmart(req, res, 200, readFileSync(file), 'text/javascript; charset=utf-8', { 'cache-control': 'no-cache' });
      return;
    }

    if (req.method === 'GET' && pathname === '/sw.js') {
      // 注入版本号：缓存桶随发版变化，避免旧外壳一直粘着
      const swBody = readFileSync(join(WEB_DIR, 'sw.js'), 'utf8').replace(/__VERSION__/g, APP_VERSION);
      sendSmart(req, res, 200, swBody, 'text/javascript; charset=utf-8', {
        'service-worker-allowed': '/',
        'cache-control': 'no-cache'
      });
      return;
    }

    if (req.method === 'GET' && pathname.indexOf('/icons/') === 0) {
      const name = pathname.slice('/icons/'.length);
      // 只允许 icon-<数字>.png，杜绝目录穿越
      if (!/^icon-\d+\.png$/.test(name)) {
        sendJson(res, 404, { error: 'no such icon' });
        return;
      }
      const body = readFileSync(join(WEB_DIR, 'icons', name));
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      res.end(body);
      return;
    }
  return false;
}
