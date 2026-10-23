// 原生 macOS 端的两条硬要求，用源码与产物双重钉住：
//   1) 必须是原生（不能用 WebView 套壳网页版）——用户明确提过；
//   2) 无障碍标注不能"改着改着就没了"：装饰性图标要隐藏、进度条要有可访问名与值、
//      判定结果要主动播报一次（对等网页版的 aria-live）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const files = ['Engine.swift', 'EngineModels.swift', 'EngineHTTP.swift', 'NativeUI.swift', 'Pages.swift', 'Panels.swift', 'main.swift', 'Preferences.swift', 'selftest.swift', 'ProjectsFilter.swift', 'VerdictPanel.swift'];
const sources = files.map(function (name) { return { name: name, text: readFileSync(join(ROOT, 'app/macos', name), 'utf8') }; });
const ui = sources.filter(function (row) { return row.name === 'NativeUI.swift'; })[0].text;
// 图标/无障碍统计算全部 UI 文件：叶子视图已拆到 ProjectsFilter.swift / VerdictPanel.swift
const uiAll = sources.map(function (row) { return row.text; }).join(String.fromCharCode(10));

test('macOS 端是原生实现：源码与二进制里都没有 WebView', function () {
  sources.forEach(function (row) {
    ['WKWebView', 'WebKit', 'NSWebView', 'about:blank'].forEach(function (needle) {
      assert.equal(row.text.indexOf(needle), -1, row.name + ' 里出现了 ' + needle + '：原生端不许套壳网页版');
    });
  });
  // 二进制层面：链接的框架里不能有 WebKit（用安装包里的 App 实测，不存在就跳过）
  const bin = join(process.env.HOME || '', 'Applications/dsh-learn.app/Contents/MacOS/dsh-learn');
  if (existsSync(bin)) {
    const linked = spawnSync('otool', ['-L', bin], { encoding: 'utf8' }).stdout || '';
    assert.equal(/WebKit/i.test(linked), false, 'App 链接了 WebKit：' + linked);
    assert.ok(/SwiftUI/.test(linked), 'App 应当链接 SwiftUI（原生界面）：' + linked);
  }
});


// 实测：0.95.0 的 App 引擎包里少了 tools/，而 src/core/ocr.mjs 要用 tools/ocr.swift 现场编译 OCR 助手——
// 于是在「这台机器还没编译过助手」的环境里（清空 ~/.dsh-learn 就是这个状态），App 的截图 OCR 直接 400。
test('App 引擎包自带 OCR 源码等运行时文件（不许漏打包）', function () {
  const engine = join(process.env.HOME || '', 'Applications/dsh-learn.app/Contents/Resources/engine');
  if (!existsSync(engine)) {
    assert.ok(true, '跳过：本机没有装 App');
    return;
  }
  ['src/core/ocr.mjs', 'tools/ocr.swift', 'packs', 'web/app.mjs', 'package.json'].forEach(function (rel) {
    assert.ok(existsSync(join(engine, rel)), 'App 自带引擎里缺文件：' + rel);
  });
});
test('原生端无障碍标注齐全：装饰图标隐藏、进度条有名有值', function () {
  // 装饰性图标：要么明确隐藏，要么有可访问名，不能让它光秃秃地留在读屏树里
  const iconLines = uiAll.split(String.fromCharCode(10))
    .map(function (line, index) { return { line: line, index: index }; })
    .filter(function (row) { return row.line.indexOf('Image(systemName:') > -1; });
  assert.ok(iconLines.length >= 5, '图标数量看起来不对：' + iconLines.length);
  const lines = uiAll.split(String.fromCharCode(10));
  const naked = iconLines.filter(function (row) {
    // 往下看 3 行，找 accessibilityHidden / accessibilityLabel
    const window = lines.slice(row.index, row.index + 4).join(String.fromCharCode(10));
    return window.indexOf('accessibilityHidden(true)') === -1 && window.indexOf('accessibilityLabel') === -1;
  }).map(function (row) { return (row.index + 1) + ': ' + row.line.trim().slice(0, 60); });
  assert.deepEqual(naked, [], '这些图标既没隐藏也没可访问名：');

  // 带数值的进度条必须给出名字与当前值，否则读屏只念"进度指示器"
  const progress = lines.map(function (line, index) { return { line: line, index: index }; })
    .filter(function (row) { return row.line.indexOf('ProgressView(value:') > -1; });
  assert.ok(progress.length >= 2, '带数值的进度条数量看起来不对：' + progress.length);
  const bare = progress.filter(function (row) {
    const window = lines.slice(row.index, row.index + 5).join(String.fromCharCode(10));
    return window.indexOf('accessibilityLabel') === -1 || window.indexOf('accessibilityValue') === -1;
  }).map(function (row) { return (row.index + 1) + ': ' + row.line.trim().slice(0, 60); });
  assert.deepEqual(bare, [], '这些进度条缺可访问名或当前值：');
});

test('判定结果主动播报：原生端与网页版的实时区域对齐', function () {
  assert.ok(ui.indexOf('func announceVerdict(') > -1, '要有播报函数');
  assert.ok(/NSAccessibility\.post\([\s\S]{0,200}announcementRequested/.test(ui), '播报要走 NSAccessibility.post(.announcementRequested)');
  assert.ok(ui.indexOf('announceVerdict(payload)') > -1, '判定成功后要调用它');
  // 播报文案要与网页版同一套口径
  ['判定：', '要素齐全', '还缺 ', '本次为历史最好'].forEach(function (word) {
    assert.ok(ui.indexOf(word) > -1, '播报文案缺少「' + word + '」');
  });
});

// 界面结构回归：项目/仓库页曾经把整页 ProjectPage（HSplitView + List + ScrollView）
// 塞进外层 ScrollView，嵌套滚动让列表塌成一行、标题与说明文字重叠（用户截图报的问题）。
test('原生端：项目/仓库页是扁平两栏，不再嵌套滚动', function () {
  const ui = readFileSync(new URL('../app/macos/NativeUI.swift', import.meta.url), 'utf8');
  const at = ui.indexOf('struct RepoPage: View {');
  assert.ok(at > -1, '要有 RepoPage');
  // ProjectSection 已外移到 Pages.swift，结束标记改用「RepoPage 之后的第一个 struct」
  const nextStruct = ui.indexOf('\nstruct ', at + 10);
  const body = ui.slice(at, nextStruct > 0 ? nextStruct : ui.length);
  assert.ok(body.indexOf('HSplitView') > -1, '用左右两栏布局');
  assert.ok(body.indexOf('ProjectPage()') === -1, '不该再嵌入旧的 ProjectPage（会嵌套滚动）');
  assert.ok(body.indexOf('List(store.projects)') === -1, '项目列表用 ForEach 渲染，不套 List');
  assert.ok(ui.indexOf('struct ProjectPage: View {') === -1, '旧的 ProjectPage 应已删除（逻辑并入 RepoPage）');
  assert.ok(body.indexOf('ProjectSection()') > -1, '摄入面板要留在这一页');
});

// 原生端曾把查询串直接拼进路径（get("/api/corpus?q=…")），结果被编码成 %3F 变成
// "no route /api/corpus%3Fq=…"——**原生端那条检索从来没发出去过**，而它当时只验过"能编译"。
// 这条静态守卫拦住这一类写法：带 ? 的请求必须走 get(path, query:)。
test('原生端请求不把查询串拼进路径（必须走 query 参数）', function () {
  const src = readFileSync(join(ROOT, 'app/macos/Engine.swift'), 'utf8');
  const bad = src.split(String.fromCharCode(10)).map(function (line, index) {
    return { no: index + 1, line: line };
  }).filter(function (row) {
    return /get\("[^"]*\?/.test(row.line) || /post\("[^"]*\?/.test(row.line);
  });
  assert.deepEqual(bad, [], '这些行把查询串拼进了路径：' + bad.map(function (row) { return row.no + ':' + row.line.trim().slice(0, 60); }).join(' | '));
});

// ---- 近几轮新增能力的原生端端到端校验（第 12 轮补课） ----
test('原生自检覆盖近几轮新能力（语料检索 / JD 清单 / 分方向调研 / 重命名 / 回填 / 时间线）', function () {
  const selftest = readFileSync(join(ROOT, 'app/macos/selftest.swift'), 'utf8');
  const needed = ['corpusSearch', 'jdPlan', 'surveyGroups', 'renameProject', 'backfillText', 'drillPlan', 'sourceText', 'history'];
  const missing = needed.filter(function (name) { return selftest.indexOf(name) === -1; });
  assert.deepEqual(missing, [], '自检里缺这些能力的真实校验：' + missing.join('、'));
});
