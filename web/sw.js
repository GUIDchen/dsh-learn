// Service Worker：外壳走缓存（可离线打开），接口一律不缓存。
// 判定与进度都在服务端，离线时给出明确提示而不是假装成功。
//
// 缓存名里带版本号：服务端在发送这个文件时会把 __VERSION__ 换掉（见 src/web/static.mjs）。
// 这样每次发版都会换一个缓存桶，activate 阶段自然清掉上一版的残留资源，
// 不用再靠"后台悄悄刷新，下次打开才生效"来兜底。
const CACHE = 'dsh-learn-shell-__VERSION__';
// 判定内核也进缓存：断网时页面用同一份 judge.mjs 本地判分
const SHELL = [
  '/',
  '/index.html',
  '/app.mjs',
  '/format.mjs',
  '/pack.mjs',
  '/jobs.mjs',
  '/panels.mjs',
  '/onboarding.mjs',
  '/palette.mjs',
  '/theme.mjs',
  '/i18n.mjs',
  '/repo.mjs',
  '/trend.mjs',
  '/reminder.mjs',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/core/judge.mjs',
  '/core/platform.mjs',
  '/core/progress.mjs',
  // 知识点分析也是纯函数：断网时"粘贴 JD → 出知识点"照样可用
  '/core/knowledge.mjs'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 逐个下载：cache.addAll 只要有一个资源 404，整个安装就失败，
      // 结果就是"离线外壳整块失效"——单点资源不该有这种杀伤力。
      return Promise.all(SHELL.map(function (path) {
        return fetch(path, { cache: 'reload' }).then(function (response) {
          if (!response || !response.ok) throw new Error(path + ' -> HTTP ' + (response && response.status));
          return cache.put(path, response);
        }).catch(function (err) {
          console.warn('[sw] 预缓存失败（其余资源继续）：' + err.message);
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) { return caches.delete(key); }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // 接口不缓存：判定、进度、排行榜都必须是新鲜数据
  if (url.pathname.indexOf('/api/') === 0) {
    event.respondWith(
      fetch(request).catch(function () {
        return new Response(JSON.stringify({ error: '当前离线，判定与进度需要连接服务端' }), {
          status: 503,
          headers: { 'content-type': 'application/json; charset=utf-8' }
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) {
        // 命中缓存的同时后台刷新，下次打开拿到新版本
        fetch(request).then(function (response) {
          if (response && response.ok) caches.open(CACHE).then(function (cache) { cache.put(request, response.clone()); });
        }).catch(function () {});
        return cached;
      }
      return fetch(request).then(function (response) {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () {
        // 断网且没缓存：导航请求回落到外壳首页，其他请求如实 503
        if (request.mode === 'navigate') return caches.match('/index.html');
        return new Response(JSON.stringify({ error: '当前离线，且这个资源没有缓存' }), {
          status: 503,
          headers: { 'content-type': 'application/json; charset=utf-8' }
        });
      });
    })
  );
});
