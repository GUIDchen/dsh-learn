// 执行后端注册表：本机 / 一次性容器 / 远程 agent。
// 三个后端返回同一结构，调用方（CLI、Web、未来的桌面壳）无需关心命令在哪里跑。
import { spawnSync } from 'node:child_process';
import { isAllowed, runReadonlyCommand, assessOutput } from './exec.mjs';

export const RUNNER_NAMES = ['local', 'docker', 'remote'];

function baseResult(name, spec, extra) {
  return Object.assign({
    runner: name,
    cmd: spec.cmd,
    expect: spec.expect,
    ran: false,
    ok: false
  }, extra || {});
}

function matchOutput(spec, output) {
  return new RegExp(spec.expect, 'i').test(output || '');
}

// 直接调 docker CLI，不套 shell 包装。真实踩到过的坑：sh -c 包装在超时时只杀掉 shell，
// 被留下的 docker 子进程继续握着输出管道，spawnSync 于是一辈子不返回（docker info 挂了 15 分钟）。
// 直接 spawn + SIGKILL 才有"超时就是超时"。
function daemonProbe(timeout, exec) {
  const ms = timeout || 5000;
  // exec 可注入：让"守护进程可用"这条分支在没有 Docker 的机器上也能被测到
  const run = exec || function (args, timeoutMs) {
    return spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' });
  };
  const proc = exec ? exec(['info'], ms) : run(['info'], ms);
  const output = ((proc.stdout || '') + (proc.stderr || '')).trim();
  if (proc.status === null && (proc.signal || proc.error)) {
    return { ok: false, ran: true, dryRun: false, cmd: 'docker info', exitCode: null, output: output, reason: 'docker info 在 ' + ms + 'ms 内没有返回（守护进程无响应）' };
  }
  return {
    ok: proc.status === 0,
    ran: true,
    dryRun: false,
    cmd: 'docker info',
    exitCode: proc.status,
    output: output,
    reason: proc.status === 0 ? 'Docker 守护进程可用' : 'Docker 守护进程返回非零退出码'
  };
}

// 守护进程的报错往往夹着一大段客户端信息，只保留最后一行最有信息量的内容。
function shortReason(text, limit) {
  const lines = String(text || '').split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : '';
  const max = limit || 160;
  return last.length > max ? last.slice(0, max) + '...' : last;
}

// 镜像预检：本地没有就先试着拉，拉不动就几秒内给一句人话，而不是让 docker run 卡满超时再抛英文。
// 抽成独立函数是为了能在没有 Docker 守护进程的机器上被测试覆盖（用 options.exec 注入假执行器）。
export function ensureImage(image, options) {
  const opts = options || {};
  const exec = opts.exec || function (args, timeoutMs) {
    return spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' });
  };
  const have = exec(['image', 'inspect', image], 5000);
  if (have.status === 0) return { ok: true, pulled: false, output: '' };
  const pull = exec(['pull', image], opts.pullTimeout || 20000);
  const output = ((pull.stdout || '') + (pull.stderr || '')).trim();
  if (pull.status === 0) return { ok: true, pulled: true, output: output };
  return { ok: false, pulled: false, output: output };
}

// 在一次性容器里跑一条命令并给出判定。和 ensureImage 同样注入 exec，便于在没有守护进程的机器上测到。
export function runInImage(image, cmd, options) {
  const opts = options || {};
  const exec = opts.exec || function (args, timeoutMs) {
    return spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' });
  };
  // ponytail: 用 sh -lc 保留引号（例如 date 的格式串）。命令已通过白名单，不含 ; & | > < $ 与反引号，没有拼接注入面。
  // killSignal 用 SIGKILL：docker CLI 卡在不可中断的等待里时，SIGTERM 会一直等下去。
  const args = ['run', '--rm', '--network', 'none', image, 'sh', '-lc', cmd];
  const proc = exec(args, opts.timeout || 30000);
  const output = ((proc.stdout || '') + (proc.stderr || '')).trim();
  return { exitCode: proc.status, output: output, verdict: assessOutput(proc.status, output, cmd) };
}

export const local = {
  name: 'local',
  description: '在本机执行只读命令（默认后端）',
  available: function () {
    return { ok: true, reason: '本机执行始终可用（仍受只读白名单约束）' };
  },
  execute: async function (spec, options) {
    const opts = options || {};
    const result = await runReadonlyCommand(spec.cmd, { run: opts.run, timeout: opts.timeout });
    if (!result.ran || !spec.expect) {
      return Object.assign({ runner: 'local' }, result);
    }
    // 与容器/远程后端保持同一语义：既看退出码，也看输出是否匹配 expect。
    const matched = matchOutput(spec, result.output);
    return Object.assign({ runner: 'local' }, result, {
      matched: matched,
      ok: result.ok && matched,
      reason: result.ok
        ? (matched ? '本机输出符合预期：' + spec.expect : '本机命令成功但输出未匹配 ' + spec.expect + '，注意平台差异')
        : result.reason
    });
  }
};

export const docker = {
  name: 'docker',
  description: '在一次性容器里执行（docker run --rm --network none），不污染本机',
  available: function (options) {
    const opts = options || {};
    const probe = daemonProbe(opts.timeout, opts.exec);
    return probe.ok
      ? { ok: true, reason: 'Docker 守护进程可用（镜像需已存在或可拉取）' }
      : { ok: false, reason: 'Docker 守护进程不可用：' + (shortReason(probe.output) || probe.reason) };
  },
  execute: async function (spec, options) {
    const opts = options || {};
    // 默认镜像可用环境变量覆盖：Docker Hub 被墙时把镜像源配一次，所有客户端都受益。
    const image = opts.image || process.env.DSH_LEARN_DOCKER_IMAGE || 'alpine:3.20';
    const result = baseResult('docker', spec, { image: image });
    if (!opts.run) {
      return Object.assign(result, { dryRun: true, reason: '默认不执行；开启后才在容器内运行只读命令' });
    }
    if (!isAllowed(spec.cmd)) {
      return Object.assign(result, { reason: '该命令不在只读白名单内，已拒绝执行' });
    }
    const probe = daemonProbe(opts.timeout, opts.exec);
    if (!probe.ok) {
      // 原始报错也带上：用户照着最后一行去搜就知道是守护进程没起还是 socket 不对
      return Object.assign(result, {
        unavailable: true,
        output: String(probe.output || '').slice(0, 2000),
        reason: 'Docker 守护进程不可用，容器后端降级不可用：' + (shortReason(probe.output) || probe.reason)
      });
    }
    const imageCheck = ensureImage(image, opts);
    if (!imageCheck.ok) {
      return Object.assign(result, {
        unavailable: true,
        output: (imageCheck.output || '').slice(0, 2000),
        reason: '镜像 ' + image + ' 不在本地且拉取失败：' + (shortReason(imageCheck.output) || '未知原因')
          + '　（先 docker pull ' + image + '，或用 DSH_LEARN_DOCKER_IMAGE / --image 指定一个本地已有的基础镜像）'
      });
    }
    const proc = runInImage(image, spec.cmd, opts);
    const output = proc.output;
    const matched = matchOutput(spec, output);
    const verdict = proc.verdict;
    return Object.assign(result, {
      ran: true,
      exitCode: proc.status,
      output: output.slice(0, 4000),
      matched: matched,
      ok: verdict.ok && matched,
      advice: verdict.advice,
      reason: matched && verdict.ok
        ? '容器内输出符合预期：' + spec.expect
        : '容器内输出未匹配 ' + spec.expect + '　' + verdict.reason
    });
  }
};

export const remote = {
  name: 'remote',
  description: '调度另一台机器上的 agent（需 endpoint 与 token）',
  available: function (options) {
    const opts = options || {};
    return opts.endpoint
      ? { ok: true, reason: '将调度 ' + opts.endpoint }
      : { ok: false, reason: '未提供 endpoint，例如 --endpoint=http://linux-box:8790' };
  },
  execute: async function (spec, options) {
    const opts = options || {};
    const result = baseResult('remote', spec, { endpoint: opts.endpoint || '' });
    if (!opts.run) {
      return Object.assign(result, { dryRun: true, reason: '默认不执行；开启后才调度远程 agent' });
    }
    if (!isAllowed(spec.cmd)) {
      return Object.assign(result, { reason: '该命令不在只读白名单内，已拒绝执行' });
    }
    if (!opts.endpoint) {
      return Object.assign(result, { reason: '未提供 endpoint，例如 --endpoint=http://linux-box:8790' });
    }
    try {
      const res = await fetch(opts.endpoint.replace(/\/+$/, '') + '/agent/exec', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmd: spec.cmd, run: true, token: opts.token || '' })
      });
      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = {};
      }
      if (!res.ok) {
        return Object.assign(result, { status: res.status, reason: data.reason || data.error || ('agent 返回 ' + res.status) });
      }
      const matched = matchOutput(spec, data.output);
      return Object.assign(result, {
        ran: true,
        ok: Boolean(data.ok) && matched,
        matched: matched,
        exitCode: data.exitCode,
        output: data.output || '',
        status: res.status,
        reason: matched ? '远程输出符合预期：' + spec.expect : '远程输出未匹配 ' + spec.expect
      });
    } catch (err) {
      return Object.assign(result, { reason: '无法连接 agent：' + err.message });
    }
  }
};

export const RUNNERS = { local: local, docker: docker, remote: remote };

export function getRunner(name) {
  return RUNNERS[name] || null;
}

export function listRunners(options) {
  return RUNNER_NAMES.map(function (name) {
    return {
      name: name,
      description: RUNNERS[name].description,
      available: RUNNERS[name].available(options)
    };
  });
}

export async function verifyWith(resolvedTask, options) {
  const opts = options || {};
  const runnerName = opts.runner || 'local';
  const runner = getRunner(runnerName);
  const spec = resolvedTask && resolvedTask.verify;
  if (!spec) {
    return { runner: runnerName, ran: false, ok: false, reason: '该题没有可执行的验证项，按评测分判定即可' };
  }
  if (!runner) {
    return { runner: runnerName, ran: false, ok: false, reason: '未知执行后端 ' + runnerName + '，可选：' + RUNNER_NAMES.join(' / ') };
  }
  return runner.execute(spec, opts);
}
