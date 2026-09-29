// 判定强度体检：拿"偷懒答案"去过一遍全部题目，看有没有题能被一行工具名骗过。
//
// 为什么需要：难度口径只看"要素条数"，但要素**能不能判住**才是关键。
// 一道题如果整道题就判一个工具名，学员敲四个字母就满分——它会拉高通过率，让计划与建议失真。
//
// 两档指标：
//   hole（漏洞）：要素 ≥2，但只写工具名就 100 分 —— 说明某个要素等于没判，必须修（--check 里是硬失败）
//   soft（偏软）：只写工具名就 100 分（单要素题本来就可能是"知道用哪个命令"）—— 记录数量，不许变多
//
// 用法：
//   node scripts/judge-sweep.mjs           打印结果
//   node scripts/judge-sweep.mjs --check   有 hole 就以 1 退出（soft 超过基线同样退出 1）
import { TASKS, BUILTIN_TASKS } from '../src/core/tasks.mjs';
import { judge, resolveTask } from '../src/core/judge.mjs';

// 单要素题里"答案就是工具名"的那两道，写在明处、数量只许减不许增：
//   system.memory-snapshot（vm_stat）、netops.time-sync-check（timedatectl）
// 它们**不是漏洞**：正确答案本来就是一个裸命令（macOS 看内存就是 vm_stat；timedatectl 不带子命令也会打印同步状态），
// 硬加第二个要素会把正确写法判成 50 分——假阴性比偏软更伤学员。
// 真正要拦的是 hole：要素 ≥2 却只写工具名就能满分，那说明某个要素等于没判。
const SOFT_BASELINE = 2;

// all=true 时连本地包一起扫（用户自己加的题也想体检就用它）；默认只扫内置包——
// 判定强度基线是给「随工具发布的题库」定的，用户加进来的题不该把基线顶红。
export function sweep(platform, options) {
  const rows = [];
  const pool = (options && options.all) ? TASKS : BUILTIN_TASKS;
  pool.forEach(function (task) {
    const resolved = resolveTask(task, platform || 'darwin');
    if (!resolved.sample) return;
    const tool = resolved.sample.trim().split(/\s+/)[0];
    const result = judge(task, tool, platform || 'darwin');
    rows.push({
      id: task.id,
      track: task.track,
      level: task.level || '未标注',
      elements: (resolved.require || []).length,
      tool: tool,
      toolScore: result.score,
      sample: resolved.sample
    });
  });
  return {
    total: rows.length,
    holes: rows.filter(function (row) { return row.elements >= 2 && row.toolScore >= 100; }),
    soft: rows.filter(function (row) { return row.toolScore >= 100; })
  };
}

const platform = (process.argv.filter(function (a) { return a.indexOf('--platform=') === 0; })[0] || '--platform=darwin').split('=')[1];

if (process.argv[1] && process.argv[1].indexOf('judge-sweep.mjs') > -1) {
  const report = sweep(platform);
  console.log('题目 ' + report.total + ' 道（带参考答案），按 ' + platform + ' 平台判定');
  console.log('漏洞（要素≥2 却只写工具名就满分）：' + report.holes.length + ' 道');
  report.holes.forEach(function (row) {
    console.log('  ' + row.id + ' [' + row.level + '/' + row.elements + ' 要素] 答案 "' + row.tool + '" → ' + row.toolScore + ' 分');
  });
  console.log('偏软（只写工具名就满分，含单要素题）：' + report.soft.length + ' 道（基线 ' + SOFT_BASELINE + '）');
  report.soft.forEach(function (row) {
    console.log('  ' + row.id + ' [' + row.level + '/' + row.elements + ' 要素] ' + JSON.stringify(row.sample));
  });
  const bad = report.holes.length > 0 || report.soft.length > SOFT_BASELINE;
  if (process.argv.indexOf('--check') > -1 && bad) {
    console.log('检查失败：漏洞 ' + report.holes.length + ' 道、偏软 ' + report.soft.length + ' 道（基线 ' + SOFT_BASELINE + '）');
    process.exit(1);
  }
}
