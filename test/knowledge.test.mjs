// 知识点字典 + 输入摄取 + OCR 的测试。
// 这一层的价值在于"题库与字典不脱节"：字典里指向的每道题都必须真实存在。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeText, summarizeAnalysis, POINTS, MODULES } from '../src/core/knowledge.mjs';
import { htmlToText, decodeEntities, readTextFile, fetchText } from '../src/core/ingest.mjs';
import { ocrImage, saveDataUrl, ocrHelperPath } from '../src/core/ocr.mjs';
import { findTask, TRACKS } from '../src/core/tasks.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-learn-knowledge-'));

test('知识点字典自身要自洽：id 唯一、模块存在、指向的题真实存在', function () {
  const ids = new Set();
  POINTS.forEach(function (point) {
    assert.ok(!ids.has(point.id), '知识点 id 重复：' + point.id);
    ids.add(point.id);
    assert.ok(MODULES.some(function (m) { return m.id === point.module; }), point.id + ' 的模块不存在：' + point.module);
    assert.ok(point.patterns.length > 0, point.id + ' 至少要有一个命中词');
    point.tasks.forEach(function (taskId) {
      assert.ok(findTask(taskId), point.id + ' 指向了不存在的题：' + taskId);
    });
  });
});

test('声明了题库轨道的模块，轨道必须真实存在（分析结果才能直接开练）', function () {
  MODULES.forEach(function (mod) {
    if (!mod.track) {
      // 展示型模块：岗位里常见但题库还没覆盖，允许 track 为 null
      assert.equal(typeof mod.blurb, 'string');
      return;
    }
    assert.ok(TRACKS.indexOf(mod.track) > -1, mod.id + ' 对应的轨道不在题库里：' + mod.track);
  });
  const withTrack = MODULES.filter(function (mod) { return mod.track; });
  assert.ok(withTrack.length >= 16, '至少要有 16 个模块直接对应题库轨道');
  assert.ok(MODULES.length >= 20, '字典模块数应覆盖到岗位里常见的领域');
});

test('岗位 JD 分析：命中知识点、模块分组与推荐题目', function () {
  const jd = [
    '岗位职责：',
    '1. 熟悉 Python 虚拟环境搭建与依赖管理；',
    '2. 会用 tcpdump 抓包，能用 iperf3 测带宽；',
    '3. 了解 YOLO 目标检测训练与 mAP 评估；',
    '4. 有嵌入式交叉编译经验者优先。'
  ].join('\n');
  const report = analyzeText(jd);
  const ids = report.points.map(function (point) { return point.id; });
  ['python.venv', 'netops.capture', 'netops.throughput', 'yolo.train', 'embedded.cross'].forEach(function (id) {
    assert.ok(ids.indexOf(id) > -1, '应命中知识点 ' + id + '，实际命中：' + ids.join(','));
  });
  assert.ok(report.modules.length >= 4, '至少覆盖 4 个模块');
  assert.ok(report.tasks.length >= 5, '应给出至少 5 道推荐题');
  assert.equal(new Set(report.tasks.map(function (row) { return row.taskId; })).size, report.tasks.length, '推荐题不能重复');
  report.tasks.forEach(function (row) {
    assert.ok(findTask(row.taskId), '推荐了不存在的题：' + row.taskId);
  });
  assert.match(summarizeAnalysis(report), /识别出 \d+ 个知识点/);
});

// 真仓库实测出来的误报：Go 项目 gin 的 README/Makefile 里到处是 used / based / start / config / various /
// previous，按子串匹配会分别命中 sed / tar / conf / iou——于是一个 Go 项目被识别成
// 「缺 目标检测-YOLO 与 Python 性能分析知识点」，推荐了完全无关的题。
// 修法：短 ASCII 记号（≤5 个字母数字）整词匹配；长词条保持子串匹配。
//
// 仍然会误报的（已知天花板，见下面的断言）：'mAP' 与英文词 map 同形、'engine'（TensorRT engine）
// 与普通英文 engine 同形——这类同形碰撞要去掉大小写不敏感才能治，代价是丢掉大小写不敏感带来的召回。
test('短词条整词匹配：普通英文单词里的片段不再算命中', function () {
  const noise = analyzeText('used based closed start config configure various previous vendor targeting');
  assert.equal(noise.matched, 0, '这些词不该命中任何知识点，实际命中：'
    + noise.points.map(function (p) { return p.id; }).join('、'));

  // 真的出现这些命令时照常命中（整词匹配不能把召回也砍掉）
  const real = analyzeText('用 sed 批量替换，用 tar 打包，按 mAP 与 precision 评估，改 iou 阈值');
  const ids = real.points.map(function (p) { return p.id; });
  assert.ok(ids.indexOf('linux.text') > -1, 'sed 要能命中文本处理：' + ids.join('、'));
  assert.ok(ids.indexOf('linux.archive') > -1, 'tar 要能命中打包压缩：' + ids.join('、'));
  // mAP 是同形词（英文词 map）：单独出现不算，和 precision/recall 一起出现才算
  assert.ok(ids.indexOf('yolo.eval') > -1, 'mAP 与 precision 一起出现时要能命中评估指标：' + ids.join('、'));

  // engine 这种英文常用词已经换成了有辨识度的词条（tensorrt / trtexec），不该再命中
  const homograph = analyzeText('the engine is running');
  assert.ok(!homograph.points.some(function (p) { return p.id === 'yolo.export'; }),
    'engine 是英文常用词，不该命中导出部署：' + homograph.points.map(function (p) { return p.id; }).join('、'));
  // 同形词（mAP ↔ 英文 map、deployment ↔ 一次发布、benchmark ↔ 普通基准）现在都要有印证才算命中：
  //   · 单独一个 map / deployment / benchmark 不算；
  //   · 和同知识点的其它词条（precision/recall、kubernetes、go test）一起出现才算。
  assert.ok(!analyzeText('build a map of ids').points.some(function (p) { return p.id === 'yolo.eval'; }),
    'map 单个词不该命中评估指标');
  assert.ok(analyzeText('按 mAP 与 precision 评估检测效果').points.some(function (p) { return p.id === 'yolo.eval'; }),
    'mAP 与 precision 一起出现时应命中');
  assert.ok(!analyzeText('the deployment failed').points.some(function (p) { return p.id === 'k8s.workload'; }),
    'deployment 单个词不该命中 k8s 工作负载');
  assert.ok(analyzeText('用 kubectl 看 deployment 的滚动更新').points.some(function (p) { return p.id === 'k8s.workload'; }),
    'kubectl 与 deployment 一起出现时应命中');
});

test('没命中的要求行会被单独列出来（提示字典盲区）', function () {
  const report = analyzeText(['任职要求：', '熟悉某某独门黑科技平台；', '熟悉 tcpdump 抓包'].join('\n'));
  assert.ok(report.unmatchedLines.some(function (line) { return line.indexOf('独门黑科技') > -1; }), '应报出没覆盖的要求行');
  assert.ok(!report.unmatchedLines.some(function (line) { return line.indexOf('tcpdump') > -1; }), '已命中的行不该被列为盲区');
  assert.ok(report.points.some(function (point) { return point.id === 'netops.capture'; }));
});

test('命中依据要能指回原文片段', function () {
  const report = analyzeText('熟悉 Kubernetes 的滚动更新与 describe 排障');
  const k8s = report.points.filter(function (point) { return point.module === 'k8s'; });
  assert.ok(k8s.length >= 2, 'Kubernetes 关键词应命中多个知识点');
  assert.ok(k8s[0].evidence.length > 0);
  assert.ok(k8s[0].evidence[0].snippet.indexOf('Kubernetes') > -1 || k8s[0].evidence[0].snippet.indexOf('describe') > -1);
});

test('空文本与纯噪声不会硬凑知识点', function () {
  assert.equal(analyzeText('').matched, 0);
  assert.match(summarizeAnalysis(analyzeText('')), /没有识别出任何知识点/);
});

test('HTML 去标签、实体解码与文本文件读取', function () {
  const html = '<html><head><style>p{color:red}</style><script>var x=1</script></head><body><h1>岗位</h1><p>熟悉&nbsp;Git&nbsp;与&nbsp;Docker</p><ul><li>了解 YOLO</li></ul></body></html>';
  const text = htmlToText(html);
  assert.ok(text.indexOf('颜色') === -1 && text.indexOf('var x') === -1, '脚本与样式必须去掉');
  assert.ok(text.indexOf('熟悉 Git 与 Docker') > -1, '实体要解码：' + text);
  assert.ok(text.split('\n').length >= 3, '块级标签应产生换行');
  assert.equal(decodeEntities('&lt;a&gt;&#65;&#x42;'), '<a>AB');

  const md = join(HOME, 'jd.md');
  writeFileSync(md, '熟悉 Docker');
  assert.equal(readTextFile(md).text, '熟悉 Docker');
  const bin = join(HOME, 'photo.jpeg');
  writeFileSync(bin, 'x');
  assert.equal(readTextFile(bin).ok, false, '二进制后缀应被拒绝');
  assert.match(readTextFile(bin).reason, /文本类文件/);
});

// 字典关键词与题库要对齐：题目里出现、而字典一次都没提到的工具名，等于"JD 写了也匹配不上"。
// 这条用例把一批"JD 里会直接写出来"的工具名钉住（它们都是真实缺过、后来补上的）。
test('JD 里点名的工具要能命中知识点（工具名缺失会自动红）', function () {
  const jd = [
    '负责防火墙：熟悉 nftables 规则，了解 iptables 兼容层',
    '会用 ethtool 看网卡协商速率',
    '熟悉 redis-cli 排查大 key，会用 mysqldump 做在线备份',
    '会用 promtool 校验告警规则',
    '了解 rustup 目标管理与交叉编译',
    '前端会用 tsc 做类型检查、npx 与 vite 构建、eslint 检查'
  ].join('；');
  const report = analyzeText(jd, { limit: 20 });
  const ids = report.modules.reduce(function (acc, mod) {
    return acc.concat(mod.points.map(function (p) { return p.id; }));
  }, []);
  ['netops.firewall', 'netops.interface', 'db.redis', 'db.mysql', 'ops.prometheus', 'rust.cargo', 'lang.web'].forEach(function (id) {
    assert.ok(ids.indexOf(id) > -1, 'JD 里点名了对应工具，应命中 ' + id + '，实际：' + ids.join(','));
  });
  // 命中的知识点必须挂着真实的题，否则"命中"没有意义
  const pointsWithTasks = report.modules.reduce(function (acc, mod) {
    return acc.concat(mod.points.filter(function (p) { return (p.tasks || []).length > 0; }).map(function (p) { return p.id; }));
  }, []);
  assert.ok(pointsWithTasks.indexOf('netops.firewall') > -1, '防火墙知识点要能开出题目');
});

test('链接抓取：非 http 直接拒绝，抓不到正文给可执行建议', async function () {
  const bad = await fetchText('ftp://example.com');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /只支持 http\/https/);

  const unreachable = await fetchText('http://127.0.0.1:1/', { timeout: 2000 });
  assert.equal(unreachable.ok, false);
  assert.match(unreachable.reason, /抓取失败|超时/);
});

test('截图 OCR：本机识别出中文（macOS 自带 Vision，离线）', async function () {
  const fixture = new URL('../docs/evidence/web-a11y-2026.png', import.meta.url).pathname;
  if (!existsSync(fixture) || process.platform !== 'darwin') {
    assert.ok(true, '跳过：没有截图样例或不是 macOS');
    return;
  }
  const done = ocrImage(fixture, { home: HOME, timeout: 90000 });
  assert.equal(done.ok, true, 'OCR 应成功：' + done.reason);
  assert.ok(done.text.length > 20, '应识别出文字');
  assert.match(done.text, /dsh|学习|题目/i, '识别结果应包含界面上的文字：' + done.text.slice(0, 80));
  assert.equal(existsSync(ocrHelperPath(HOME)), true, 'OCR 助手应落在独立的 home 目录里');
});

test('data URL 落盘：只收图片类型，体积有上限', function () {
  const tiny = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const saved = saveDataUrl(tiny, { dir: HOME });
  assert.equal(saved.ok, true);
  assert.ok(existsSync(saved.path));

  assert.equal(saveDataUrl('data:text/plain;base64,aGk=', { dir: HOME }).ok, false);
  assert.match(saveDataUrl('data:image/png;base64,' + 'A'.repeat(64), { dir: HOME, maxBytes: 4 }).reason, /图片太大/);
});

test.after(function () {
  rmSync(HOME, { recursive: true, force: true });
});
