// 题库质量体检：把"出题规范"从文档变成可执行检查。
// 最重要的两条：题库自带的参考答案必须在它自己的平台上拿满分；平台变体必须有区分度。
import { judge, resolveTask } from './judge.mjs';
import { expectedLevel } from './tasks.mjs';
import { isAllowed } from './exec.mjs';

// 主平台就是题库承认要评测的三个：win32 曾经不在里面，于是**只有声明了 win32 变体的题才会按 win32 审**，
// 其余题在 Windows 上是否还有参考答案、兜底规则是否说得通，从来没人看过（实测 24 处缺口）。
export const MAIN_PLATFORMS = ['darwin', 'linux', 'win32'];

function platformsOf(task) {
  // 主平台全审一遍（题目显式声明 platforms 时以声明为准），外加题目自己声明的其他平台
  // （将来加 freebsd 之类也不会漏）。声明过 platforms 的题不再算其他平台的缺口：
  // 「还没写」和「本来就不适用」是两件事，混在一起缺口数永远清不到零，看的人就不看了。
  const declared = Array.isArray(task.platforms) && task.platforms.length ? task.platforms : MAIN_PLATFORMS;
  return Array.from(new Set(declared.concat(Object.keys(task.variants || {}))));
}

export function auditTask(task) {
  const findings = [];
  const add = function (level, platform, message) {
    findings.push({ level: level, taskId: task.id, track: task.track, platform: platform || null, message: message });
  };

  const declaredVariants = Object.keys(task.variants || {});
  platformsOf(task).forEach(function (platform) {
    const resolved = resolveTask(task, platform);

    // 1. 参考答案必须在本平台拿满分——否则是规则写错了，不是学员写错了
    if (resolved.sample) {
      const result = judge(task, resolved.sample, platform);
      if (result.score < 100) {
        add('error', platform, '参考答案只拿到 ' + result.score + ' 分：' + (result.missing.concat(result.notes).join('；') || '未知原因'));
      }
    } else if (declaredVariants.length && declaredVariants.indexOf(platform) === -1) {
      // 有变体、但这个平台没给：不是"提醒"，而是**平台缺口**（另算一档，跟薄轨道一样是扩充信号，不是不合格）
      add('gap', platform, '这个平台没有参考答案（变体只写了 ' + declaredVariants.join(' / ') + '）');
    } else {
      add('warn', platform, '没有参考答案（sample），学员判错时看不到标准写法');
    }

    // 2. verify 命令必须在只读白名单内，否则"只读验证"永远跑不了
    if (resolved.verify && !isAllowed(resolved.verify.cmd)) {
      add('error', platform, '验证命令不在只读白名单内：' + resolved.verify.cmd);
    }

    // 3. 同一题内的提示文本不该重复（重复说明要素拆分粒度有问题）
    const tips = resolved.require.map(function (rule) { return rule.tip; });
    const duplicated = tips.filter(function (tip, index) { return tips.indexOf(tip) !== index; });
    if (duplicated.length) {
      add('warn', platform, '要素提示重复：' + Array.from(new Set(duplicated)).join('；'));
    }
  });

  // 声明了 platforms 就不再是「这道题欠了某个平台的答案」；但两者冲突（说好不适用却给了变体）必须报错：
  // 否则学员在那个平台会被变体规则判分，而题目自己说不该在那儿练。
  const declared = Array.isArray(task.platforms) ? task.platforms : [];
  if (declared.length) {
    declaredVariants.filter(function (platform) { return declared.indexOf(platform) === -1; }).forEach(function (platform) {
      add('error', platform, 'platforms 没写 ' + platform + '，却给了 ' + platform + ' 变体');
    });
  }

  // 4. 有变体时：缺的另一半必须由顶层规则兜住，否则那些平台的学员没有判定依据
  const variantKeys = Object.keys(task.variants || {});
  if (variantKeys.length) {
    const baseRules = (task.require || []).length;
    const missing = MAIN_PLATFORMS.filter(function (p) { return variantKeys.indexOf(p) === -1; });
    if (missing.length && !baseRules) {
      add('warn', null, '只写了 ' + variantKeys.join('/') + ' 变体，缺 ' + missing.join('/') + '，且顶层没有兜底规则');
    }

    // 5. 变体区分度：把一个平台的参考答案拿到另一个平台，应该拿不到满分
    variantKeys.forEach(function (platform) {
      const resolved = resolveTask(task, platform);
      variantKeys.filter(function (other) { return other !== platform; }).forEach(function (other) {
        const otherSample = resolveTask(task, other).sample;
        if (!otherSample || !resolved.sample) return;
        const result = judge(task, otherSample, platform);
        if (result.score === 100) {
          add('warn', platform, '与本平台写法无区分度：' + other + ' 的参考答案在这里也满分');
        }
      });
    });
  }

  return findings;
}

// 知识点覆盖对账：每道题都必须挂在至少一个知识点上，
// 否则学员从"岗位/文档分析"永远找不到这道题（反向的缺口）。
export function auditKnowledgeCoverage(tasks, points) {
  const used = new Set();
  (points || []).forEach(function (point) {
    (point.tasks || []).forEach(function (id) { used.add(id); });
  });
  const orphans = (tasks || []).filter(function (task) { return !used.has(task.id); }).map(function (task) { return task.id; });
  return { referenced: used.size, orphans: orphans };
}

// 题库结构体检：轨道题数下限、知识点挂题情况、验证项覆盖。
// 这些是"长期不退化"的护栏：数量掉下去或知识点变空，都要在 CI 里立刻可见。
export const MIN_TASKS_PER_TRACK = 3;

export function auditStructure(tasks, options) {
  const opts = options || {};
  const list = tasks || [];
  const points = opts.points || [];
  const findings = [];

  const byTrack = {};
  list.forEach(function (task) {
    const row = byTrack[task.track] || { total: 0, withVerify: 0 };
    row.total += 1;
    if (task.verify) row.withVerify += 1;
    byTrack[task.track] = row;
  });

  Object.keys(byTrack).forEach(function (track) {
    // 题数下限只对内置题库生效：别人自己写的小包（两三道题）不该被判不合格
    if (opts.builtin && byTrack[track].total < MIN_TASKS_PER_TRACK) {
      findings.push({ level: 'error', taskId: null, track: track, platform: null, message: '轨道 ' + track + ' 只有 ' + byTrack[track].total + ' 道题，低于下限 ' + MIN_TASKS_PER_TRACK });
    }
    if (byTrack[track].withVerify === 0) {
      findings.push({ level: 'warn', taskId: null, track: track, platform: null, message: '轨道 ' + track + ' 还没有任何带只读验证项的题（verify 覆盖率 0）' });
    }
  });

  // 难度标注要对得上口径：手写一个 hard 却只有 2 个要素，会让人按错误预期选题
  list.forEach(function (task) {
    if (!task.level) return;
    const expected = expectedLevel(task);
    if (task.level !== expected) {
      findings.push({
        level: 'warn',
        taskId: task.id,
        track: task.track,
        platform: null,
        message: '难度标注与口径不符：标了 ' + task.level + '，按要素与禁止项应为 ' + expected
      });
    }
  });

  if (points.length) {
    points.forEach(function (point) {
      if (!point.tasks || !point.tasks.length) {
        findings.push({ level: 'error', taskId: null, track: null, platform: null, message: '知识点 ' + point.id + ' 没有挂任何题：学员按知识点练时点不进去' });
      }
    });
    const taskIds = new Set(list.map(function (task) { return task.id; }));
    points.forEach(function (point) {
      (point.tasks || []).forEach(function (id) {
        if (!taskIds.has(id)) {
          findings.push({ level: 'error', taskId: id, track: null, platform: null, message: '知识点 ' + point.id + ' 指向了不存在的题：' + id });
        }
      });
    });
  }

  return { findings: findings, byTrack: byTrack };
}

export function auditCatalog(tasks, options) {
  const opts = options || {};
  const list = tasks || [];
  const findings = [];
  const externalOrphans = [];
  if (opts.points) {
    const coverage = auditKnowledgeCoverage(list, opts.points);
    // 知识点对账是**内置题库的不变量**：字典是随工具发布的一份数据，内置的每道题都得能
    // 从「岗位/文档分析」点进来。外部包（用 DSH_LEARN_PACKS 加载、用户从自己仓库学出来的题）
    // 不在字典里，报错等于让用户去改工具的源码——实测：推广一份仓库草案后 audit 直接 7 个错误，
    // 而下一步还写着「请把 draft.k8s.start 加进 src/core/knowledge.mjs」，那是一条死路。
    // 所以：内置题照旧报错（护栏不放水），外部题只统计、不判错。
    const eligible = opts.builtinTaskIds ? new Set(opts.builtinTaskIds) : null;
    coverage.orphans.forEach(function (id) {
      const row = list.filter(function (t) { return t.id === id; })[0] || {};
      if (eligible && !eligible.has(id)) {
        externalOrphans.push({ taskId: id, track: row.track || null, packId: row.packId || null });
        return;
      }
      findings.push({ level: 'error', taskId: id, track: row.track || null, platform: null, message: '这道题没有挂到任何知识点：学员从岗位/文档分析里永远看不到它。请把 ' + id + ' 加进 src/core/knowledge.mjs 对应知识点的 tasks' });
    });
  }
  list.forEach(function (task) {
    auditTask(task).forEach(function (item) { findings.push(item); });
  });
  const structure = auditStructure(list, { points: opts.points, builtin: opts.builtin });
  structure.findings.forEach(function (item) { findings.push(item); });

  const errors = findings.filter(function (item) { return item.level === 'error'; });
  const warns = findings.filter(function (item) { return item.level === 'warn'; });
  // 平台缺口：有变体、但某些主平台没给参考答案。与"薄轨道"同类——是扩充信号，不是不合格。
  const gaps = findings.filter(function (item) { return item.level === 'gap'; });
  const byTrack = {};
  list.forEach(function (task) { byTrack[task.track] = (byTrack[task.track] || 0) + 1; });

  // 薄轨道：不是错误，也不是"要注意"，而是"下一步该往哪扩充"的信号。
  // 单独一个字段，避免把体检结论（0 提醒）和扩充建议混在一起。
  const thinLimit = Number(opts.thinLimit) > 0 ? Number(opts.thinLimit) : 10;
  const thin = Object.keys(byTrack)
    .filter(function (track) { return byTrack[track] < thinLimit; })
    .map(function (track) { return { track: track, tasks: byTrack[track] }; })
    .sort(function (a, b) { return a.tasks - b.tasks; });

  return {
    ok: errors.length === 0,
    tasks: list.length,
    thin: thin,
    thinLimit: thinLimit,
    tracks: byTrack,
    variants: list.filter(function (task) { return task.variants && Object.keys(task.variants).length; }).length,
    withSample: list.filter(function (task) { return task.sample; }).length,
    withVerify: list.filter(function (task) { return task.verify; }).length,
    verifyByTrack: structure.byTrack,
    errors: errors,
    warnings: warns,
    platformGaps: gaps,
    // 外部包里没挂知识点的题：不判错（字典只覆盖内置题库），但要说清楚有几道
    externalOrphans: externalOrphans,
    findings: findings
  };
}
