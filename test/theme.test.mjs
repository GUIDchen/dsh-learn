// 主题护栏（这轮实测踩出来的）：
//   :root 声明了 color-scheme: light dark，浏览器就会按系统偏好决定画布底色，
//   而样式里原本没有给 body 设背景——深色模式下变成"深底 + 深字"，整页不可读。
// 这条用例钉住三件事：① body 必须有显式背景与前景；② 深色必须覆盖浅色的每个颜色令牌（不许半套）；
//   ③ 两套调色板的文字对比度都要达到 WCAG AA（4.5:1），语义色/圆点至少 3:1。
// 对比度按合成后的实际颜色算：--fill 是半透明覆盖层，直接拿 rgba 当不透明色会得出假结论。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(ROOT, 'web/index.html'), 'utf8');

function parseTokens(text) {
  const out = {};
  (text.match(/--[a-z-]+:\s*[^;]+;/g) || []).forEach(function (row) {
    const m = row.match(/--([a-z-]+):\s*([^;]+);/);
    out['--' + m[1]] = m[2].trim();
  });
  return out;
}

const lightStart = css.indexOf('  :root {');
const light = parseTokens(css.slice(lightStart, css.indexOf('}', lightStart)));
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = parseTokens(css.slice(darkAt, css.indexOf('</style>', darkAt)));

function toRgba(value) {
  if (value.charAt(0) === '#') {
    const h = value.slice(1);
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const m = String(value).match(/rgba?\(([^)]+)\)/);
  const p = m[1].split(',').map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

function over(fg, bg) {
  const a = fg.a + bg.a * (1 - fg.a);
  return { r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a, g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a, b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a, a: a };
}

function luminance(c) {
  const f = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

// 前景压在背景上的实际对比度（半透明层先合成到页面底色上）
function contrast(fg, bg, pageBase) {
  const back = bg.a < 1 ? over(bg, pageBase) : bg;
  const front = fg.a < 1 ? over(fg, back) : fg;
  const l1 = luminance(front), l2 = luminance(back);
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
}

test('主题令牌：body 有显式背景，深色覆盖浅色的每个颜色令牌', function () {
  assert.match(css, /body \{[^}]*background: var\(--bg\)/, 'body 必须显式设背景：不然深色模式下是深底 + 深字');
  assert.match(css, /body \{[^}]*color: var\(--fg\)/, 'body 必须显式设前景色');
  const colors = Object.keys(light).filter(function (k) { return k.indexOf('--fs') !== 0 && k !== '--radius'; });
  assert.ok(colors.length >= 14, '浅色令牌太少，看看解析：' + JSON.stringify(colors));
  const missing = colors.filter(function (k) { return dark[k] === undefined; });
  assert.deepEqual(missing, [], '这些令牌只定义了浅色，深色下会漏出来：' + JSON.stringify(missing));
});

test('两套调色板的对比度都达到 WCAG AA', function () {
  for (const [name, tokens] of [['light', light], ['dark', dark]]) {
    const bg = toRgba(tokens['--bg']);
    const fill = over(toRgba(tokens['--fill']), bg);
    ['--fg', '--muted', '--warn-text'].forEach(function (key) {
      const top = contrast(toRgba(tokens[key]), bg, bg);
      const onFill = contrast(toRgba(tokens[key]), fill, bg);
      assert.ok(top >= 4.5, name + ' 的 ' + key + ' 在底色上只有 ' + top + ':1（要 ≥4.5）');
      assert.ok(onFill >= 4.5, name + ' 的 ' + key + ' 在半透明底上只有 ' + onFill + ':1（要 ≥4.5）');
    });
    // 语义色用在圆点与状态标记上：非文本 UI 组件的下限是 3:1
    ['--ok', '--warn', '--idle', '--accent'].forEach(function (key) {
      const top = contrast(toRgba(tokens[key]), bg, bg);
      assert.ok(top >= 3, name + ' 的 ' + key + ' 在底色上只有 ' + top + ':1（要 ≥3）');
    });
  }
});

// ---------- 排版护栏（依据见 docs/UI-RESEARCH.md） ----------
// 这一组的由来：改之前有 12 / 12.5 / 13 / 14 / 15 / 18 六档，中间四档挤在 3px 内——
// 屏幕上分不出层级，「谁更重要」就变成随手写。
test('字号梯度只有 4 档，且不再出现写死的像素字号', function () {
  const block = css.slice(css.indexOf('  :root {'), css.indexOf('}', css.indexOf('  :root {')));
  const tokens = {};
  (block.match(/--fs-[a-z]+:\s*[0-9.]+px;/g) || []).forEach(function (row) {
    const m = row.match(/--fs-([a-z]+):\s*([0-9.]+)px;/);
    tokens['--fs-' + m[1]] = Number(m[2]);
  });
  const names = Object.keys(tokens);
  assert.equal(names.length, 4, '只该有 4 档字号，实际：' + JSON.stringify(tokens));
  const sizes = names.map(function (n) { return tokens[n]; }).sort(function (a, b) { return a - b; });
  assert.deepEqual(sizes, [12, 14, 16, 20], '四档应为 12 / 14 / 16 / 20，实际：' + JSON.stringify(tokens));

  // 除令牌定义本身外，任何 font-size 都必须走令牌：12.5px、13px 这种半档就是这么长出来的
  const hardcoded = (css.match(/font-size:\s*[0-9.]+px/g) || []);
  assert.deepEqual(hardcoded, [], '出现写死的像素字号：' + JSON.stringify(hardcoded));
  assert.ok(css.indexOf('var(--fs-sm)') === -1 && css.indexOf('var(--fs-md)') === -1,
    '已被合并掉的档位不该再被引用');
});

test('数字对齐：表格与命令块用等宽数字', function () {
  assert.ok(css.indexOf('table { border-collapse: collapse; width: 100%; font-size: var(--fs-body); font-variant-numeric: tabular-nums; }') > -1,
    '表格要 tabular-nums，否则分数/条数一列数字对不齐');
  assert.match(css, /pre \{[^}]*font-variant-numeric: tabular-nums/, '命令块也要等宽数字');
});

test('标题层级不跳档，且行高按字号分档', function () {
  const order = (css.match(/<h([1-6])/g) || []).map(function (row) { return Number(row.slice(2)); });
  assert.ok(order.length >= 10, '页面标题太少，解析可能出错：' + JSON.stringify(order));
  assert.equal(order[0], 1, '第一个标题应是 h1');
  order.forEach(function (level, index) {
    if (index === 0) return;
    assert.ok(level - order[index - 1] <= 1, '标题跳档：h' + order[index - 1] + ' → h' + level + '（' + order.join(' ') + '）');
  });
  assert.match(css, /h1, h2, h3, h4 \{ line-height: 1\.25; \}/, '标题行高要收紧');
  assert.match(css, /\.muted, \.tag, \.badge, \.task-item \.st, table \{ line-height: 1\.5; \}/, '小字行高要放宽');
});

test('间距只用一套阶梯（0/1/2/4/8/12/16/24/32/48）', function () {
  // 调研结论：8pt 基准 + 4px 细分，同一系统内只用一条阶梯。改之前 padding/margin/gap 里混着
  // 3/5/6/7/9/10/18 各种值——看着都能用，代价是节奏不可复算、新增样式时又凭手感挑一个。
  const LADDER = [0, 1, 2, 4, 8, 12, 16, 24, 32, 48];
  const decls = css.match(/(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?:\s*[^;}]+;/g) || [];
  assert.ok(decls.length >= 20, '解析出的间距声明太少，正则可能失效：' + decls.length);
  const off = [];
  decls.forEach(function (row) {
    (row.match(/([0-9]+)px/g) || []).forEach(function (m) {
      const size = Number(m.replace('px', ''));
      if (LADDER.indexOf(size) === -1) off.push(row.trim().slice(0, 64));
    });
  });
  assert.deepEqual(off, [], '有不在阶梯上的间距值：' + JSON.stringify(off.slice(0, 5)));
});
