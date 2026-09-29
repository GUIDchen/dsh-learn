// 验证与诊断命令：verify / runners / probe / selftest。
import { resolveTask } from '../../core/judge.mjs';
import { runReadonlyCommand, auditWhitelist } from '../../core/exec.mjs';
import { TASKS, BUILTIN_PACK_IDS } from '../../core/tasks.mjs';
import { verifyWith, listRunners, RUNNER_NAMES } from '../../core/runners.mjs';
import { runSelftest, PROBES, detectWsl } from '../../core/selftest.mjs';
import { auditCatalog } from '../../core/catalog-audit.mjs';
import { POINTS } from '../../core/knowledge.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

export async function verify(ctx) {
  const { args, platform, asJson, out, requireTask } = ctx;
  const task = resolveTask(requireTask(args._[1]), platform);
  const result = await verifyWith(task, {
    run: Boolean(args.run),
    runner: typeof args.runner === 'string' ? args.runner : 'local',
    endpoint: typeof args.endpoint === 'string' ? args.endpoint : undefined,
    token: typeof args.token === 'string' ? args.token : undefined,
    image: typeof args.image === 'string' ? args.image : undefined
  });
  if (asJson) {
    out(result);
  } else {
    console.log('执行后端：' + (result.runner || 'local') + (result.endpoint ? '（' + result.endpoint + '）' : '') + (result.image ? '（镜像 ' + result.image + '）' : ''));
    console.log('验证命令：' + (result.cmd || '-'));
    console.log('结果：' + (result.ran ? (result.ok ? '通过' : '未通过') : '未执行'));
    console.log('说明：' + result.reason);
    if (result.output) console.log('输出：\n' + result.output);
  }
}

export async function runners(ctx) {
  const { args, asJson, out } = ctx;
  const rows = listRunners({
    endpoint: typeof args.endpoint === 'string' ? args.endpoint : undefined,
    timeout: 5000
  });
  if (asJson) {
    out(rows);
  } else {
    console.log('可选执行后端：' + RUNNER_NAMES.join(' / '));
    rows.forEach(function (row) {
      console.log('- ' + row.name + '：' + (row.available.ok ? '可用' : '不可用') + '　' + row.description);
      console.log('    ' + row.available.reason);
    });
  }
}

export async function probe(ctx) {
  const { args, platform, profile, asJson, out } = ctx;
  const probes = [];
  async function run(cmd, label) {
    const r = await runReadonlyCommand(cmd, { run: Boolean(args.run) });
    probes.push(Object.assign({ label: label }, r));
  }
  await run('uname -s', '系统类型');
  if (platform === 'darwin') await run('sw_vers -productVersion', 'macOS 版本');
  await run('docker version', 'Docker 客户端/服务端版本');
  await run('docker context ls', 'Docker 上下文');
  const dockerProbe = probes.filter(function (p) { return p.cmd.indexOf('docker version') === 0; })[0];
  const daemonDown = Boolean(dockerProbe && dockerProbe.ran && !dockerProbe.ok);
  const report = {
    platform: platform,
    platformName: profile.name,
    shell: profile.shell,
    tools: profile.tools,
    dockerRuntime: profile.dockerRuntime,
    daemonDown: daemonDown,
    diagnosis: daemonDown ? ('Docker 守护进程连不上。' + profile.daemonHint) : '未发现守护进程问题（或未执行探测）。',
    probes: probes,
    platformNotes: profile.notes
  };
  if (asJson) {
    out(report);
  } else {
    console.log('平台：' + profile.name + ' / ' + profile.tools + ' / shell ' + profile.shell);
    console.log('Docker 运行时：' + profile.dockerRuntime);
    probes.forEach(function (p) {
      console.log('- ' + p.label + '：' + (p.ran ? (p.ok ? '成功' : '失败') : '未执行') + '  [' + p.cmd + ']');
      if (p.output) console.log('    ' + p.output.split('\n').slice(0, 6).join('\n    '));
    });
    console.log('诊断：' + report.diagnosis);
    profile.notes.forEach(function (n) { console.log('注意：' + n); });
  }
}

// 白名单与题库对账：确认题库声明的验证命令都能跑、没人用的条目被暴露、危险命令仍被拒绝。
export async function security(ctx) {
  const { args, asJson, out } = ctx;
  const sub = args._[1] || 'whitelist';
  if (sub !== 'whitelist') {
    console.error('用法：node src/cli.mjs security whitelist [--json]');
    return 2;
  }
  const audit = auditWhitelist(TASKS);
  if (asJson) {
    out(audit);
  } else {
    console.log('白名单条目：' + audit.entries.length + ' 条，题库声明验证命令：' + audit.declared.length + ' 条');
    const families = new Map();
    audit.entries.forEach(function (entry) {
      if (!families.has(entry.family)) families.set(entry.family, []);
      families.get(entry.family).push(entry);
    });
    families.forEach(function (rows, family) {
      console.log('[' + family + ']');
      rows.forEach(function (entry) {
        console.log('  ' + (entry.usedBy.length ? '✓' : '·') + ' ' + entry.id + '　用在 ' + entry.usedBy.length + ' 个验证项  ' + entry.examples[0]);
      });
    });
    if (audit.unused.length) console.log('未被任何题库使用（考虑删除）：' + audit.unused.join(', '));
    if (audit.tasksWithoutVerify.length) console.log('没有可执行验证项的题（正常）：' + audit.tasksWithoutVerify.length + ' 道');
    audit.blocked.forEach(function (row) { console.log('错误：' + row.taskId + ' 的验证命令不在白名单内：' + row.cmd); });
    audit.leaked.forEach(function (row) { console.log('错误：本该被拒绝的命令现在被放行了：' + row.cmd); });
    console.log(audit.ok ? '对账通过' : '对账失败');
  }
  return audit.ok ? 0 : 1;
}

// 题库质量体检：参考答案必须自查满分、变体要有区分度、验证命令必须在白名单内
export async function audit(ctx) {
  const { asJson, out } = ctx;
  // 只有内置包里的题必须挂知识点：外部包是用户自己的内容，不在随工具发布的字典里
  const builtinTaskIds = TASKS.filter(function (task) { return BUILTIN_PACK_IDS.indexOf(task.packId) > -1; })
    .map(function (task) { return task.id; });
  const report = auditCatalog(TASKS, { points: POINTS, builtin: true, builtinTaskIds: builtinTaskIds });
  if (asJson) {
    out(report);
  } else {
    console.log('题库体检：' + report.tasks + ' 道题　' + Object.keys(report.tracks).length + ' 条轨道　'
      + report.variants + ' 道带平台变体　' + report.withSample + ' 道有参考答案');
    console.log('轨道分布：' + Object.keys(report.tracks).sort().map(function (track) {
      return track + ' ' + report.tracks[track];
    }).join('、'));
    report.errors.forEach(function (item) { console.log('错误 ' + item.taskId + (item.platform ? '@' + item.platform : '') + '：' + item.message); });
    report.warnings.slice(0, 20).forEach(function (item) { console.log('提醒 ' + item.taskId + (item.platform ? '@' + item.platform : '') + '：' + item.message); });
    if (report.warnings.length > 20) console.log('（另有 ' + (report.warnings.length - 20) + ' 条提醒未显示）');
    console.log(report.ok ? '体检通过（' + report.warnings.length + ' 条提醒）' : '体检失败：' + report.errors.length + ' 个错误');
    if (report.platformGaps && report.platformGaps.length) {
      const byPlatform = {};
      report.platformGaps.forEach(function (item) { byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1; });
      console.log('扩充建议（平台缺口 ' + report.platformGaps.length + ' 处：这些题在某些平台没给参考答案）：'
        + Object.keys(byPlatform).map(function (p) { return p + ' ' + byPlatform[p] + ' 处'; }).join('、'));
      console.log('        例：' + report.platformGaps.slice(0, 3).map(function (item) { return item.taskId + '@' + item.platform; }).join('、'));
    }
    if (report.externalOrphans && report.externalOrphans.length) {
      console.log('外部包有 ' + report.externalOrphans.length + ' 道题不在内置知识点字典里（正常：字典只覆盖内置题库；'
        + '外部题不会出现在「岗位/文档分析」的推荐里，但照常可练、可判、可记进度）');
    }
    // 扩充建议：体检"通过"不代表题库均衡，薄轨道单独提示，别和提醒混在一起
    if (report.thin && report.thin.length) {
      console.log('扩充建议（少于 ' + report.thinLimit + ' 题的轨道）：' + report.thin.map(function (row) {
        return row.track + ' ' + row.tasks + ' 题';
      }).join('、'));
    }
  }
  return report.ok ? 0 : 1;
}

export async function selftest(ctx) {
  const { args, platform, asJson, out } = ctx;
  const target = typeof args.platform === 'string' ? args.platform : platform;
  const runnerName = typeof args.runner === 'string' ? args.runner : 'local';
  if (!PROBES[target]) {
    console.error('未知平台 ' + target + '，可选：' + Object.keys(PROBES).join(' / '));
    return 2;
  }
  const workdir = mkdtempSync(tmpdir() + '/dsh-learn-selftest-');
  const result = runSelftest({
    platform: target,
    runner: runnerName,
    image: typeof args.image === 'string' ? args.image : undefined,
    run: Boolean(args.run),
    cwd: workdir
  });
  if (asJson) {
    out(result);
  } else {
    console.log('平台自检：' + (PROBES[target].name) + '　执行方式：' + runnerName + (result.image ? '（镜像 ' + result.image + '）' : ''));
    if (target === 'linux' && detectWsl()) console.log('检测到 WSL2 环境：工具链按 Linux/GNU 判定，命令行为与原生 Linux 一致。');
    if (!result.ran) {
      console.log('未执行：' + result.reason);
      result.probes.forEach(function (probe) {
        console.log('  - ' + probe.id + '　' + probe.desc + '　预期 ' + probe.expect + '　' + probe.why);
      });
    } else {
      result.probes.forEach(function (probe) {
        console.log((probe.ok ? 'PASS  ' : 'FAIL  ') + probe.id + '　' + probe.desc + '　预期 ' + probe.expect + ' 实际 ' + probe.actual);
        if (!probe.ok) console.log('      ' + probe.why);
      });
      console.log('结果：' + result.passed + ' / ' + result.total + '　' + result.reason);
    }
  }
  if (result.ran && !result.ok) return 1;
}
