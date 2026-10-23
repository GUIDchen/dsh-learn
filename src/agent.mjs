// 远程只读 agent：把一台机器（例如 Linux 主机）变成可被调度的验证节点。
// 安全规则：默认只监听回环；绑定非回环时强制要求 token；无论谁调用都重新校验白名单。
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowed, runReadonlyCommand } from './core/exec.mjs';
import { detectPlatform, getProfile } from './core/platform.mjs';
import { parseArgs } from './core/args.mjs';
import { isMain } from './core/runtime.mjs';

function sameToken(a, b) {
  const left = createHash('sha256').update(String(a || '')).digest();
  const right = createHash('sha256').update(String(b || '')).digest();
  return timingSafeEqual(left, right);
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

const MAX_BODY = 16384;

function readBody(req) {
  return new Promise(function (resolveBody, reject) {
    let size = 0;
    let aborted = false;
    const chunks = [];
    req.on('data', function (chunk) {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        // 与 Web 服务端保持一致：不 destroy（那会让客户端只看到 socket closed），
        // 而是标记已拒绝、继续把剩余数据读掉，最后统一回 413。
        aborted = true;
        const err = new Error('请求体过大（上限 ' + MAX_BODY + ' 字节）');
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

export function createAgentServer(options) {
  const opts = options || {};
  const token = opts.token || '';
  const platform = detectPlatform(opts.platform);
  const log = opts.log || function () {};

  return createServer(async function (req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/agent/health') {
        sendJson(res, 200, {
          ok: true,
          platform: platform,
          profile: getProfile(platform).name,
          requiresToken: Boolean(token),
          node: process.version
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/agent/exec') {
        const body = await readBody(req);
        const remote = req.socket.remoteAddress || '';
        if (token && !sameToken(body.token, token)) {
          log({ event: 'reject', reason: 'token 不匹配', remote: remote, cmd: body.cmd });
          sendJson(res, 401, { ok: false, ran: false, reason: 'token 不匹配，已拒绝执行' });
          return;
        }
        if (!isAllowed(body.cmd)) {
          log({ event: 'reject', reason: '不在只读白名单', remote: remote, cmd: body.cmd });
          sendJson(res, 403, { ok: false, ran: false, reason: '该命令不在只读白名单内，已拒绝执行' });
          return;
        }
        const result = await runReadonlyCommand(body.cmd, { run: Boolean(body.run), timeout: opts.timeout });
        log({ event: 'exec', remote: remote, cmd: body.cmd, ran: result.ran, ok: result.ok });
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { ok: false, reason: 'no route ' + url.pathname });
    } catch (err) {
      if (!res.headersSent) sendJson(res, err.statusCode || 400, { ok: false, reason: err.message });
    }
  });
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  // --help 就该只打印用法：之前它会去起服务（端口被占时还会报 EADDRINUSE，让人以为是自己端口配错了）
  if (argv.indexOf('--help') > -1 || argv.indexOf('-h') > -1) {
    console.log('用法：node src/agent.mjs [--host=127.0.0.1] [--port=8790] [--token=口令]');
    console.log('');
    console.log('在另一台机器上执行题库里的**只读**验证命令，供客户端用 --runner=remote 调度。');
    console.log('  接口：GET  /agent/health   平台与鉴权状态');
    console.log('        POST /agent/exec     体 { cmd, token, run }，run 为真才真的执行');
    console.log('  约束：命令必须在只读白名单内（403 拒绝）、请求体不超过 16 KB（413）、');
    console.log('        token 只从请求体读；绑定非回环地址时没有 token 直接拒绝启动。');
    process.exit(0);
  }
  const args = parseArgs(process.argv.slice(2), ['host', 'port', 'token']);
  const HOST = typeof args.host === 'string' ? args.host : '127.0.0.1';
  const PORT = Number(typeof args.port === 'string' ? args.port : (process.env.AGENT_PORT || 8790));
  const TOKEN = typeof args.token === 'string' ? args.token : (process.env.AGENT_TOKEN || '');
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !TOKEN) {
    console.error('拒绝启动：绑定非回环地址必须提供 --token，否则任何能访问该端口的人都能执行白名单内的命令。');
    process.exit(2);
  }
  const server = createAgentServer({
    token: TOKEN,
    log: function (entry) {
      console.log('[' + new Date().toISOString() + '] ' + JSON.stringify(entry));
    }
  });
  server.listen(PORT, HOST, function () {
    const profile = getProfile(detectPlatform());
    console.log('dsh-learn agent 已启动：http://' + HOST + ':' + PORT);
    console.log('平台：' + profile.name + '　鉴权：' + (TOKEN ? '需要 token' : '无 token（仅建议回环使用）'));
    console.log('对外接口：GET /agent/health　POST /agent/exec　（只放行只读白名单命令）');
  });
}
