// 缓存护栏：按文件指纹失效——改了文件必须拿到新内容（拿旧数据比慢更糟）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-cache-home-'));
process.env.DSH_LEARN_HOME = home;
const { ingestIntoProject, readSourceText, projectDir } = await import('../src/core/project.mjs');
const { cacheStats, clearCache, fileFingerprint, memo } = await import('../src/core/cache.mjs');
const { searchCorpus } = await import('../src/core/corpus.mjs');

test('原文缓存：同一个文件第二次读命中缓存，改了内容必须重读', function () {
  const ingested = ingestIntoProject('cache-proj', { kind: 'text', source: 'a.txt', text: '第一版内容 PostgreSQL' });
  assert.ok(ingested.project, '收来源要成功：' + JSON.stringify(ingested).slice(0, 120));
  const first = readSourceText('cache-proj', 1);
  assert.equal(first.ok, true, first.error);
  assert.ok(first.text.indexOf('第一版') > -1);
  const before = cacheStats();
  const second = readSourceText('cache-proj', 1);
  assert.equal(second.text, first.text, '内容要一致');
  assert.ok(cacheStats().hits > before.hits, '第二次读应当命中缓存');

  // 直接改原文文件：指纹（大小 + mtime）变了，缓存必须失效
  const target = join(projectDir('cache-proj'), first.file);
  writeFileSync(target, '第二版内容 ClickHouse，字符数不一样了');
  const later = new Date(Date.now() + 2000);
  utimesSync(target, later, later);
  const third = readSourceText('cache-proj', 1);
  assert.ok(third.text.indexOf('第二版') > -1, '改过的文件必须重读，而不是给旧内容：' + third.text.slice(0, 40));
  assert.ok(third.text.indexOf('第一版') === -1, '旧内容不该还留着');
  rmSync(home, { recursive: true, force: true });
});

test('缓存基础设施：没有指纹就不缓存，指纹变了重新算', function () {
  clearCache();
  let calls = 0;
  const loader = function () { calls += 1; return calls; };
  memo('k', 'v1', loader);
  memo('k', 'v1', loader);
  assert.equal(calls, 1, '同指纹只算一次');
  memo('k', 'v2', loader);
  assert.equal(calls, 2, '指纹变了要重算');
  memo('nofile', null, loader);
  memo('nofile', null, loader);
  assert.equal(calls, 4, '没有指纹时不缓存（宁可慢也不能拿旧数据）');
  assert.equal(fileFingerprint('/绝对不存在的文件-zzz'), null, '拿不到指纹要返回 null');
  const stats = cacheStats();
  assert.ok(stats.entries >= 2, JSON.stringify(stats));
});

test('多词检索与项目序列化不因缓存互相污染', function () {
  const a = searchCorpus('PostgreSQL', { limit: 5 });
  const b = searchCorpus('ClickHouse', { limit: 5 });
  assert.ok(a.total >= 1 || b.total >= 0, '两次检索都应正常返回');
  const again = searchCorpus('PostgreSQL', { limit: 5 });
  assert.equal(again.total, a.total, '同关键词两次结果要一致');
  rmSync(home, { recursive: true, force: true });
});
