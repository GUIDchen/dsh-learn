// 结构化日志与指标：写入/读取/坏行/轮转/汇总。
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const log = await import('../src/core/log.mjs');

test('写入与读取：一行一个事件，坏行如实计数', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-log-rd-'));
  log.logEvent('info', 'http', { method: 'GET', path: '/api/bootstrap', status: 200, ms: 12 }, { home: home });
  log.logEvent('warn', 'http', { method: 'POST', path: '/api/check', status: 400, ms: 30 }, { home: home });
  appendFileSync(log.logPath(home), '{\"half\"', 'utf8');   // 模拟进程被杀留下的半行
  const read = log.readEvents({ home: home, limit: 10 });
  assert.equal(read.events.length, 2, '坏行不该当事件');
  assert.equal(read.broken, 1, '坏行要计数');
  assert.equal(read.events[0].event, 'http');
  rmSync(home, { recursive: true, force: true });
});

test('汇总：请求量 / 错误率 / p50-p95 / 最常访问 / 事件分布', function () {
  const summary = log.summarizeEvents([
    { event: 'http', path: '/a', status: 200, ms: 10 },
    { event: 'http', path: '/a', status: 200, ms: 20 },
    { event: 'http', path: '/b', status: 500, ms: 40 },
    { event: 'check', taskId: 'go.env-check' }
  ]);
  assert.equal(summary.http.requests, 3);
  assert.equal(summary.http.errors, 1);
  assert.equal(summary.http.errorRate, 0.333);
  assert.equal(summary.http.p50ms, 20);
  assert.equal(summary.http.p95ms, 40);
  assert.deepEqual(summary.http.topPaths[0], { path: '/a', count: 2 });
  assert.equal(summary.byEvent.check, 1);
});

test('轮转：超过阈值就把当前文件挪成 .1，且只保留一代', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-log-rot-'));
  log.logEvent('info', 'first', {}, { home: home });
  log.logEvent('info', 'second', { pad: 'x'.repeat(400) }, { home: home, maxBytes: 50 });
  assert.equal(existsSync(log.logPath(home) + '.1'), true, '应当留下上一代');
  assert.ok(readFileSync(log.logPath(home), 'utf8').indexOf('second') > -1, '新事件在新文件里');
  assert.ok(readFileSync(log.logPath(home) + '.1', 'utf8').indexOf('first') > -1, '旧事件在 .1 里');
  rmSync(home, { recursive: true, force: true });
});

test('写日志失败不影响主流程（只读目录下返回 null）', function () {
  const home = mkdtempSync(join(tmpdir(), 'dsh-log-ro-'));
  // 直接验证「异常被吞掉」：传一个非法 home（含非法字符的路径写不进去）
  const result = log.logEvent('info', 'x', {}, { home: join(home, 'nested', '\u0000bad') });
  assert.equal(result, null, '日志失败必须返回 null 而不是抛错');
  rmSync(home, { recursive: true, force: true });
});
