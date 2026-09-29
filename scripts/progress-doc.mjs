// 生成 docs/PROGRESS.md：项目进度与计划完成情况。
// 数字全部从运行时与仓库文件推导，不手抄——文档与代码不会各说各话。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

// 进度文档描述的是**随工具发布的题库**：用户自己 promote 进用户题库目录的包不该改变这里
// 的数字（否则他跑一次文档生成，文档就开始描述"他的机器"而不是这份题库）。
// 用户包的数量另起一行如实写出来。
const { TASKS: ALL_TASKS, BUILTIN_TASKS: TASKS, TRACKS, BUILTIN_PACK_IDS: PACK_IDS, levelStats } = await import('../src/core/tasks.mjs');
const { POINTS, MODULES } = await import('../src/core/knowledge.mjs');
const { auditCatalog, auditStructure } = await import('../src/core/catalog-audit.mjs');
const { ALLOWLIST } = await import('../src/core/exec.mjs');

function readJSON(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (err) { return null; }
}
function readText(file) { return readFileSync(file, 'utf8'); }
function lines(text) { return text.split('\n'); }

const pkg = readJSON('package.json');
const last = readJSON('docs/evidence/last-verify.json');
// 逐轮日志已按 50 轮一卷拆到 docs/report/，这里把所有卷拼起来读（索引文件里只有目录）
const report = readdirSync(join(ROOT, 'docs/report'))
  .filter(function (name) { return /^rounds-[0-9]{3}-[0-9]{3}\.md$/.test(name); })
  .sort()
  .map(function (name) { return readText('docs/report/' + name); })
  .join(String.fromCharCode(10));
const releases = lines(readText('docs/RELEASES.md')).filter(function (row) { return /^\| \d+\.\d+/.test(row); });

// 轮次：报告里每个「（第 N 轮 / 共 250 轮）」的章节
const rounds = [];
lines(report).forEach(function (row) {
  const hit = row.match(/^## 5\.\d+ .*（第 (\d+) 轮 \/ 共 (\d+) 轮/);
  if (hit) {
    rounds.push({
      round: Number(hit[1]),
      total: Number(hit[2]),
      title: row.replace(/^## /, '').replace(/^5\.\d+\s*/, '').replace(/（第 \d+ 轮 \/ 共 \d+ 轮[^）]*）/, '').trim()
    });
  }
});
const latest = rounds.length ? Math.max.apply(null, rounds.map(function (r) { return r.round; })) : 0;
const total = rounds.length ? rounds[rounds.length - 1].total : 250;

const levels = levelStats();
const byTrack = {};
TASKS.forEach(function (task) { byTrack[task.track] = (byTrack[task.track] || 0) + 1; });
// 用户题库（~/.dsh-learn/packs/）里的题：如实报出来，但不算进上面那份"随工具发布的题库"
const localTasks = ALL_TASKS.length - TASKS.length;
const catalog = auditCatalog(TASKS, { builtin: true });
const structure = auditStructure(TASKS, { points: POINTS, builtin: true });
const withVariants = TASKS.filter(function (t) { return t.variants; }).length;
const withVerify = TASKS.filter(function (t) { return t.verify; }).length;
const testFiles = readdirSync('test').filter(function (name) { return /\.test\.mjs$/.test(name); }).length;
const verifyChecks = lines(readText('scripts/verify.sh')).filter(function (row) { return /^check /.test(row); }).length;

const out = [];
function put(row) { out.push(row); }

put('# 进度与计划完成情况');
put('');
put('> 这份文档由脚本生成（node scripts/progress-doc.mjs），数字全部来自运行时数据与仓库文件，含最近一次 verify 的实测记录。');
put('> 改题库、加测试、发版本之后重新生成一次即可，不需要手抄任何数字。');
put('');
put('## 一、计划（目标）与当前完成情况');
put('');
put('| 阶段 | 内容 | 目标 | 状态 |');
put('| --- | --- | --- | --- |');
const stage1 = latest >= 50 ? '已完成（第 50 轮为节点，见完成报告 5.53 节小结）' : '进行中 ' + latest + ' / 50';
const stage2 = latest >= 50 ? '进行中 ' + (latest - 50) + ' / 200（累计已记录 ' + latest + ' 轮）' : '未开始';
put('| 第一阶段 · 打磨 | 界面与布局、可读性、性能、无障碍、离线体验、题库与知识点一致性、题库扩充、交互与判定体验、真环境验证、版本化发布 | 50 轮 | ' + stage1 + ' |');
put('| 第二阶段 · 继续推进 | 同一批目标继续做，每轮都要实测证据并同步文档 | 再 200 轮（累计 ' + total + ' 轮） | ' + stage2 + ' |');
put('');
put('- 完成报告章节（每轮一节）：' + rounds.length + ' 节，最近一节：第 ' + latest + ' 轮');
put('- 当前版本：' + (pkg ? pkg.version : '-') + '；发布记录：' + releases.length + ' 条（docs/RELEASES.md）');
put('');
put('## 二、交付物现状');
put('');
put('| 项目 | 数值 |');
put('| --- | --- |');
put('| 题库 | ' + TASKS.length + ' 题（' + PACK_IDS.length + ' 个数据包 / ' + TRACKS.length + ' 条轨道） |');
put('| 难度分布 | 简单 ' + levels.easy + ' / 中等 ' + levels.medium + ' / 困难 ' + levels.hard + '，未标注 ' + levels.unlabeled + ' |');
put('| 平台变体题 | ' + withVariants + ' 道（同一场景在 BSD / GNU 等平台上写法不同） |');
put('| 只读验证项 | ' + withVerify + ' 道题带 verify；白名单规则 ' + ALLOWLIST.length + ' 条 |');
put('| 知识点 | ' + POINTS.length + ' 个 / ' + MODULES.length + ' 个模块 |');
if (localTasks > 0) {
  put('| 用户题库 | ' + localTasks + ' 道题（放在用户题库目录里，自己 promote 进来的；不计入上一行） |');
}
put('| 题库体检 | 错误 ' + catalog.errors.length + ' / 提醒 ' + catalog.warnings.length + '；结构提醒 ' + structure.findings.length + ' |');
put('| 测试文件 | ' + testFiles + ' 个（node --test） |');
put('| verify.sh 检查点 | ' + verifyChecks + ' 处 check 调用（实际执行项数以「最近一次实测」为准，另有原生自检 20 条断言） |');
if (last) {
  put('| 最近一次实测 | ' + String(last.at).replace('T', ' ').slice(0, 19) + '：node --test ' + last.testPass + ' / ' + last.tests
    + '，verify PASS ' + last.verifyPass + ' / FAIL ' + last.verifyFail + '，版本 ' + last.version + ' |');
} else {
  put('| 最近一次实测 | 还没有记录：跑一次 bash scripts/verify.sh 会写入 docs/evidence/last-verify.json |');
}
put('');
put('## 二之补、最近轮次记录');
put('');
put('| 轮次 | 做了什么 |');
put('| --- | --- |');
rounds.slice(-6).reverse().forEach(function (row) {
  put('| 第 ' + row.round + ' 轮 | ' + row.title.replace(/（第 \d+ 轮 \/ 共 \d+ 轮.*$/, '') + ' |');
});
put('');
put('（每轮都记在 docs/COMPLETION-REPORT.md，这里是最近 6 轮的标题，脚本从报告里解析，不手抄。）');
put('');
put('## 二之补二、每轮在做什么：类型分布与题库增长');
put('');
put('按每轮标题里的关键词归类（脚本统计，不是人工打标）：');
put('');
const BUCKETS = [
  { name: '题库扩充与分类', re: /题库|难度标注|变体/ },
  { name: '界面与交互', re: /界面|布局|可读|判定结果|空状态|徽标|键盘|触屏|面板/ },
  { name: '体验与判定', re: /判定|开练|离线|复盘|计划完成/ },
  { name: '项目与仓库出题', re: /项目|仓库|草案|promote|clone|克隆/ },
  { name: '客户端', re: /原生|macos|客户端|网页版/ },
  { name: '文档与进度记录', re: /文档|进度|报告|README/ },
  { name: '性能与无障碍', re: /性能|耗时|无障碍|首屏/ },
  { name: '验证与发布', re: /verify|白名单|打包|发布|版本/ }
];
const bucketCounts = BUCKETS.map(function (bucket) {
  return { name: bucket.name, rounds: rounds.filter(function (row) { return bucket.re.test(row.title); }).length };
});
put('| 类型 | 轮次 |');
put('| --- | --- |');
bucketCounts.filter(function (row) { return row.rounds > 0; }).sort(function (a, b) { return b.rounds - a.rounds; }).forEach(function (row) {
  put('| ' + row.name + ' | ' + row.rounds + ' |');
});
put('');
put('（一轮常同时属于多类，所以合计大于轮数。）');
put('');
// 题库增长曲线：从标题里的「题库 NNN 题」抓点
const growth = [];
rounds.forEach(function (row) {
  const hit = row.title.match(/题库\s*(\d+)\s*题/);
  if (hit) growth.push({ round: row.round, tasks: Number(hit[1]) });
});
if (growth.length) {
  put('题库增长（每轮标题里报出的数字）：');
  put('');
  put('| 轮次 | 题库 |');
  put('| --- | --- |');
  growth.forEach(function (row) { put('| 第 ' + row.round + ' 轮 | ' + row.tasks + ' 题 |'); });
  put('');
}
put('## 三、分轨道题量');
put('');
put('| 轨道 | 题数 |');
put('| --- | --- |');
Object.keys(byTrack).sort(function (a, b) { return byTrack[b] - byTrack[a] || a.localeCompare(b); }).forEach(function (track) {
  put('| ' + track + ' | ' + byTrack[track] + ' |');
});
put('');
put('## 四、每轮必须留下的证据（清单）');
put('');
put('1. node --test 全绿；');
put('2. bash scripts/verify.sh 全绿，并写入 docs/evidence/last-verify.json（本文档第二节直接引用）；');
put('3. 与改动相关的实测：浏览器实测（DOM / 无障碍 / 离线）、命令行判定实测、或原生客户端自检；');
put('4. 同步更新 docs/ 与 README（题库数字、功能说明、完成报告新增一节）；');
put('5. 有用户可见变化时发版本：bash scripts/release-mac.sh --ad-hoc --bump minor --note ...。');
put('');
put('## 五、最近发布');
put('');
put('| 版本 | 时间 | 题库 | 说明 |');
put('| --- | --- | --- | --- |');
releases.slice(-8).reverse().forEach(function (row) {
  const cells = row.split('|').map(function (cell) { return cell.trim(); });
  put('| ' + cells[1] + ' | ' + cells[2] + ' | ' + cells[3] + ' | ' + cells[5] + ' |');
});
put('');
put('## 六、学习侧的计划完成情况');
put('');
put('题库按每天 2 小时编排成学习计划（node src/cli.mjs plan），进度用 node src/cli.mjs plan --status 看：');
put('它把计划里的每一天与真实提交记录对齐，给出整体完成度、整天完成数，以及按当前进度还需多少天。');
put('个人记录存在 ~/.dsh-learn（不进仓库），所以这份文档只放项目侧的数字。');
put('');

writeFileSync('docs/PROGRESS.md', out.join('\n') + '\n');
console.log('docs/PROGRESS.md 已生成：' + out.length + ' 行；第 ' + latest + ' / ' + total + ' 轮，题库 ' + TASKS.length + ' 题');
