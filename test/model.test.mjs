// 可选模型接入：默认离线、配了端点会真的调用、失败一定回退规则引擎。
// 用本地假服务器当"模型"，所以不依赖任何外部服务与 key。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { modelStatus, understandWithModel, mergeModelResult, buildModelRequest } = await import('../src/core/model.mjs');

function fakeServer(handler) {
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      let body = '';
      req.on('data', function (chunk) { body += String(chunk); });
      req.on('end', function () { handler(req, res, body); });
    });
    server.listen(0, '127.0.0.1', function () { resolve({ server: server, port: server.address().port }); });
  });
}

function completion(content) {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content: content } }] });
}

test('默认离线：没配端点时不发任何请求，来源是规则引擎', async function () {
  const status = modelStatus({});
  assert.equal(status.enabled, false);
  assert.equal(status.mode, '仅规则引擎（离线）');
  const out = await understandWithModel('招聘 Go 工程师，熟悉 docker build，本科，上海', { env: {} });
  assert.equal(out.source, 'rules');
  assert.ok(out.reason.indexOf('未配置') > -1, out.reason);
  assert.ok((out.understood.stack || []).length > 0, '规则引擎照样给出技术栈');
});

test('配了端点：真的会调用（带 Authorization），并把模型字段合并进来', async function () {
  let seen = null;
  const fake = await fakeServer(function (req, res, body) {
    seen = { url: req.url, auth: req.headers.authorization, body: body };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(completion('{"title":"Go 工程师","location":"上海","stack":["docker","kubectl"],"points":["容器构建"]}'));
  });
  const env = { DSH_LEARN_MODEL_ENDPOINT: 'http://127.0.0.1:' + fake.port + '/v1', DSH_LEARN_MODEL_NAME: 'fake-model', DSH_LEARN_MODEL_KEY: 'sk-test' };
  const out = await understandWithModel('招聘 Go 工程师，熟悉 docker build，本科，上海', { env: env });
  fake.server.close();
  assert.equal(out.source, 'model', '应当走模型：' + out.reason);
  assert.equal(out.model, 'fake-model');
  assert.equal(out.understood.title, 'Go 工程师');
  assert.deepEqual(out.understood.stack, ['docker', 'kubectl']);
  assert.ok(seen.url.indexOf('/chat/completions') > -1, '要打到 OpenAI 兼容路径：' + seen.url);
  assert.equal(seen.auth, 'Bearer sk-test', '要带上 key');
  assert.ok(JSON.parse(seen.body).model === 'fake-model');
});

test('模型坏了（返回不是 JSON）→ 回退规则引擎，并把原因带回来', async function () {
  const fake = await fakeServer(function (req, res) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(completion('抱歉，我无法处理'));
  });
  const out = await understandWithModel('招聘 Go 工程师，熟悉 docker build', { env: { DSH_LEARN_MODEL_ENDPOINT: 'http://127.0.0.1:' + fake.port + '/v1' } });
  fake.server.close();
  assert.equal(out.source, 'rules');
  assert.ok(out.reason.indexOf('回退') > -1, out.reason);
  assert.ok((out.understood.stack || []).length > 0, '回退后仍有规则引擎结果');
});

test('模型 500 → 回退；请求构造与字段合并都是纯函数，可单测', async function () {
  const fake = await fakeServer(function (req, res) { res.writeHead(500); res.end('boom'); });
  const out = await understandWithModel('运维工程师：nginx', { env: { DSH_LEARN_MODEL_ENDPOINT: 'http://127.0.0.1:' + fake.port + '/v1' } });
  fake.server.close();
  assert.equal(out.source, 'rules');
  assert.ok(out.reason.indexOf('HTTP 500') > -1, out.reason);
  const req = buildModelRequest('文本', { endpoint: 'http://x/v1', model: 'm' });
  assert.equal(req.url, 'http://x/v1/chat/completions');
  const merged = mergeModelResult({ title: '模型给的岗位' }, { title: '规则给的岗位', company: '甲', stack: ['nginx'] });
  assert.equal(merged.title, '模型给的岗位', '模型给了就用模型的');
  assert.equal(merged.company, '甲', '模型没给就保留规则的');
  assert.deepEqual(merged.stack, ['nginx']);
});
