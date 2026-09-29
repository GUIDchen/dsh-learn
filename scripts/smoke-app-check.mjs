// 安装包冒烟检查（由 scripts/smoke-app.sh 调用）：对着刚起来的 App 自带引擎做三件事
//   1) 读 bootstrap：题库能读出来、App 内版本要与 package.json 一致；
//   2) 传一张截图：OCR 链路能用（这一步专门拦"打包漏了 tools/ocr.swift"这类问题）；
//   3) 产物名要带上原文件名（不许把 OCR 临时文件名留给用户）。
// 用法：node scripts/smoke-app-check.mjs <port> <repoRoot> <fixturePng>
import fs from 'node:fs';
import path from 'node:path';

const [port, root, fixture] = process.argv.slice(2);
const base = 'http://127.0.0.1:' + port;

function fail(message) {
  console.log('FAIL  ' + message);
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const bootRes = await fetch(base + '/api/bootstrap');
if (!bootRes.ok) fail('bootstrap 返回 ' + bootRes.status);
const boot = await bootRes.json();
if (!boot.tasks || boot.tasks.length < 100) fail('题库读不出来：' + (boot.tasks ? boot.tasks.length : 'undefined'));
if (boot.appVersion !== version) fail('App 内版本（' + boot.appVersion + '）与 package.json（' + version + '）不一致——多半装的是旧包');
console.log('PASS  自带引擎读到 ' + boot.tasks.length + ' 道题，版本 ' + boot.appVersion);

if (!fs.existsSync(fixture)) {
  console.log('跳过：没有截图夹具 ' + fixture);
  process.exit(0);
}

const png = fs.readFileSync(fixture);
const res = await fetch(base + '/api/project', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'smoke-' + Date.now(),
    dataUrl: 'data:image/png;base64,' + png.toString('base64'),
    fileName: '冒烟截图.png'
  })
});
const body = await res.json();
if (res.status !== 200) fail('截图上传返回 ' + res.status + '：' + (body.error || JSON.stringify(body)));
const knowledge = body.knowledge ? body.knowledge.matched : 0;
const artifacts = body.artifacts || [];
if (!(knowledge > 0 && body.tasks > 0)) fail('OCR 结果不对：知识点 ' + knowledge + '，草案 ' + body.tasks);
if (!artifacts.some(function (rel) { return rel.indexOf('冒烟截图') > -1; })) fail('产物名没带上原文件名：' + JSON.stringify(artifacts));
console.log('PASS  截图 OCR 可用：知识点 ' + knowledge + '，草案 ' + body.tasks + '，产物名带原文件名');
