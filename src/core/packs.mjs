// 题库包加载：内置包 + 外部目录，全部经 schema 校验后才进入内核。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { assertPack, validatePack } from './schema.mjs';
import { isAllowed } from './exec.mjs';
import { checkFilesTrusted, listPackFiles } from './trust.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACK_DIR = resolve(HERE, '../../packs');
export const BUILTIN_PACKS = [
  'linux-core', 'linux-advanced', 'linux-shell', 'system-core',
  'docker-core', 'docker-advanced', 'docker-ops', 'docker-runtime', 'compose-ops',
  'git-core', 'git-rescue', 'shell-basics', 'service-core', 'network-core',
  'k8s-core', 'k8s-ops',
  // 按学习模块划分的工程向题库
  'python-core', 'c-core', 'cpp-core', 'embedded-core',
  'dl-core', 'yolo-core', 'imaging-core', 'netops-core',
  // 岗位里高频出现的基础设施类题库
  'database-core', 'database-advanced', 'database-pg', 'gateway-core', 'ai-infra', 'ai-serving', 'ops-monitor', 'ops-tune', 'cicd-core',
  'security-core', 'perf-core', 'lang-core', 'mlops-core',
  // 补齐知识点缺口：现代 C++ 检查、PyTorch 管道、嵌入式外设、经典图像处理、网络进阶
  'cpp-modern', 'dl-torch', 'embedded-probe', 'imaging-classic', 'netops-extra',
  'python-data', 'k8s-storage',
  // 继续补厚较薄的轨道：服务、网络排障、性能
  'service-advanced', 'network-advanced', 'perf-advanced',
  'c-advanced', 'mlops-advanced', 'security-advanced', 'yolo-advanced',
  // Go / Rust 独立成轨：Go 从 lang-core 里搬出来，Rust 是新增语言轨
  'go-core', 'rust-core',
  // C 二进制与调试：nm / otool / size / readelf / core dump——薄轨道里 c 最薄（11 题），
  // 这些是"没有源码时怎么查"的真问题，且两平台写法不同（otool vs readelf、lldb vs gdb）
  'c-binary',
  // Windows 运维独立成轨：这些题只在 win32 上有参考答案（platforms 声明），
  // 平台不适用时判定会被拦住（cli 退出码 2 / 接口 400），不会再拿本平台不存在的命令判满分
  'windows-core'
];

function options() {
  return { isAllowedCommand: isAllowed };
}

export function loadPackFile(file) {
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  assertPack(pack, options());
  return pack;
}

export function loadPackDir(dir) {
  const target = dir || PACK_DIR;
  if (!existsSync(target)) return [];
  return readdirSync(target)
    .filter(function (name) { return name.endsWith('.json'); })
    .sort()
    .map(function (name) { return loadPackFile(join(target, name)); });
}

export function loadPacks(names, dir) {
  const list = names || BUILTIN_PACKS;
  const target = dir || PACK_DIR;
  return list.map(function (name) { return loadPackFile(join(target, name + '.json')); });
}

// 合并任务表：后加载的包同 id 覆盖先加载的，方便用外部包覆盖内置题。
export function mergePacks(packs) {
  const index = new Map();
  const tracks = new Set();
  packs.forEach(function (pack) {
    (pack.tasks || []).forEach(function (task) {
      index.set(task.id, Object.assign({ packId: pack.id }, task));
    });
    if (pack.track) tracks.add(pack.track);
  });
  return { tasks: Array.from(index.values()), tracks: Array.from(tracks).sort(), packIds: packs.map(function (p) { return p.id; }) };
}

// 随工具发布的内置包 = BUILTIN_PACKS 名单（顺序固定）；再加上用户题库目录里的本地包：
// 用户把项目的草案包 promote 过来之后，它必须能被所有客户端读到，否则"加入总题库"只写了个没人读的文件。
// 本地包不参与知识点强制要求（审计只对内置包要求"每题都挂知识点"），所以用户包不写知识点也能用。
// 用户题库目录：与随工具发布的 packs/ 分开放。
// 为什么必须分开：packs/ 是"随工具发布的题库"，文档数字、知识点对账、判定强度基线这些护栏
// 都以它为准（实测：用户包混进 packs/ 会让 6 条护栏全红）。用户自己 promote 的包放在
// <home>/packs/ 里，升级工具不会被覆盖，也不会污染那份题库。
export function userPackDir(options) {
  const opts = options || {};
  if (opts.localDir) return opts.localDir;
  const home = opts.home || process.env.DSH_LEARN_HOME || join(homedir(), '.dsh-learn');
  return join(home, 'packs');
}

export function loadLocalPacks(dir) {
  const target = dir;
  if (!target || !existsSync(target)) return [];
  return readdirSync(target)
    .filter(function (name) { return name.endsWith('.json'); })
    .sort()
    .map(function (name) { return loadPackFile(join(target, name)); });
}

export function loadAll(options2) {
  const opts = options2 || {};
  const builtin = loadPacks(BUILTIN_PACKS, opts.dir).concat(loadLocalPacks(opts.localDir || userPackDir(opts)));
  const extra = [];
  if (opts.extraDir) {
    const files = listPackFiles(opts.extraDir);
    const requireTrust = opts.requireTrust !== undefined ? opts.requireTrust : process.env.DSH_LEARN_REQUIRE_TRUST === '1';
    const requireSignature = opts.requireSignature !== undefined ? opts.requireSignature : process.env.DSH_LEARN_REQUIRE_SIGNATURE === '1';
    if (requireTrust) {
      // 门禁：不信任就不加载。默认关闭，用 DSH_LEARN_REQUIRE_TRUST=1 打开。
      const gate = checkFilesTrusted(files, { home: opts.home, requireSignature: requireSignature });
      if (!gate.ok) {
        throw new Error('外部题库未通过信任检查：' + gate.untrusted.map(function (row) {
          return row.file + '（' + row.reason + '）';
        }).join('；'));
      }
    }
    files.forEach(function (file) { extra.push(loadPackFile(file)); });
  }
  return mergePacks(builtin.concat(extra));
}
