// 题包脚手架与深度校验。
//
// 背景：题库包是这个项目的核心资产（packs/*.json，55 个包 / 637 道题），但建包只能手写 JSON：
//   · core/schema.mjs 只查结构（字段、枚举、正则可编译、verify 在白名单内）；
//   · 「难度必须等于口径」「参考答案必须在它自己的平台拿满分」只在 CI 的 catalog-audit 里查。
// 结果：作者本地 pack validate 通过、到 CI 才发现口径问题。这里把两条权威口径下沉到本地可跑，
// 并提供 pack new 生成**开箱即通过校验**的模板（不替作者编题面，只保证结构、口径、自测成立）。
import { expectedLevel } from './tasks.mjs';
import { validatePack } from './schema.mjs';
import { auditTask } from './catalog-audit.mjs';
import { isAllowed } from './exec.mjs';

const TODO_MARK = 'TODO';

// 从参考答案里推出最小要素集：首个子命令 + 长选项。
// 只用于**模板**——让"生成即通过深度校验"成立；作者随后应按题意改写 tip 与要素。
export function deriveRequire(sample) {
  const text = String(sample || '').trim();
  if (!text) return [];
  const parts = text.split(/\s+/);
  const head = parts[0];
  const flags = parts.filter(function (row) { return /^--[a-z][a-z0-9-]*$/i.test(row); });
  const picked = [head].concat(flags).slice(0, 3);
  return picked.map(function (token) {
    return {
      p: token.replace(/[.*+?^$|[\]{}\\]/g, '\\$&'),
      tip: '要包含 ' + token + '（模板自动生成，请按题意改成"为什么必须这样写"）'
    };
  });
}

export function packTemplate(meta) {
  const input = meta || {};
  const id = String(input.id || '').trim();
  if (!id) throw new Error('pack new 需要一个包 id，例如：node src/cli.mjs pack new database-pg --name=... --track=database');
  const track = String(input.track || id.split('-')[0] || 'general').trim();
  const title = String(input.title || (input.name || id) + '：第一道题').trim();
  const sample = String(input.sample || '').trim();
  const task = {
    id: String(input.taskId || (track + '.' + (id.split('-').slice(1).join('-') || 'first'))).trim(),
    track: track,
    title: title,
    goal: String(input.goal || (TODO_MARK + '：一句话说清"做完要达成什么"（会显示给学员）')).trim(),
    hint: String(input.hint || (TODO_MARK + '：给思路，不要直接给答案')).trim(),
    sample: sample,
    require: Array.isArray(input.require) && input.require.length ? input.require : deriveRequire(sample),
    forbid: []
  };
  // 难度不手填：按口径算，避免"声明的难度和实际要素数对不上"
  task.level = expectedLevel(task);
  if (input.verifyCmd) {
    task.verify = { cmd: String(input.verifyCmd), expect: String(input.verifyExpect || '.'), note: String(input.verifyNote || '只读校验') };
  }
  return {
    id: id,
    name: String(input.name || title),
    track: track,
    version: 1,
    tasks: [task]
  };
}

// 深度校验 = 结构校验 + 难度口径 + 参考答案自测（复用 catalog-audit 的权威检查）
export function deepValidate(pack, options) {
  const opts = options || {};
  const errors = [];
  const warnings = [];
  const structural = validatePack(pack, { isAllowedCommand: isAllowed });
  structural.errors.forEach(function (msg) { errors.push(msg); });
  structural.warnings.forEach(function (msg) { warnings.push(msg); });

  const tasks = Array.isArray(pack && pack.tasks) ? pack.tasks : [];
  tasks.forEach(function (task) {
    if (!task || typeof task !== 'object') return;
    const where = task.id || '(无 id 的任务)';
    // 1) 难度必须等于口径
    const expect = expectedLevel(task);
    if (task.level && task.level !== expect) {
      errors.push(where + ' 的难度声明与口径不符：写的是 ' + task.level + '，按要素数应当是 ' + expect
        + '（要素 ' + ((task.require || []).length) + ' 个，禁止项 ' + ((task.forbid || []).length) + ' 个，变体 ' + Object.keys(task.variants || {}).length + ' 个）');
    }
    // 2) 权威口径：参考答案必须在自己的平台拿满分
    auditTask(task).forEach(function (finding) {
      const line = where + '（' + (finding.platform || '通用') + '）' + finding.message;
      if (finding.level === 'error') errors.push(line);
      else warnings.push(line);
    });
    // 3) 模板占位要显式提醒，别让 TODO 混进正式包
    const texts = [task.title, task.goal, task.hint].concat((task.require || []).map(function (r) { return r && r.tip; }));
    const todos = texts.filter(function (t) { return typeof t === 'string' && t.indexOf(TODO_MARK) > -1; }).length;
    if (todos) warnings.push(where + ' 还有 ' + todos + ' 处 ' + TODO_MARK + ' 没填（模板生成后必须补齐才能发布）');
    if (!task.sample) warnings.push(where + ' 没有参考答案（sample）：学员判错时看不到标准写法');
  });

  return {
    ok: errors.length === 0,
    packId: structural.packId || (pack && pack.id) || '',
    taskCount: tasks.length,
    errors: errors,
    warnings: warnings
  };
}

export function renderPackCheck(result) {
  const out = [];
  out.push('包：' + result.packId + '　任务数：' + result.taskCount);
  result.errors.forEach(function (msg) { out.push('错误：' + msg); });
  result.warnings.forEach(function (msg) { out.push('警告：' + msg); });
  out.push(result.ok ? (result.warnings.length ? '深度校验通过（有 ' + result.warnings.length + ' 条提醒）' : '深度校验通过') : '深度校验失败');
  return out.join(String.fromCharCode(10));
}
