// 平台档案：把"系统差异"集中成数据，而不是散落在评测逻辑里。
// 新增系统（如 win32、容器内 Linux）只需加一个 profile。

export const PROFILES = {
  darwin: {
    id: 'darwin',
    name: 'macOS',
    shell: 'zsh（/bin/zsh）',
    tools: 'BSD 工具链',
    dockerRuntime: 'Docker Desktop / OrbStack（容器实际跑在 Linux 虚拟机里）',
    daemonHint: '启动 Docker Desktop 或 OrbStack；再用 docker context ls 确认当前上下文是否指向已运行的运行时',
    notes: [
      'BSD 工具链：sed -i 需要空后缀，date 用 -v 偏移且不支持 date -d',
      'Apple Silicon 默认拉取 arm64 镜像，个别镜像需要 --platform linux/amd64',
      'docker CLI 与守护进程分离：CLI 在 mac，容器在内核不同的虚拟机里'
    ]
  },
  linux: {
    id: 'linux',
    name: 'Linux',
    shell: 'bash',
    tools: 'GNU 工具链',
    dockerRuntime: '原生 dockerd（由 systemd 托管）',
    daemonHint: 'sudo systemctl start docker；用 sudo systemctl status docker 看状态',
    notes: [
      'GNU 工具链：sed -i 不接后缀，date -d 支持自然语言偏移',
      '守护进程由 systemd 管理，日志用 journalctl -u docker 查看',
      '在 WSL2 里运行时同样是 GNU 工具链，命令行为与原生 Linux 一致；跨 /mnt/c 操作时注意文件权限与换行符'
    ]
  },
  win32: {
    id: 'win32',
    name: 'Windows',
    shell: 'PowerShell / Git Bash',
    tools: '无 sed 原生支持',
    dockerRuntime: 'Docker Desktop（WSL2 后端）',
    daemonHint: '启动 Docker Desktop，确认 WSL2 后端已就绪',
    notes: [
      '建议在 WSL2 里运行本工具，命令体验与 Linux 完全一致',
      'PowerShell 里的引号规则与 POSIX shell 不同，评测正则按 POSIX 写法给出参考答案'
    ]
  }
};

const GENERIC = {
  id: 'generic',
  name: '通用',
  shell: 'unknown',
  tools: 'unknown',
  dockerRuntime: 'unknown',
  daemonHint: '先确认平台与 docker context，再执行验证',
  notes: ['未识别平台：只做通用规则评测，平台变体题无法给出准确参考']
};

export function detectPlatform(input) {
  const id = input || (typeof process !== 'undefined' && process.platform) || 'generic';
  return PROFILES[id] ? id : 'generic';
}

export function getProfile(id) {
  return PROFILES[id] || GENERIC;
}

export function listPlatforms() {
  return Object.keys(PROFILES).map(function (key) {
    return { id: PROFILES[key].id, name: PROFILES[key].name };
  });
}
