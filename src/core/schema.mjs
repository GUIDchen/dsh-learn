// 题库包校验：纯函数，不碰文件系统，浏览器/CLI/服务端共用同一套规则。
import { PROFILES } from './platform.mjs';

const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const PLATFORMS = Object.keys(PROFILES);
// 难度档位：存 ASCII 值（便于过滤与 URL 参数），展示时映射成中文
export const LEVELS = ['easy', 'medium', 'hard'];
export const LEVEL_LABELS = { easy: '简单', medium: '中等', hard: '困难' };

function checkRules(list, where, errors) {
  if (!Array.isArray(list)) {
    errors.push(where + ' 必须是数组');
    return;
  }
  list.forEach(function (rule, index) {
    const at = where + '[' + index + ']';
    if (!rule || typeof rule.p !== 'string' || !rule.p) {
      errors.push(at + ' 缺少正则字段 p');
      return;
    }
    try {
      new RegExp(rule.p);
    } catch (err) {
      errors.push(at + ' 正则无法编译: ' + rule.p);
    }
    if (typeof rule.tip !== 'string' || !rule.tip) errors.push(at + ' 缺少提示文本 tip');
    if (rule.severity !== undefined && ['warn', 'block'].indexOf(rule.severity) === -1) {
      errors.push(at + ' 的 severity 只能是 warn 或 block');
    }
  });
}

export function validateTask(task, options) {
  const opts = options || {};
  const isAllowed = opts.isAllowedCommand || function () { return true; };
  const errors = [];
  const at = 'task ' + (task && task.id ? task.id : '(无 id)');

  if (!task || typeof task !== 'object') return { id: '(无效)', errors: ['任务不是对象'], warnings: [] };
  if (typeof task.id !== 'string' || !ID_RE.test(task.id)) errors.push(at + ' 的 id 需形如 track.name（小写字母数字与短横线）');
  if (typeof task.track !== 'string' || !task.track) errors.push(at + ' 缺少 track');
  if (typeof task.title !== 'string' || !task.title) errors.push(at + ' 缺少 title');
  if (typeof task.goal !== 'string' || !task.goal) errors.push(at + ' 缺少 goal');
  // 难度标注：简单 / 中等 / 困难，用 ASCII 值存、客户端负责显示中文
  if (task.level !== undefined && LEVELS.indexOf(task.level) === -1) {
    errors.push(at + ' 的 level 只能是 ' + LEVELS.join(' / ') + '，实际：' + task.level);
  }

  // platforms：显式声明「这道题只在这些平台上成立」（launchctl 就是 macOS 独有、bash 3.2 的写法只分 macOS/Linux）。
  // 不声明就是三个主平台都该有参考答案——审计据此区分「还没写」和「本来就没有」。
  // 这里必须校验：写错一个平台名（macos）会让那道题在真平台上悄悄逃过体检。
  if (task.platforms !== undefined) {
    if (!Array.isArray(task.platforms) || task.platforms.length === 0) {
      errors.push(at + ' 的 platforms 必须是非空数组');
    } else {
      task.platforms.forEach(function (name) {
        if (PLATFORMS.indexOf(name) === -1) errors.push(at + ' 的 platforms 里有未知平台 ' + name + '（已知：' + PLATFORMS.join('/') + '）');
      });
    }
  }

  const hasVariants = task.variants && Object.keys(task.variants).length > 0;
  if (!hasVariants) {
    if (!Array.isArray(task.require) || task.require.length === 0) errors.push(at + ' 至少要有一个 require 要素');
  } else {
    Object.keys(task.variants).forEach(function (key) {
      if (PLATFORMS.indexOf(key) === -1) errors.push(at + ' 的平台变体 ' + key + ' 不在已知平台 ' + PLATFORMS.join('/'));
      const variant = task.variants[key] || {};
      if (!Array.isArray(variant.require) || variant.require.length === 0) errors.push(at + '/' + key + ' 变体缺少 require');
    });
  }

  checkRules(task.require, at + '.require', errors);
  checkRules(task.forbid || [], at + '.forbid', errors);

  const verifySpecs = [];
  if (task.verify) verifySpecs.push({ spec: task.verify, where: at });
  Object.keys(task.variants || {}).forEach(function (key) {
    if (task.variants[key].verify) verifySpecs.push({ spec: task.variants[key].verify, where: at + '/' + key });
  });
  verifySpecs.forEach(function (item) {
    const spec = item.spec;
    if (typeof spec.cmd !== 'string' || !spec.cmd) errors.push(item.where + ' 的 verify 缺少 cmd');
    if (typeof spec.expect !== 'string' || !spec.expect) errors.push(item.where + ' 的 verify 缺少 expect');
    else {
      try {
        new RegExp(spec.expect);
      } catch (err) {
        errors.push(item.where + ' 的 verify.expect 正则无法编译: ' + spec.expect);
      }
    }
    if (spec.cmd && !isAllowed(spec.cmd)) errors.push(item.where + ' 的 verify 命令不在只读白名单内: ' + spec.cmd);
  });

  return { id: task.id, errors: errors, warnings: [] };
}

export function validatePack(pack, options) {
  const errors = [];
  const warnings = [];
  if (!pack || typeof pack !== 'object') return { packId: '(无效)', errors: ['题库包不是对象'], warnings: [], taskCount: 0 };
  if (typeof pack.id !== 'string' || !pack.id) errors.push('题库包缺少 id');
  if (typeof pack.track !== 'string' || !pack.track) errors.push('题库包 ' + pack.id + ' 缺少 track');
  if (!Array.isArray(pack.tasks) || pack.tasks.length === 0) errors.push('题库包 ' + pack.id + ' 没有任务');

  const seen = new Set();
  (pack.tasks || []).forEach(function (task) {
    const result = validateTask(task, options);
    result.errors.forEach(function (msg) { errors.push('[' + pack.id + '] ' + msg); });
    if (task && task.id) {
      if (seen.has(task.id)) errors.push('[' + pack.id + '] 任务 id 重复: ' + task.id);
      seen.add(task.id);
      if (pack.track && task.track && task.track !== pack.track) {
        warnings.push('[' + pack.id + '] 任务 ' + task.id + ' 的 track 与包 track 不一致');
      }
    }
  });

  return { packId: pack.id, errors: errors, warnings: warnings, taskCount: (pack.tasks || []).length };
}

export function assertPack(pack, options) {
  const result = validatePack(pack, options);
  if (result.errors.length) {
    throw new Error('题库包校验失败 [' + result.packId + ']: ' + result.errors.join('; '));
  }
  return result;
}
