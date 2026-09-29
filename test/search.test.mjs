// 搜索与资料收集的护栏：多引擎解析、依次回退、失败如实报、解析聚合。
// 全部用 fixture（注入 fetch）——不打外网，测试才能稳定跑。
import test from 'node:test';
import assert from 'node:assert/strict';

const search = await import('../src/core/search.mjs');

const BING_FIXTURE = [
  '<html><body><ol id="b_results">',
  '<li class="b_algo"><h2><a href="https://kubernetes.io/zh/docs/">Kubernetes 文档</a></h2>',
  '<p>Kubernetes 官方中文文档：教程、概念、参考。</p></li>',
  '<li class="b_algo"><h2><a href="https://example.com/a">示例 A</a></h2>',
  '<p>示例 A 的摘要</p></li>',
  '<li class="b_algo"><h2><a href="https://example.com/a">重复的 A</a></h2>',
  '<p>重复条目应该被去掉</p></li>',
  '</ol></body></html>'
].join(String.fromCharCode(10));

const DDG_FIXTURE = [
  '<div class="result">',
  '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fkubernetes.io%2Fdocs%2F&rut=abc">Kubernetes Docs</a>',
  '<a class="result__snippet">官方文档</a>',
  '</div>'
].join(String.fromCharCode(10));

function jsonResponse(body, status) {
  return {
    status: status === undefined ? 200 : status,
    text: async function () { return body; }
  };
}

test('Bing 结果解析：标题 / 链接 / 摘要，重复链接去重，limit 生效', function () {
  const rows = search.parseBingResults(BING_FIXTURE, { limit: 5 });
  assert.equal(rows.length, 2, '重复的 example.com/a 应被去掉：' + JSON.stringify(rows.map(function (r) { return r.url; })));
  assert.equal(rows[0].url, 'https://kubernetes.io/zh/docs/');
  assert.equal(rows[0].title, 'Kubernetes 文档');
  assert.ok(rows[0].snippet.indexOf('官方中文文档') > -1, rows[0].snippet);
  assert.equal(rows[1].title, '示例 A', '同链接保留第一条');
  assert.equal(search.parseBingResults(BING_FIXTURE, { limit: 1 }).length, 1, 'limit 要生效');
});

test('DuckDuckGo 结果解析：跳转链还原成真实地址', function () {
  assert.equal(search.unwrapResultUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fkubernetes.io%2Fdocs%2F&rut=abc'), 'https://kubernetes.io/docs/');
  assert.equal(search.unwrapResultUrl('https://example.com/plain'), 'https://example.com/plain', '普通链接原样返回');
  const rows = search.parseDuckDuckGoResults(DDG_FIXTURE, { limit: 5 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://kubernetes.io/docs/');
  assert.equal(rows[0].snippet, '官方文档');
});

test('引擎解析不出结果时退回通用解析（页面结构变了也不空手而归）', function () {
  const html = '<html><body><a href="https://example.com/x">X 文档</a></body></html>';
  assert.deepEqual(search.parseBingResults(html, { limit: 5 }), [], '前置：Bing 规则匹配不到');
  const rows = search.parseSearchResults(html, { engine: 'bing', limit: 5 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://example.com/x');
  assert.equal(rows[0].engine, 'generic');
});

test('多引擎依次回退：第一个失败就换下一个，失败原因逐个记下来', async function () {
  const calls = [];
  const result = await search.searchWeb('kubectl', {
    engines: ['bing', 'duckduckgo'],
    fetch: async function (url) {
      calls.push(url);
      if (url.indexOf('bing.com') > -1) throw new Error('connect ECONNREFUSED');
      return jsonResponse(DDG_FIXTURE);
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.engine, 'duckduckgo', '第二个引擎应当胜出');
  assert.equal(calls.length, 2, '两个引擎都要试过');
  assert.equal(result.tried[0].engine, 'bing');
  assert.equal(result.tried[0].ok, false);
  assert.ok(result.tried[0].reason.indexOf('ECONNREFUSED') > -1, result.tried[0].reason);
  assert.equal(result.tried[1].ok, true);
});

test('全部引擎失败时：ok=false 且说清每个引擎为什么失败', async function () {
  const result = await search.searchWeb('kubectl', {
    engines: ['bing', 'duckduckgo'],
    fetch: async function () { throw new Error('fetch failed'); }
  });
  assert.equal(result.ok, false);
  assert.ok(result.reason.indexOf('bing') > -1 && result.reason.indexOf('duckduckgo') > -1, result.reason);
  assert.ok(result.reason.indexOf('DSH_LEARN_SEARCH_ENDPOINT') > -1, '要给出替代方案：' + result.reason);
  assert.equal((await search.searchWeb('   ', { fetch: async function () { throw new Error('不该被调用'); } })).ok, false, '空搜索词直接拒');
});

test('验证页（反爬）不当成结果页：命中特征词就如实说被拦', async function () {
  const result = await search.searchWeb('kubectl', {
    engines: ['bing'],
    fetch: async function () {
      return jsonResponse('<html><body>请完成安全验证后继续访问 geetest</body></html>');
    }
  });
  assert.equal(result.ok, false);
  assert.ok(result.reason.indexOf('验证页') > -1, result.reason);
  assert.deepEqual(result.tried.map(function (row) { return row.engine; }), ['bing']);
});

test('research：搜 → 逐页抓 → 合并知识点与可练题；抓不到的页面如实记原因', async function () {
  const result = await search.research('kubectl rollout', {
    limit: 3,
    fetch: async function () { return jsonResponse(BING_FIXTURE); },
    fetchPage: async function (url) {
      if (url.indexOf('example.com') > -1) return { ok: false, reason: 'HTTP 404：页面正文没抓到' };
      return {
        ok: true,
        text: 'kubectl rollout restart deployment/web\nkubectl rollout status deployment/web\n',
        html: '<pre>kubectl rollout restart deployment/web</pre>'
      };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.searched, 2);
  assert.equal(result.fetched, 1, '一个成功一个失败');
  const bad = result.results.filter(function (row) { return !row.ok; });
  assert.equal(bad.length, 1);
  assert.ok(bad[0].reason.indexOf('404') > -1, '失败原因要留着：' + bad[0].reason);
  assert.ok(result.points.length > 0, '应当合并出知识点');
  assert.ok(result.tasks.length > 0, '应当给出可练题');
  // 默认不回传原文（几 MB 的页面塞进 JSON 会拖死界面）
  assert.equal(result.results.filter(function (row) { return row.text; }).length, 0);
  const kept = await search.research('kubectl rollout', {
    limit: 1,
    keepText: true,
    fetch: async function () { return jsonResponse(BING_FIXTURE); },
    fetchPage: async function () { return { ok: true, text: 'kubectl rollout restart deployment/web' }; }
  });
  assert.ok(kept.results[0].text, 'keepText=true 时要给原文（收进项目用）');
});

test('searchEndpoint：自定义端点优先于内置引擎', function () {
  assert.equal(search.searchEndpoint('bing', {}), 'https://www.bing.com/search?q=');
  assert.equal(search.searchEndpoint('custom', { endpoint: 'https://searx.example/search' }), 'https://searx.example/search');
  assert.equal(search.searchEndpoint('custom', {}), '', '没配端点时给空串（调用方会如实报错）');
});
