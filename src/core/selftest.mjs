// 平台自检：把"题库里写死的 BSD / GNU 差异"拿到当前主机上实测一遍。
// 这是唯一一处不经过只读白名单的执行 —— 因为探针是源码里的常量，不接受任何外部输入，
// 只用于回答"这台机器真的是我以为的那种工具链吗"。任何用户输入仍然只能走 exec.mjs 的白名单。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// 每个探针：script 在临时目录里执行（自己创建 fixture 文件），exit 0 记为 ok。
// expect 是该平台上"应该出现的结果"，与题库里的判定规则一一对应。
// 每个平台的探针用哪套 shell 执行：POSIX 用 sh -c，Windows 原生用 cmd /c。
// Windows 上的探针断言的是"这些 POSIX 工具不存在"，因为原生 Windows 本来就没有 sed/stat/grep；
// 想在 Windows 上练题请用 WSL2，那边跑的是 linux 这一套。
export const PLATFORM_SHELL = {
  darwin: ['sh', '-c'],
  linux: ['sh', '-c'],
  win32: ['cmd', '/c']
};

export const PROBES = {
  win32: {
    name: 'Windows / 原生工具链（建议改用 WSL2）',
    probes: [
      { id: 'where-sed', desc: 'where sed', script: 'where sed', expect: 'fail', why: '原生 Windows 没有 sed，题库里的 sed 题要在 WSL2 或 Git Bash 里练' },
      { id: 'where-stat', desc: 'where stat', script: 'where stat', expect: 'fail', why: '原生 Windows 没有 stat' },
      { id: 'where-systemctl', desc: 'where systemctl', script: 'where systemctl', expect: 'fail', why: 'Windows 没有 systemd，服务管理是另一套（services.msc / sc）' },
      { id: 'where-wsl', desc: 'where wsl', script: 'where wsl', expect: 'ok', why: 'Windows 10/11 自带 wsl.exe，用它进 Linux 环境' },
      { id: 'node-version', desc: 'node -v', script: 'node -v', expect: 'ok', why: '工具本身要求 Node >= 18' },
      { id: 'ver', desc: 'ver 查看系统版本', script: 'ver', expect: 'ok', why: '确认这是原生 Windows 而不是 MSYS/Git Bash 环境' }
    ]
  },
  darwin: {
    name: 'macOS / BSD 工具链',
    probes: [
      { id: 'sed-plain', desc: "sed -i 不带备份后缀", script: "printf hello > f; sed -i 's/h/H/' f", expect: 'fail', why: 'BSD sed 的 -i 必须带后缀，否则报 invalid command code' },
      { id: 'sed-empty-suffix', desc: "sed -i '' 空后缀", script: "printf hello > f; sed -i '' 's/h/H/' f", expect: 'ok', why: 'macOS 上原地替换必须写成 sed -i u0027u0027' },
      { id: 'stat-gnu', desc: "stat -c 取大小", script: "printf hello > f; stat -c '%s' f", expect: 'fail', why: 'BSD stat 没有 -c，报 illegal option -- c' },
      { id: 'stat-bsd', desc: "stat -f %z 取大小", script: "printf hello > f; stat -f '%z' f", expect: 'ok', why: 'macOS 用 stat -f 加 %z' },
      { id: 'grep-pcre', desc: 'grep -P PCRE', script: "printf hello > f; grep -P 'h.l' f", expect: 'fail', why: 'BSD grep 不支持 -P，报 invalid option -- P' },
      { id: 'grep-ere', desc: 'grep -E 扩展正则', script: "printf hello > f; grep -E 'h.l' f", expect: 'ok', why: 'macOS 上要用 -E 代替 -P' },
      { id: 'date-gnu', desc: "date -d 相对日期", script: "date -d '+1 day' '+%Y-%m-%d'", expect: 'fail', why: 'BSD date 没有 -d，报 illegal option -- d' },
      { id: 'date-bsd', desc: 'date -v 相对日期', script: "date -v+1d '+%Y-%m-%d'", expect: 'ok', why: 'macOS 用 -v+1d' },
      { id: 'ss', desc: 'ss 查看监听端口', script: 'ss -ltn', expect: 'fail', why: 'macOS 没有 ss，端口排查要用 lsof -nP -iTCP -sTCP:LISTEN' },
      { id: 'find-printf', desc: "find -printf 打印文件大小", script: "printf hi > f; find . -printf '%s\\n'", expect: 'fail', why: 'BSD find 没有 -printf（unknown primary），列大小要配合 stat -f %z' },
      { id: 'du-max-depth', desc: 'du --max-depth 限制深度', script: 'du --max-depth=1 .', expect: 'fail', why: 'BSD du 不认 --max-depth，深度限制要写 -d 1' },
      { id: 'uname', desc: 'uname -s 平台标识', script: 'uname -s', expect: 'ok', why: 'macOS 输出 Darwin' }
    ]
  },
  linux: {
    name: 'Linux / GNU 工具链',
    probes: [
      { id: 'sed-plain', desc: 'sed -i 不带后缀', script: "printf hello > f; sed -i 's/h/H/' f", expect: 'ok', why: 'GNU sed 的 -i 不接后缀' },
      { id: 'sed-empty-suffix', desc: "sed -i '' 空后缀", script: "printf hello > f; sed -i '' 's/h/H/' f", expect: 'fail', why: "GNU sed 把 '' 当成文件名" },
      { id: 'stat-gnu', desc: "stat -c 取大小", script: "printf hello > f; stat -c '%s' f", expect: 'ok', why: 'GNU stat 用 -c 加 %s' },
      { id: 'stat-bsd', desc: "stat -f %z 取大小", script: "printf hello > f; stat -f '%z' f", expect: 'fail', why: 'GNU stat 的 -f 是文件系统信息' },
      { id: 'grep-pcre', desc: 'grep -P PCRE', script: "printf hello > f; grep -P 'h.l' f", expect: 'ok', why: 'GNU grep 支持 -P' },
      { id: 'date-gnu', desc: "date -d 相对日期", script: "date -d '+1 day' '+%Y-%m-%d'", expect: 'ok', why: 'GNU date 用 -d 做偏移' },
      { id: 'date-bsd', desc: 'date -v 相对日期', script: "date -v+1d '+%Y-%m-%d'", expect: 'fail', why: 'GNU date 没有 -v' },
      { id: 'find-printf', desc: "find -printf 打印文件大小", script: "printf hi > f; find . -printf '%s\\n'", expect: 'ok', why: 'GNU find 支持 -printf，能直接打印 %s' },
      { id: 'du-max-depth', desc: 'du --max-depth 限制深度', script: 'du --max-depth=1 .', expect: 'ok', why: 'GNU du 支持 --max-depth' },
      { id: 'uname', desc: 'uname -s 平台标识', script: 'uname -s', expect: 'ok', why: 'Linux 输出 Linux' }
    ]
  }
};

// WSL2 检测：/proc/version 里带 Microsoft/WSL 就说明是在 WSL 里跑。
// 传入 procVersion 可注入内容，便于测试；不传则读真实文件。
export function detectWsl(options) {
  const opts = options || {};
  let content = opts.procVersion;
  if (content === undefined) {
    content = '';
    if (process.platform === 'linux' && existsSync('/proc/version')) {
      try {
        content = readFileSync('/proc/version', 'utf8');
      } catch (err) {
        content = '';
      }
    }
  }
  return /microsoft|wsl/i.test(String(content));
}

export function listProbes(platform) {
  const set = PROBES[platform];
  if (!set) return [];
  return set.probes.map(function (probe) {
    return { id: probe.id, desc: probe.desc, expect: probe.expect, why: probe.why };
  });
}

function marker(platform, probe) {
  return '@@' + platform + '.' + probe.id;
}

// 本地执行：每条探针单独起一个 shell，工作目录是临时目录。
export function runLocal(platform, options) {
  const set = PROBES[platform];
  if (!set) return { ok: false, reason: '未知平台 ' + platform + '，可选：' + Object.keys(PROBES).join(' / ') };
  const opts = options || {};
  if (!opts.run) {
    return { ok: false, ran: false, dryRun: true, platform: platform, profile: set.name, probes: listProbes(platform), reason: '默认不执行；加 --run 才会真的在这台机器上跑探针' };
  }
  const cwd = opts.cwd || process.cwd();
  const shell = PLATFORM_SHELL[platform] || PLATFORM_SHELL.linux;
  const results = set.probes.map(function (probe) {
    const proc = spawnSync(shell[0], shell.slice(1).concat([probe.script]), { cwd: cwd, encoding: 'utf8', timeout: opts.timeout || 10000 });
    const actual = proc.status === 0 ? 'ok' : 'fail';
    return {
      id: probe.id,
      desc: probe.desc,
      expect: probe.expect,
      actual: actual,
      ok: actual === probe.expect,
      why: probe.why,
      output: ((proc.stdout || '') + (proc.stderr || '')).trim().slice(0, 200)
    };
  });
  return summarize(platform, set.name, 'local', results);
}

// 容器执行：把一个平台的探针合成一段脚本，一次 docker run 跑完。
// 这样做的目的是在没有 Linux 主机时也能拿到真实 GNU 工具链的证据。
export function buildContainerScript(platform) {
  const set = PROBES[platform];
  if (!set) return '';
  const lines = ['cd /tmp || exit 1'];
  set.probes.forEach(function (probe) {
    lines.push('( ' + probe.script + ' ) >/dev/null 2>&1');
    lines.push('echo "' + marker(platform, probe) + ':$?"');
  });
  return lines.join('\n');
}

export function parseContainerOutput(platform, output) {
  const set = PROBES[platform];
  const map = new Map();
  String(output || '').split('\n').forEach(function (line) {
    const trimmed = line.trim();
    set.probes.forEach(function (probe) {
      const prefix = marker(platform, probe) + ':';
      if (trimmed.indexOf(prefix) === 0) map.set(probe.id, Number(trimmed.slice(prefix.length)));
    });
  });
  return set.probes.map(function (probe) {
    const code = map.has(probe.id) ? map.get(probe.id) : null;
    const actual = code === null ? 'missing' : (code === 0 ? 'ok' : 'fail');
    return {
      id: probe.id,
      desc: probe.desc,
      expect: probe.expect,
      actual: actual,
      ok: actual === probe.expect,
      why: probe.why
    };
  });
}

export function runInContainer(platform, options) {
  const set = PROBES[platform];
  if (!set) return { ok: false, reason: '未知平台 ' + platform };
  const opts = options || {};
  // 与容器后端同一处配置：Docker Hub 被墙时用一个镜像源配到底
  const image = opts.image || process.env.DSH_LEARN_DOCKER_IMAGE || 'alpine:3.20';
  if (!opts.run) {
    return { ok: false, ran: false, dryRun: true, platform: platform, profile: set.name, probes: listProbes(platform), reason: '默认不执行；加 --run 才会真的起容器' };
  }
  const info = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: opts.timeout || 5000, killSignal: 'SIGKILL' });
  if (info.status !== 0) {
    return { ok: false, ran: false, unavailable: true, platform: platform, reason: 'Docker 守护进程不可用，无法在容器里做平台自检' };
  }
  const args = ['run', '--rm', '--network', 'none', image, 'sh', '-lc', buildContainerScript(platform)];
  const proc = spawnSync('docker', args, { encoding: 'utf8', timeout: opts.timeout || 120000, killSignal: 'SIGKILL' });
  const output = ((proc.stdout || '') + (proc.stderr || ''));
  if (proc.status !== 0 && output.indexOf(marker(platform, set.probes[0])) === -1) {
    return { ok: false, ran: false, unavailable: true, platform: platform, image: image, reason: '容器未能启动（镜像不存在或无法拉取）：' + output.trim().split('\n').slice(-1)[0] };
  }
  return summarize(platform, set.name, 'docker', parseContainerOutput(platform, output), image);
}

function summarize(platform, profile, runner, results, image) {
  const failed = results.filter(function (row) { return !row.ok; });
  return {
    ok: failed.length === 0,
    ran: true,
    platform: platform,
    profile: profile,
    runner: runner,
    image: image,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    probes: results,
    reason: failed.length
      ? failed.length + ' 条探针与题库假设不符：' + failed.map(function (row) { return row.id; }).join('、')
      : '全部探针与题库里的平台假设一致'
  };
}

export function runSelftest(options) {
  const opts = options || {};
  const platform = opts.platform;
  if (opts.runner === 'docker') return runInContainer(platform, opts);
  return runLocal(platform, opts);
}
