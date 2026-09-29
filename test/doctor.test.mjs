// 数据体检：能查出坏元数据 / 缺原文 / 陈旧索引 / 孤儿记录；修复只做能重算的事。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-doctor-home-'));
process.env.DSH_LEARN_HOME = home;
const project = await import('../src/core/project.mjs');
const { runDoctor, fixDoctor } = await import('../src/core/doctor.mjs');
const store = await import('../src/store.mjs');

function kinds(findings) { return findings.map(function (f) { return f.kind; }); }

test('体检：缺原文 / 缺索引 / 坏元数据 / 陈旧索引 / 孤儿记录都能查出来', function () {
  // 1) 一个正常项目，但索引被删掉；来源没有原文（模拟旧数据）
  project.createProject('doc-a', {});
  const metaA = project.readProject('doc-a');
  metaA.sources = [{ kind: 'text', source: 'a/jd.txt', at: new Date().toISOString() }];
  writeFileSync(join(home, 'projects', 'doc-a', 'project.json'), JSON.stringify(metaA, null, 2));
  rmSync(join(home, 'projects', 'doc-a', 'tasks.json'), { force: true });
  // 2) 坏元数据
  project.createProject('doc-b', {});
  writeFileSync(join(home, 'projects', 'doc-b', 'project.json'), '{ 这不是 JSON');
  // 3) 孤儿练习记录（题号不在题库里）
  store.record({ client: 'test', taskId: 'no.such-task-zzz', score: 100, verdict: '通过', platform: 'darwin' });
  const result = runDoctor({});
  const all = kinds(result.findings);
  assert.ok(all.indexOf('old-source') > -1, '要查出缺原文：' + JSON.stringify(all));
  assert.ok(all.indexOf('index-missing') > -1, '要查出缺索引：' + JSON.stringify(all));
  assert.ok(all.indexOf('meta-broken') > -1, '要查出坏元数据：' + JSON.stringify(all));
  assert.ok(all.indexOf('record-unknown-task') > -1, '要查出孤儿记录：' + JSON.stringify(all));
  const broken = result.findings.filter(function (f) { return f.kind === 'meta-broken'; })[0];
  assert.equal(broken.level, 'error', '坏元数据要算错误');
  assert.equal(broken.fix, null, '坏元数据不敢自动修');
  assert.ok(result.markdown.indexOf('| 级别 | 范围 | 对象 | 说明 | 可修 |') > -1, '报告要成表');
});

test('体检：陈旧索引能查出来（索引早于元数据更新）', function () {
  project.createProject('doc-c', {});
  const meta = project.readProject('doc-c');
  meta.sources = [{ kind: 'text', source: 'c/jd.txt', at: new Date().toISOString(), textFile: 'sources/0001-x.txt', points: [] }];
  mkdirSync(join(home, 'projects', 'doc-c', 'sources'), { recursive: true });
  writeFileSync(join(home, 'projects', 'doc-c', 'sources', '0001-x.txt'), '任职要求：熟悉 Kubernetes');
  meta.updatedAt = '2030-01-02T00:00:00.000Z';
  writeFileSync(join(home, 'projects', 'doc-c', 'project.json'), JSON.stringify(meta, null, 2));
  // 先建一次索引（generatedAt 是现在），再把元数据的 updatedAt 推到未来 → 索引显得陈旧
  project.buildProjectIndex('doc-c');
  const result = runDoctor({});
  const stale = result.findings.filter(function (f) { return f.kind === 'index-stale'; });
  assert.equal(stale.length, 1, '要查出陈旧索引：' + JSON.stringify(kinds(result.findings)));
  assert.equal(stale[0].fix, 'rebuild-index');
});

test('修复：只做能重算的事（重建索引），坏元数据仍然只报告', function () {
  const before = runDoctor({});
  assert.ok(before.stats.fixable > 0, '要有可修的：' + JSON.stringify(before.stats));
  const after = fixDoctor({});
  assert.ok(after.fixed.length > 0, '要真的修了东西：' + JSON.stringify(after.fixed));
  const rebuilt = after.fixed.filter(function (row) { return row.action === 'rebuild-index'; });
  assert.ok(rebuilt.length > 0, '至少重建过一次索引：' + JSON.stringify(after.fixed));
  assert.ok(existsSync(join(home, 'projects', 'doc-c', 'tasks.json')), '索引文件要在');
  const metaBroken = after.findings.filter(function (f) { return f.kind === 'meta-broken'; });
  assert.equal(metaBroken.length, 1, '坏元数据只能报告，修不了：' + JSON.stringify(kinds(after.findings)));
  assert.ok(after.after.total <= before.stats.total, '修完发现数不该变多：' + before.stats.total + ' → ' + after.after.total);
  rmSync(home, { recursive: true, force: true });
});
