// 项目目录与仓库解析的回归：这是「把别人的项目变成自己的题」的入口，必须有实测护栏。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePack } from '../src/core/schema.mjs';
import { isAllowed } from '../src/core/exec.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-learn-project-'));
process.env.DSH_LEARN_HOME = HOME;

const project = await import('../src/core/project.mjs');
const repoLearn = await import('../src/core/repo-learn.mjs');

// 造一个迷你仓库：Dockerfile / compose / k8s / CI / Makefile / go.mod / 脚本 / README 命令块
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-learn-repo-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  mkdirSync(join(dir, 'deploy'));
  writeFileSync(join(dir, 'README.md'), [
    '# demo-service',
    '',
    '本地起服务：',
    '',
    '    docker build -t demo:1.0 .',
    '    docker run -d --name demo -p 8080:8080 demo:1.0',
    '',
    '跑测试：',
    '',
    '    go test -race ./...',
    '    kubectl rollout status deploy/demo -n demo'
  ].join('\n'));
  writeFileSync(join(dir, 'Dockerfile'), 'FROM golang:1.22-alpine AS build\n');
  writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  api:\n    build: .\n');
  writeFileSync(join(dir, 'go.mod'), 'module example.com/demo\n\ngo 1.22\n');
  writeFileSync(join(dir, 'Makefile'), 'test:\n\tgo test ./...\n');
  writeFileSync(join(dir, 'scripts/deploy.sh'), '#!/bin/sh' + String.fromCharCode(10) + 'kubectl apply -f deploy/' + String.fromCharCode(10));
  writeFileSync(join(dir, 'deploy/deployment.yaml'), 'apiVersion: apps/v1' + String.fromCharCode(10) + 'kind: Deployment' + String.fromCharCode(10));
  writeFileSync(join(dir, '.github/workflows/ci.yml'), 'name: ci' + String.fromCharCode(10) + 'on: [push]' + String.fromCharCode(10));
  return dir;
}

test('项目目录：建立、记录来源、越界写入被拦住', function () {
  const created = project.createProject('demo-service');
  assert.equal(created.ok, true);
  assert.ok(existsSync(join(created.dir, 'drafts')) && existsSync(join(created.dir, 'notes')), '要有 drafts/ 与 notes/');
  assert.equal(project.createProject('demo-service').ok, false, '重名要拒绝，而不是覆盖');

  project.recordSource('demo-service', { kind: 'text', source: 'JD 片段', knowledge: 3, tasks: 0, artifacts: ['notes/a.md'] });
  const meta = project.readProject('demo-service');
  assert.equal(meta.sources.length, 1);
  assert.equal(meta.sources[0].kind, 'text');

  const written = project.writeProjectFile('demo-service', 'notes/a.md', 'hello');
  assert.equal(readFileSync(written, 'utf8'), 'hello');
  assert.throws(function () { project.writeProjectFile('demo-service', '../../escape.md', 'x'); }, /越出项目目录/);

  const all = project.listProjects({});
  assert.ok(all.some(function (row) { return row.name === 'demo-service'; }));
});

test('仓库扫描：识别技术信号、匹配知识点、抽命令出草案', function () {
  const dir = makeRepo();
  const result = repoLearn.analyzeRepo(dir, { limit: 8 });
  const ids = result.scan.signals.map(function (s) { return s.id; });
  ['dockerfile', 'compose', 'k8s', 'ci', 'make', 'go', 'shell'].forEach(function (id) {
    assert.ok(ids.indexOf(id) > -1, '应识别出 ' + id + '，实际：' + ids.join(','));
  });
  assert.ok(result.knowledge.matched > 0, '仓库画像应匹配到知识点');
  assert.ok(result.draft.stats.tasks > 0, 'README/Makefile 里的命令应被抽成草案');
  const samples = result.draft.pack.tasks.map(function (task) { return task.sample; }).join(' | ');
  assert.match(samples, /docker build/);
  assert.match(samples, /go test/);

  // 草案必须至少是 schema 合法的：不然人工改到一半才发现结构不对
  const check = validatePack(result.draft.pack, { isAllowedCommand: isAllowed });
  assert.deepEqual(check.errors, [], '草案包应通过 schema 校验：' + check.errors.join('；'));
  assert.ok(result.draft.pack.id.indexOf('repo-') === 0, '仓库草案包名要有 repo- 前缀：' + result.draft.pack.id);
  rmSync(dir, { recursive: true, force: true });
});

test('解析结果能写进项目目录：notes 摘要 + drafts 草案 + 来源记账', function () {
  const dir = makeRepo();
  const result = repoLearn.analyzeRepo(dir, { limit: 6 });
  const stamp = String(Date.now());
  const noteRel = 'notes/repo-' + stamp + '.md';
  project.writeProjectFile('demo-service', noteRel, '# 仓库摘要\n', {});
  const packRel = 'drafts/repo-' + stamp + '.json';
  project.writeProjectFile('demo-service', packRel, JSON.stringify(result.draft.pack, null, 2) + '\n', {});
  project.recordSource('demo-service', {
    kind: 'repo', source: dir, knowledge: result.knowledge.matched, tasks: result.draft.stats.tasks, artifacts: [noteRel, packRel]
  });
  const meta = project.readProject('demo-service');
  const last = meta.sources[meta.sources.length - 1];
  assert.equal(last.kind, 'repo');
  assert.ok(last.knowledge > 0 && last.tasks > 0);
  assert.ok(existsSync(join(project.projectDir('demo-service'), packRel)));
  rmSync(dir, { recursive: true, force: true });
});

test('项目里的知识点能映射成开练清单', function () {
  const created = project.createProject('drill-project-' + Date.now());
  const name = created.meta.name;
  project.recordSource(name, { kind: 'text', source: 'JD', knowledge: 2, tasks: 0, points: ['docker.run', 'netops.dns'], artifacts: [] });
  const listed = project.projectTaskList(name);
  assert.deepEqual(listed.points.slice().sort(), ['docker.run', 'netops.dns']);
  assert.ok(listed.tasks.length > 0, '这两个知识点都挂了题，应能开出清单');
  assert.equal(listed.sourcesWithPoints, 1);

  // 旧记录（没有 points）不该崩，只是贡献不了清单
  const legacy = project.createProject('legacy-project-' + Date.now());
  project.recordSource(legacy.meta.name, { kind: 'text', source: '老记录', knowledge: 5, tasks: 0, artifacts: [] });
  const legacyListed = project.projectTaskList(legacy.meta.name);
  assert.deepEqual(legacyListed.tasks, []);
  assert.equal(legacyListed.sourcesWithoutPoints, 1);

  assert.equal(project.projectTaskList('不存在的项目'), null);
});

test('知识点 id 提取：去重、容忍空报告', function () {
  const report = {
    modules: [
      { points: [{ id: 'docker.run' }, { id: 'go.build' }] },
      { points: [{ id: 'docker.run' }, { id: 'netops.dns' }] }
    ]
  };
  assert.deepEqual(project.pointIdsFromReport(report), ['docker.run', 'go.build', 'netops.dns']);
  assert.deepEqual(project.pointIdsFromReport({}), []);
  assert.deepEqual(project.pointIdsFromReport(null), []);
});

// 链接来源拿到的是一整页 HTML。曾经这里有个真 bug：知识点用剥过标签的文本、命令抽取却拿到原始 HTML，
// 于是"从网页抽命令生成草案题"对**任何网页**都失效（静默失败，只提示"没抽到命令"）。
test('网页 HTML 输入：只剥一次标签，知识点与草案题都要出得来', function () {
  const name = 'html-ingest-' + Date.now();
  project.createProject(name);
  const html = [
    '<html><head><style>body{color:red}</style><script>var x=1;</script></head><body>',
    '<h1>运维排查手记</h1>',
    '<p>起服务：</p>',
    '<pre>docker run -d -p 8080:80 --name web nginx:1.25</pre>',
    '<pre>kubectl rollout undo deployment/api --to-revision=3</pre>',
    '<pre>tcpdump -i eth0 -nn -c 100 port 80</pre>',
    '</body></html>'
  ].join('');
  const done = project.ingestIntoProject(name, { kind: 'link', source: 'http://example.com/ops', text: html }, {});
  assert.ok(done.knowledge.matched > 0, '网页应匹配到知识点');
  assert.ok(done.draft.stats.tasks >= 3, '网页里的命令行应被抽成草案题，实际 ' + done.draft.stats.tasks);
  assert.ok(done.draftFiles && done.draftFiles.pack, '有草案就要真的落盘');
  const samples = done.draft.pack.tasks.map(function (t2) { return t2.sample; }).join(' | ');
  assert.match(samples, /docker run/, '草案应包含 docker run：' + samples);
  assert.match(samples, /kubectl rollout undo/, '草案应包含 kubectl：' + samples);

  // 笔记是给人看的：里面不该再残留 HTML 标签，也不该把 <style>/<script> 当正文
  const note = readFileSync(join(done.dir, done.artifacts[0]), 'utf8');
  assert.equal(/<p|<style|<script|<h1/i.test(note), false, '笔记里不该有 HTML 标签：' + note.slice(0, 120));
  rmSync(project.projectDir(name), { recursive: true, force: true });
});

// 截图 → 知识点 → 题目，整条链路（含 Vision OCR）在本机跑一遍；没有截图样例或不是 macOS 就跳过。
test('截图 OCR 到草案题：整条链路真跑一次', async function () {
  const fixture = new URL('../test/fixtures/terminal-note-screenshot.png', import.meta.url).pathname;
  if (!existsSync(fixture) || process.platform !== 'darwin') {
    assert.ok(true, '跳过：没有截图样例或不是 macOS');
    return;
  }
  const { ocrImage } = await import('../src/core/ocr.mjs');
  const ocr = ocrImage(fixture, { home: HOME, timeout: 120000 });
  assert.equal(ocr.ok, true, 'OCR 应成功：' + ocr.reason);
  assert.match(ocr.text, /docker run|kubectl|tcpdump/i, '应认出截图里的命令：' + ocr.text.slice(0, 120));

  const name = 'shot-ingest-' + Date.now();
  project.createProject(name);
  const done = project.ingestIntoProject(name, { kind: 'screenshot', source: fixture, text: ocr.text }, {});
  assert.ok(done.knowledge.matched > 0, '截图应匹配到知识点');
  assert.ok(done.draft.stats.tasks > 0, '截图里的命令应被抽成草案题');
  rmSync(project.projectDir(name), { recursive: true, force: true });
});

// 元数据损坏必须与"没建过"分开：曾经 project.json 坏掉后再收一次来源，坏文件被静默覆盖，
// 台账从 2 条掉到 1 条且没有任何提示。这里把"不敢覆盖"钉死在 core 层：原字节不许变。
// 实测：网页版解析同一个仓库比命令行多出一条废草案——`go 1.22`（go.mod 里的指令）。
// 原因是网页版把「仓库画像 + 命令文本」一起喂给抽命令的那一步。
// 现在 ingestIntoProject 支持 commandText：知识点读全文，抽草案只看命令部分。
test('仓库来源：知识点读全文，抽草案只看命令部分（清单指令不能变成题）', function () {
  const name = 'cmd-text-' + Date.now();
  // 画像里带着 go.mod 原文（现实里 scanRepo 就是这么读清单的）：这两行**行首**就是工具名，
  // 不隔离命令文本的话，go 1.22 会被抽成一条「敲 go 空格版本号」的废草案
  const digest = ['# demo-service', 'module demo', 'go 1.22', '清单文件：go.mod', 'README：本地起服务'].join(String.fromCharCode(10));
  const commands = ['docker build -t demo:1.0 .', 'go test -race ./...'].join(String.fromCharCode(10));
  const done = project.ingestIntoProject(name, {
    kind: 'repo',
    source: 'demo-service',
    text: digest + String.fromCharCode(10) + commands,
    commandText: commands
  }, {});
  const samples = done.draft.pack.tasks.map(function (t) { return t.sample; });
  assert.deepEqual(samples, ['docker build -t demo:1.0 .', 'go test -race ./...'],
    '草案只该来自命令文本，不该把 go.mod 的指令当成命令：' + JSON.stringify(samples));
  assert.ok(done.knowledge.matched >= 0, '知识点那一步照旧跑');
  rmSync(project.projectDir(name), { recursive: true, force: true });
});
test('项目元数据损坏：拒绝覆盖，原文件字节不动', function () {
  const name = 'broken-meta-' + Date.now();
  project.createProject(name);
  project.recordSource(name, { kind: 'text', source: '第一份来源', knowledge: 1, tasks: 0, artifacts: [] });
  const file = project.projectMetaPath(name);
  writeFileSync(file, 'not json at all');
  const before = readFileSync(file, 'utf8');

  assert.equal(project.projectState(name).state, 'corrupted', '坏 JSON 要报 corrupted，而不是 missing');

  const again = project.createProject(name);
  assert.equal(again.ok, false, '损坏时不许"当作不存在"重建');
  assert.equal(again.corrupted, true);
  assert.equal(readFileSync(file, 'utf8'), before, '坏文件必须原样留着，人才能备份或修');

  const ingested = project.ingestIntoProject(name, { kind: 'text', source: '第二份来源', text: 'docker run -d nginx' }, {});
  assert.equal(ingested.ok, false, '收来源也要拒绝，不能重建空台账顶掉旧记录');
  assert.equal(ingested.corrupted, true);
  assert.ok(ingested.error && ingested.error.indexOf('损坏') > -1, '要给出现在的原因：' + ingested.error);
  assert.equal(readFileSync(file, 'utf8'), before, '拒绝之后字节仍然不许变');
  assert.equal(existsSync(join(project.projectDir(name), 'drafts')) === true, true, '目录还在（没被删）');
  rmSync(project.projectDir(name), { recursive: true, force: true });
});

test.after(function () { rmSync(HOME, { recursive: true, force: true }); });