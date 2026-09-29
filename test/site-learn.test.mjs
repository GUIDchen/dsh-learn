// 从网站/文档"学"题库的测试：抽取、生成草案、危险写法点名、HTML 只认代码块。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDraftPack, extractCommands, renderDraft, readSourceFile, ruleHints } from '../src/core/site-learn.mjs';
import { validatePack } from '../src/core/schema.mjs';
import { isAllowed } from '../src/core/exec.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-learn-site-'));

test('命令抽取：按工具分轨道，导航与用法签名被过滤', function () {
  const text = [
    'docker run -d --name web -p 8080:80 nginx:1.25',
    'docker container run [OPTIONS] IMAGE [COMMAND] [ARG...]',
    'Usage: docker ps [OPTIONS]',
    'kubectl get pods -A',
    'redis-cli --scan --pattern "user:*"',
    'docker run -d --name web -p 8080:80 nginx:1.25',
    'see https://docs.example.com for details',
    'docker build'
  ].join('\n');
  const rows = extractCommands(text);
  const commands = rows.map(function (row) { return row.command; });
  assert.ok(commands.indexOf('docker run -d --name web -p 8080:80 nginx:1.25') > -1);
  assert.ok(commands.indexOf('kubectl get pods -A') > -1);
  assert.equal(commands.filter(function (c) { return c.indexOf('docker run -d') === 0; }).length, 1, '重复命令只留一条');
  assert.ok(commands.indexOf('docker container run [OPTIONS] IMAGE [COMMAND] [ARG...]') === -1, '用法签名要过滤');
  assert.ok(commands.some(function (c) { return c.indexOf('https://') > -1; }) === false, '链接不算命令');
  assert.equal(rows[0].track, 'docker');
  assert.ok(rows.some(function (row) { return row.track === 'k8s'; }));
});

// 真克隆实测（kubernetes/examples、gin、ripgrep）暴露的三个问题，一条条钉住：
//   1. YAML 的 key: value 被当成命令（kind 恰好是个真工具名）；
//   2. 英文句子被当成命令（service, but you can use your own…）；
//   3. 分组标签（k8s / linux…）被写进判定规则，学员写对了也判缺要素。
test('命令抽取：YAML 键值、英文句子、续行碎片都不该变成草案', function () {
  const text = [
    'kind: PersistentVolume',
    'name: cockroachdb-statefulset.yaml',
    'service, but you can use your own. See the etcd docs for more:',
    'curl -X POST "$URL" \\',
    '  -H "content-type: application/json" \\',
    '  -d @payload.json',
    'kubectl create -f cockroachdb-statefulset.yaml',
    'minikube start'
  ].join('\n');
  const rows = extractCommands(text);
  const commands = rows.map(function (row) { return row.command; });
  assert.ok(commands.indexOf('kind: PersistentVolume') === -1, 'YAML 的 key: value 不是命令');
  assert.ok(commands.indexOf('name: cockroachdb-statefulset.yaml') === -1, 'YAML 的 key: value 不是命令');
  assert.ok(!commands.some(function (c) { return c.indexOf('but you can use your own') > -1; }), '英文句子不是命令');
  assert.ok(commands.indexOf('kubectl create -f cockroachdb-statefulset.yaml') > -1, '真命令要留着');
  // 反斜杠续行要接起来，而不是只留第一行
  const curl = commands.filter(function (c) { return c.indexOf('curl') === 0; })[0] || '';
  assert.ok(curl.indexOf('-H') > -1 && curl.indexOf('-d @payload.json') > -1, '续行要接成一条完整命令：' + curl);
});

test('草案规则锚在命令里真实出现的词上（分组标签不能当规则）', function () {
  const text = ['minikube start', 'sed -i "s/a/b/" file.txt', 'cmake --build build'].join('\n');
  const result = buildDraftPack(text, { source: 'fixture' });
  const byTool = {};
  result.pack.tasks.forEach(function (task) { byTool[task.sample] = task; });
  ['minikube start', 'sed -i "s/a/b/" file.txt'].forEach(function (sample) {
    const task = byTool[sample];
    assert.ok(task, '应生成草案：' + sample);
    const first = task.require[0].p;
    assert.equal(first, '^\\s*' + sample.split(/\s+/)[0], sample + ' 的第一条规则要锚在真实命令词上：' + first);
  });
  assert.ok(byTool['minikube start'].track === 'k8s' && byTool['sed -i "s/a/b/" file.txt'].track === 'linux', '轨道标签照旧');
});

test('同一写法的命令只生成一条草案（值不同不算不同写法）', function () {
  const text = [
    'go build -tags=jsoniter .',
    'go build -tags=sonic .',
    'go build -tags=nomsgpack .',
    'kubectl create -f a.yaml',
    'kubectl delete namespace demo'
  ].join('\n');
  const result = buildDraftPack(text, { source: 'fixture' });
  const samples = result.pack.tasks.map(function (t) { return t.sample; });
  assert.equal(samples.filter(function (s) { return s.indexOf('go build') === 0; }).length, 1, 'go build 的三种 tags 只留一条：' + JSON.stringify(samples));
  assert.equal(samples.length, 3, 'kubectl create 与 kubectl delete 是不同写法，都要留着：' + JSON.stringify(samples));
  assert.equal(result.stats.collapsed, 2, '合并了几条要在统计里写出来：' + result.stats.collapsed);
  assert.ok(renderDraft(result).indexOf('同一写法的重复示例已合并 2 条') > -1, '复核清单里要说明合并了多少条');
});
test('草案生成：样本自查满分、要素来自命令本身、能通过题库校验', function () {
  const html = '<h2>运行容器</h2><pre>docker run -d --name web -p 8080:80 nginx:1.25</pre>';
  const result = buildDraftPack(html, { source: 'example.com' });
  assert.equal(result.stats.extraction, 'code-blocks');
  assert.equal(result.stats.tasks, 1);
  const task = result.pack.tasks[0];
  assert.equal(task.track, 'docker');
  assert.ok(task.require.length >= 3, '至少要抓到工具名与几个选项');
  assert.ok(task.require.every(function (rule) { return rule.p && rule.tip; }));
  // 生成的草案必须是合法题库包：用同一套校验器过一遍
  const checked = validatePack(result.pack, { isAllowedCommand: isAllowed });
  assert.deepEqual(checked.errors, [], '草案包应通过校验');
  assert.equal(checked.taskCount, 1);
});

test('危险写法会被点名，且不会放进 require', function () {
  const html = '<pre>git reset --hard HEAD~1</pre><pre>docker system prune --volumes</pre>';
  const result = buildDraftPack(html, { source: 'x' });
  const reset = result.review.filter(function (row) { return row.command.indexOf('reset') > -1; })[0];
  assert.ok(reset.warnings.some(function (w) { return w.indexOf('危险写法') > -1; }), '示例本身是危险命令要说清');
  result.pack.tasks.forEach(function (task) {
    assert.ok(task.forbid.every(function (rule) { return !new RegExp(rule.p, 'i').test(task.sample); }), '禁止项不能命中自己的参考答案');
  });
});

test('要素太少与太短的命令会被复核清单提醒', function () {
  const text = 'docker build\ndocker ps -a --format table';
  const result = buildDraftPack(text, { source: 'x' });
  assert.match(renderDraft(result), /复核清单/);
  const bySample = {};
  result.pack.tasks.forEach(function (t) { bySample[t.sample] = t; });
  // docker build 只有"工具 + 子命令"两个要素：敲 docker build 就满分，必须提醒
  const thin = result.review.filter(function (row) { return row.command === 'docker build'; })[0];
  assert.ok(thin && thin.warnings.some(function (w) { return w.indexOf('要素太少') === 0; }), '只有工具名的命令要提醒：' + JSON.stringify(thin));
  // 三条要素以上（工具 + 子命令 + 选项/目标）就不再喊废话题——
  // 否则真仓库里几乎每条都被提醒，提醒本身就没有信息量了（实测 10/10 全红）
  const ok = result.review.filter(function (row) { return row.command === 'docker ps -a --format table'; })[0];
  assert.ok(ok, '应生成草案：' + JSON.stringify(result.review.map(function (r) { return r.command; })));
  assert.equal(ok.warnings.filter(function (w) { return w.indexOf('要素太少') === 0; }).length, 0, '要素够用时不该喊废话题：' + JSON.stringify(ok.warnings));
  assert.ok(bySample['docker ps -a --format table'].require.length >= 3, '要素数要算上子命令与选项');
});

// 实测出来的问题：草案的要素普遍只有 1–2 个（工具名 + 一个选项），
// 于是 minikube delete / kubectl delete ns x 这种题敲一半就满分。
// 子命令与目标对象都该是要素，而且目标要优先占名额（选项先来会把名额用光）。
test('要素要覆盖子命令与目标对象，重复的不数两遍', function () {
  const hints = function (cmd) { return ruleHints(cmd).map(function (h) { return h.token; }); };
  assert.deepEqual(hints('minikube start'), ['start'], '子命令就是最后一个词，不该数两遍');
  assert.deepEqual(hints('kubectl delete namespace openshift-origin'), ['delete', 'openshift-origin'], '目标对象（命名空间名）要进要素');
  const run = hints('docker run -d --name web -p 8080:80 nginx:1.25');
  assert.ok(run.indexOf('run') > -1, '子命令要进要素：' + JSON.stringify(run));
  assert.ok(run.indexOf('nginx:1.25') > -1, '目标镜像要进要素（带 tag 也要认）：' + JSON.stringify(run));
  assert.ok(run.indexOf('-p 8080:80') > -1, '选项也不该被目标挤掉：' + JSON.stringify(run));
  assert.equal(hints('curl -X GET "localhost:8085/x?y=1"').filter(function (t) { return t === 'GET'; }).length, 0,
    'GET 已经算进 -X GET，不该再单列一次');
  assert.equal(hints('cargo build --release --features pcre2').indexOf('pcre2'), -1, 'pcre2 已经算进 --features pcre2');

  // 落到草案上：require 里要真的多出子命令与目标
  const task = buildDraftPack('minikube start', { source: 'x' }).pack.tasks[0];
  assert.equal(task.require.length, 2, 'minikube start 应该是 2 个要素：' + JSON.stringify(task.require.map(function (r) { return r.p; })));
  const del = buildDraftPack('kubectl delete namespace demo', { source: 'x' }).pack.tasks[0];
  assert.ok(del.require.some(function (r) { return r.p === 'demo'; }), '目标对象要进 require：' + JSON.stringify(del.require.map(function (r) { return r.p; })));
});
// 真仓库实测（gin 的 3 条 curl 示例）：文档/仓库里的接口示例几乎都是带引号的 URL，
// 而 isBareWord() 明确排除斜杠，于是这类命令一个目标对象都抽不到——草案只剩工具名一个要素，
// 复核清单里全被标成"要素太少（可能是废话题）"。
// 另外 -v 这种开关会把后面的 URL 当成自己的值吞掉（实测得到 "-v localhost:8088/x" 一个要素）。
test('草案要素：URL、路径与设备文件都算目标对象，开关不吃掉 URL', function () {
  const hints = function (cmd) { return ruleHints(cmd).map(function (h) { return h.token; }); };

  assert.deepEqual(hints('curl "localhost:8085/bookable?check_in=2030-04-16&check_out=2030-04-17"'),
    ['localhost:8085/bookable'], '带引号的 URL 要抽出主机与路径（查询串的值不算）');
  const get = hints('curl -X GET "localhost:8085/testing?name=appleboy"');
  assert.ok(get.indexOf('localhost:8085/testing') > -1, 'URL 路径要进要素：' + JSON.stringify(get));
  assert.ok(get.indexOf('-X GET') > -1, '选项也要在：' + JSON.stringify(get));

  const verbose = hints('curl -v localhost:8088/thinkerou/987fbc97');
  assert.ok(verbose.indexOf('-v') > -1 && verbose.indexOf('localhost:8088/thinkerou/987fbc97') > -1,
    '-v 不该把后面的 URL 吃掉：' + JSON.stringify(verbose));

  const stty = hints('stty -f /dev/tty.usbserial-1420 115200 cs8');
  assert.ok(stty.indexOf('/dev/tty.usbserial-1420') > -1, '设备文件路径要当目标：' + JSON.stringify(stty));
  assert.ok(stty.indexOf('cs8') === -1, '尾部的裸词不该盖过设备路径：' + JSON.stringify(stty));

  const https = hints('curl -o out.json https://example.com/a/b');
  assert.ok(https.indexOf('https://example.com/a/b') > -1, '带 scheme 的 URL 也要认：' + JSON.stringify(https));
});
test('ruleHints：长选项带值、短选项带值都抓得到', function () {
  const hints = ruleHints('docker run -d --name web -p 8080:80 nginx:1.25').map(function (h) { return h.token; });
  assert.ok(hints.indexOf('-d') > -1);
  assert.ok(hints.indexOf('--name web') > -1, '长选项要连值一起抓：' + JSON.stringify(hints));
  assert.ok(hints.indexOf('-p 8080:80') > -1);
});

test('本地文件也能当输入；读不到时给可读原因', function () {
  const file = join(HOME, 'notes.md');
  writeFileSync(file, '# 备忘\ndocker logs -f --tail 100 web\n');
  const read = readSourceFile(file);
  assert.equal(read.ok, true);
  assert.match(read.text, /docker logs/);
  assert.equal(readSourceFile(join(HOME, 'nope.md')).ok, false);
});

test.after(function () {
  rmSync(HOME, { recursive: true, force: true });
});
