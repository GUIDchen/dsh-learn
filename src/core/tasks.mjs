// 题库门面：对外只暴露任务表与查询，数据来自 packs/*.json。
import { loadAll, PACK_DIR, BUILTIN_PACKS } from './packs.mjs';

// 外部题库包目录：用环境变量指定后，其中的包会加载并覆盖同 id 的内置题。
// 用环境变量而不是命令行参数，是为了让 CLI / Web / Agent 三个客户端走同一套加载逻辑。
export const EXTRA_PACK_DIR = process.env.DSH_LEARN_PACKS || '';

let loaded;
try {
  loaded = loadAll(EXTRA_PACK_DIR ? { extraDir: EXTRA_PACK_DIR } : {});
} catch (err) {
  // 信任门禁失败时给一段人能读的说明，而不是直接抛栈。
  console.error('加载外部题库失败：' + err.message);
  console.error('处理建议：node src/cli.mjs pack trust <file> 记录信任，或 node src/cli.mjs pack sign <file> 用本地密钥签名。');
  console.error('如确认无风险，可临时取消门禁：unset DSH_LEARN_REQUIRE_TRUST');
  process.exit(3);
}

export const TASKS = loaded.tasks;
export const TRACKS = loaded.tracks;
export const PACK_IDS = loaded.packIds;
export const BUILTIN_PACK_DIR = PACK_DIR;
// 哪些包是随工具发布的内置包：知识点对账只对它们生效（外部包是用户自己的内容）
export const BUILTIN_PACK_IDS = BUILTIN_PACKS.slice();

// 只算内置包里的题。为什么要单独有这么一份：packs/ 目录里除了随工具发布的包，
// 还可能有用户「加入总题库」时 promote 进来的本地包——文档里的题库数字、
// 知识点对账、判定强度基线这些护栏描述的都是**随工具发布的那份题库**，
// 用户自己往里加题不该把这些护栏弄红（实测：本地包进 packs/ 后 4 条护栏全红）。
// 运行时照旧用 TASKS（含本地包），所以加进来的题能练、能判、能记进度。
export const BUILTIN_TASKS = loaded.tasks.filter(function (task) {
  return BUILTIN_PACK_IDS.indexOf(task.packId) > -1;
});
export const BUILTIN_TRACKS = Array.from(new Set(BUILTIN_TASKS.map(function (task) { return task.track; }))).sort();

export function findTask(id) {
  return TASKS.find(function (item) { return item.id === id; }) || null;
}

export function listTasks(track) {
  return track ? TASKS.filter(function (item) { return item.track === track; }) : TASKS.slice();
}

export function listTracks() {
  return TRACKS.slice();
}

// 难度档位（与 schema 的 LEVELS 一致）：存 ASCII，展示时映射中文
export const LEVELS = ['easy', 'medium', 'hard'];
export const LEVEL_LABELS = { easy: '简单', medium: '中等', hard: '困难' };

export function levelLabel(level) {
  return LEVEL_LABELS[level] || level || '未标注';
}

// 难度分布：CLI 与网页都用它展示"题库按难度怎么分布"
export function levelStats(tasks) {
  const row = { easy: 0, medium: 0, hard: 0, unlabeled: 0 };
  (tasks || TASKS).forEach(function (task) {
    if (LEVELS.indexOf(task.level) === -1) row.unlabeled += 1;
    else row[task.level] += 1;
  });
  return row;
}

// 难度口径的唯一实现（审计、测试与文档都以它为准）：
//   要素数 = 题目与它各平台变体里 require 条数的最大值（变体题按变体算，不然会被算轻）
//   禁止项 = 题目与变体里所有 forbid 的并集；block 级禁止项权重更高
//   easy    ：≤3 要素，且没有 forbid、没有变体
//   hard    ：≥6 要素；或 ≥5 要素且含 block 级禁止项
//   medium  ：其余
export function expectedLevel(task) {
  const variants = Object.keys(task.variants || {});
  const lists = [task.require || []].concat(variants.map(function (key) { return (task.variants[key] || {}).require || []; }));
  const elements = lists.reduce(function (max, row) { return Math.max(max, row.length); }, 0);
  const forbids = [].concat(task.forbid || [], variants.map(function (key) {
    return (task.variants[key] || {}).forbid || [];
  }).reduce(function (all, row) { return all.concat(row); }, []));
  const hasBlock = forbids.some(function (rule) { return rule && rule.severity === 'block'; });
  if (elements <= 3 && !forbids.length && !variants.length) return 'easy';
  if (elements >= 6 || (elements >= 5 && hasBlock)) return 'hard';
  return 'medium';
}

export function listTasksByLevel(level, track) {
  return TASKS.filter(function (task) {
    if (level && level !== 'all' && task.level !== level) return false;
    if (track && track !== 'all' && task.track !== track) return false;
    return true;
  });
}

// 变体题：给同一道题附上「同一条命令在别的平台怎么写」（web 学习域与 CLI tasks 共用一份）
export function otherPlatformSamples(task, current) {
  const variants = (task && task.variants) || null;
  if (!variants) return null;
  const out = {};
  Object.keys(variants).forEach(function (platform) {
    if (platform === current) return;
    const sample = variants[platform] && variants[platform].sample;
    if (sample) out[platform] = sample;
  });
  return Object.keys(out).length ? out : null;
}
