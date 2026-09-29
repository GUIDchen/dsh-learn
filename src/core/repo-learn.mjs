// 解析一个代码仓库（本地目录或 git 链接）能练什么：
//   1. 有界扫描文件树，识别"技术信号"（Dockerfile / compose / k8s / CI / Makefile / go.mod / Cargo.toml / requirements.txt …）
//   2. 把文件清单 + 清单文件内容 + README 拼成一段"仓库画像文本"，交给知识点字典匹配（与 JD 分析同一套字典）
//   3. 把 README / Makefile / 脚本里的命令喂给 buildDraftPack，产出可复核的草案包
// 刻意有界：文件数与单文件读取都有上限，避免在一个几个 G 的仓库上把内存打满。
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeText } from './knowledge.mjs';
import { buildDraftPack } from './site-learn.mjs';

const SKIP_DIRS = ['.git', 'node_modules', 'target', 'dist', 'build', 'vendor', '__pycache__', '.venv', 'venv',
  '.idea', '.vscode', 'coverage', '.next', '.cache', 'Pods', 'DerivedData'];

// 信号表：命中就把"这个仓库涉及什么"说出来。每条带上可读的说明，方便复核时判断要不要为它出题。
const SIGNALS = [
  { id: 'dockerfile', track: 'docker', match: /^dockerfile|\.dockerfile$|dockerfile\.[a-z]+$/i, note: '镜像构建' },
  { id: 'compose', track: 'docker', match: /^docker-compose.*\.ya?ml$|^compose\.ya?ml$/, note: 'Compose 编排' },
  { id: 'k8s', track: 'k8s', match: /\.(ya?ml)$/, peek: /(kind:\s*(Deployment|StatefulSet|DaemonSet|Job|CronJob|Ingress|Service|ConfigMap|Secret|PersistentVolumeClaim))/ , note: 'Kubernetes 清单' },
  { id: 'ci', track: 'ops', match: /^\.github\/workflows\/.*\.ya?ml$|^\.gitlab-ci\.yml$|^Jenkinsfile$|^\.circleci\/config\.yml$/, note: 'CI/CD 流水线' },
  { id: 'make', track: 'shell', match: /^makefile$|\.mk$/i, note: 'Makefile 构建入口' },
  { id: 'shell', track: 'shell', match: /\.sh$/i, note: 'Shell 脚本' },
  { id: 'go', track: 'go', match: /^go\.(mod|sum)$|\.go$/i, note: 'Go 工程' },
  { id: 'rust', track: 'rust', match: /^cargo\.(toml|lock)$|\.rs$/i, note: 'Rust 工程' },
  { id: 'python', track: 'python', match: /^requirements.*\.txt$|^pyproject\.toml$|^Pipfile$|\.py$/i, note: 'Python 工程' },
  { id: 'node', track: 'lang', match: /^package\.json$|^pnpm-lock\.yaml$|^yarn\.lock$/, note: 'Node 工程' },
  { id: 'terraform', track: 'ops', match: /\.tf$|\.tfvars$/, note: 'Terraform 基础设施' },
  { id: 'ansible', track: 'ops', match: /^playbook.*\.ya?ml$|^roles\//, note: 'Ansible 剧本' },
  { id: 'systemd', track: 'service', match: /\.service$|\.timer$/, note: 'systemd 单元' },
  { id: 'database', track: 'database', match: /\.sql$|^redis\.conf$|^my\.cnf$/i, note: '数据库脚本与配置' },
  { id: 'c', track: 'c', match: /\.(c|h)$/, note: 'C 源码' },
  { id: 'cpp', track: 'cpp', match: /\.(cc|cpp|hpp|cxx)$/, note: 'C++ 源码' },
  { id: 'embedded', track: 'embedded', match: /\.(hex|bin|elf|map)$|^platformio\.ini$|^kconfig$|^openocd.*\.cfg$/i, note: '嵌入式产物与配置' },
  { id: 'ml', track: 'dl', match: /\.(pt|onnx|pth|yaml)$/, peek: /(epochs:|learning_rate:|model:|datasets:)/, note: '训练配置' }
];

// 采集命令的候选文件：README/Makefile/脚本，都是"人写的命令"最可能出现的地方
const COMMAND_FILES = [/^readme(\.md|\.rst|\.txt)?$/i, /^makefile$/i, /\.sh$/i, /^\.github\/workflows\/.*\.ya?ml$/, /^docs\/.*\.md$/i];

// ---------------- 仓库地址的归一化与克隆策略（纯函数，便于直接测） ----------------

// 认得出"这是远程仓库"：带协议、ssh 写法、或 GitHub 常见的 owner/repo 简写。
export function normalizeRepoInput(target) {
  const raw = String(target || '').trim();
  if (!raw) return { kind: 'empty', url: '', label: '' };
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(raw)) {
    const url = raw.replace(/\/+$/, '');
    return { kind: 'remote', url: url, label: repoLabelFromUrl(url) };
  }
  // owner/repo 简写：只有一段斜杠、不是路径（不指向本机已存在的目录）
  if (/^[\w.-]+\/[\w.-]+$/.test(raw) && !existsSync(raw)) {
    return { kind: 'remote', url: 'https://github.com/' + raw, label: repoLabelFromUrl(raw) };
  }
  return { kind: 'local', url: '', label: raw.split('/').filter(Boolean).pop() || 'repo' };
}

function repoLabelFromUrl(url) {
  const cleaned = String(url).replace(/[?#].*$/, '').replace(/\/$/, '').replace(/\.git$/, '');
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return (parts[parts.length - 1] || 'repo').replace(/[^\w.-]/g, '') || 'repo';
}

// 克隆失败时的备选镜像：国内网络直连 github.com 经常握手就断，镜像能救回来。
// DSH_LEARN_GIT_MIRROR 设置后只用它（自带前缀风格：https://host/ + owner/repo）。
// 本机 git 的 url.<base>.insteadOf 改写：很多人配了 GitHub 加速镜像。
// 不改写也能跑，但"直连失败"的信息里会写着镜像域名，看不出是谁干的——所以读出来标清楚。
export function parseGitRewrites(text) {
  return String(text || '').split('\n').map(function (line) { return line.trim(); }).filter(Boolean).map(function (line) {
    const m = line.match(/^url\.(.*)\.insteadof\s+(\S+)$/i);
    return m ? { base: m[1], prefix: m[2] } : null;
  }).filter(Boolean);
}

export function applyGitRewrites(url, rewrites) {
  for (const rule of (rewrites || [])) {
    if (url.indexOf(rule.prefix) === 0) return rule.base.replace(/\/+$/, '') + '/' + url.slice(rule.prefix.length);
  }
  return url;
}

export function cloneCandidates(url, env, rewrites) {
  const e = env || {};
  const host = function (u) { return String(u).replace(/^https?:\/\//, '').split('/')[0]; };
  const seen = new Set();
  const push = function (list, candidateUrl, via) {
    const effective = applyGitRewrites(candidateUrl, rewrites);
    if (seen.has(effective)) return;
    seen.add(effective);
    list.push({ url: candidateUrl, effective: effective, via: via });
  };
  const custom = String(e.DSH_LEARN_GIT_MIRROR || '').trim().replace(/\/+$/, '');
  if (custom) {
    const list = [];
    push(list, custom + '/' + shortRepoPath(url), 'mirror:' + custom);
    return list;
  }
  const list = [];
  const directVia = applyGitRewrites(url, rewrites) === url ? 'direct' : ('direct→本机 git 改写→' + host(applyGitRewrites(url, rewrites)));
  push(list, url, directVia);
  if (/^https?:\/\/github\.com\//i.test(url)) {
    const path = shortRepoPath(url);
    ['https://ghfast.top', 'https://gh-proxy.com', 'https://ghproxy.net'].forEach(function (mirror) {
      push(list, mirror + '/' + path, 'mirror:' + mirror);
    });
  }
  return list;
}

function shortRepoPath(url) {
  return String(url).replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/^git@github\.com:/i, '').replace(/\.git$/, '');
}

// 已经拉过的同一仓库就直接复用：网络不通时还能继续解析上次的结果，也免得每次重拉。
export function findExistingClone(baseDir, label, readdir) {
  const list = typeof readdir === 'function' ? readdir : readdirSync;
  if (!existsSync(baseDir)) return '';
  try {
    const dirs = list(baseDir).filter(function (name) { return name.indexOf(label + '-') === 0; });
    if (!dirs.length) return '';
    dirs.sort();
    const last = dirs[dirs.length - 1];
    return existsSync(join(baseDir, last)) ? join(baseDir, last) : '';
  } catch (err) {
    return '';
  }
}

// 把"要解析哪个目录"这件事收成一份实现：CLI 与网页版共用，
// 这样简写、镜像链、复用上次克隆、本机 git 改写诊断在两边不会走两个样。
// runClone 可注入（测试里不联网也能覆盖每条分支）：返回 { status, stderr, error }，与 spawnSync 同形。
export function resolveRepoDir(input, options) {
  const opts = options || {};
  const runClone = opts.runClone || function (args) {
    return spawnSync('git', args, { encoding: 'utf8', timeout: opts.timeoutMs || 120000 });
  };
  const note = opts.note || function () { };
  const rewrites = opts.rewrites || [];
  const timeoutMs = opts.timeoutMs || 120000;
  const branch = opts.branch || '';
  const refresh = Boolean(opts.refresh);
  const removeDir = opts.removeDir || function (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch (err) { /* 清不掉不影响主流程 */ } };

  if (input.kind === 'local') {
    if (!existsSync(opts.localTarget || input.label)) return { ok: false, code: 3, kind: 'local', error: '目录不存在：' + (opts.localTarget || input.label) };
    return { ok: true, dir: opts.localTarget || input.label, via: 'local', cloned: false };
  }

  const baseDir = opts.baseDir;
  mkdirSync(baseDir, { recursive: true });
  const cached = findExistingClone(baseDir, input.label);
  if (cached && !refresh && !branch) {
    note('reuse', '复用上次的克隆：' + cached + (opts.reuseHint ? '（想重新拉一次就加 --refresh）' : ''));
    return { ok: true, dir: cached, via: 'reuse', cloned: false };
  }

  const candidates = cloneCandidates(input.url, opts.env || {}, rewrites);
  if (rewrites.length && candidates[0].via !== 'direct') {
    note('rewrite', '本机 git 配置把 ' + input.url + ' 改写成了 ' + candidates[0].effective
      + '（url.<镜像>.insteadOf），所以这一趟走的不是直连。');
  }
  const stamp = String(Date.now()).slice(-6);
  const failure = [];
  for (const candidate of candidates) {
    note('try', '尝试 ' + candidate.via + '：' + candidate.effective);
    const dir = join(baseDir, input.label + '-' + stamp);
    const args = ['clone', '--depth', '1'].concat(branch ? ['--branch', branch] : []).concat([candidate.url, dir]);
    const clone = runClone(args, { timeoutMs: timeoutMs });
    if (clone.status === 0) {
      note('done', candidate.via, dir);
      return { ok: true, dir: dir, via: candidate.via, cloned: true };
    }
    const detail = String(clone.stderr || clone.error || '').split('\n').filter(function (line) {
      return line.trim() && line.indexOf('Cloning into') === -1;
    }).slice(0, 2).join(' / ');
    removeDir(dir);
    failure.push({
      via: candidate.via,
      effective: candidate.effective,
      reason: clone.error && String(clone.error.code) === 'ETIMEDOUT' ? '超过 ' + Math.round(timeoutMs / 1000) + ' 秒没完成' : (detail || 'git 没给出原因')
    });
  }
  return { ok: false, code: 3, kind: 'remote', url: input.url, failure: failure, candidates: candidates };
}

export function scanRepo(dir, options) {
  const opts = options || {};
  const maxFiles = opts.maxFiles || 4000;
  const maxDepth = opts.maxDepth || 6;
  const files = [];
  const signals = new Map();
  let truncated = false;

  function walk(current, depth, prefix) {
    if (truncated || depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch (err) { return; }
    entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
    entries.forEach(function (entry) {
      if (truncated) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.indexOf(entry.name) > -1) return;
        walk(join(current, entry.name), depth + 1, prefix + entry.name + '/');
        return;
      }
      if (!entry.isFile()) return;
      if (files.length >= maxFiles) { truncated = true; return; }
      const rel = prefix + entry.name;
      let size = 0;
      try { size = statSync(join(current, entry.name)).size; } catch (err) { return; }
      files.push({ path: rel, size: size });
      SIGNALS.forEach(function (signal) {
        if (!signal.match.test(rel)) return;
        if (signal.peek && size < 200000) {
          let body = '';
          try { body = readFileSync(join(current, entry.name), 'utf8'); } catch (err) { return; }
          if (!signal.peek.test(body)) return;
        }
        const row = signals.get(signal.id) || { id: signal.id, track: signal.track, note: signal.note, files: [] };
        if (row.files.length < 6) row.files.push(rel);
        signals.set(signal.id, row);
      });
    });
  }

  if (!existsSync(dir)) return null;
  walk(dir, 0, '');
  return { dir: dir, files: files, signals: Array.from(signals.values()), truncated: truncated };
}

export function repoDigest(dir, scan, options) {
  const opts = options || {};
  const manifestLimits = { maxPerFile: 4000, maxTotal: 40000 };
  const wanted = [/^readme\.md$/i, /^go\.mod$/i, /^cargo\.toml$/i, /^package\.json$/i, /^requirements.*\.txt$/i,
    /^dockerfile$/i, /^docker-compose\.ya?ml$/i, /^compose\.ya?ml$/i, /^makefile$/i];
  const parts = [];
  // 文件清单默认进摘要（notes 里要展示"扫了哪些文件"），但**知识点匹配时不要它**：
  // 实测（gin/ripgrep）compare.go、benchmark_test.go 这类**文件名**会把知识点指到图像处理、Go 基准上，
  // 而路径带来的真正信号（Dockerfile / go.mod / Cargo.toml）由 scanRepo 单独识别，不靠这里。
  if (opts.includeFileList !== false) {
    parts.push('仓库文件：' + scan.files.map(function (f) { return f.path; }).join(' '));
  }
  parts.push('识别到的技术信号：' + scan.signals.map(function (s) { return s.id + '（' + s.note + '）'; }).join('、'));
  let total = 0;
  scan.files.forEach(function (file) {
    if (total >= manifestLimits.maxTotal) return;
    if (!wanted.some(function (re) { return re.test(file.path); })) return;
    let body = '';
    try { body = readFileSync(join(dir, file.path), 'utf8').slice(0, manifestLimits.maxPerFile); } catch (err) { return; }
    total += body.length;
    parts.push('## ' + file.path + '\n' + body);
  });
  return parts.join('\n');
}

export function repoCommandText(dir, scan, options) {
  const opts = options || {};
  const maxBytes = opts.maxBytes || 60000;
  let total = 0;
  const chunks = [];
  scan.files.forEach(function (file) {
    if (total >= maxBytes) return;
    if (!COMMAND_FILES.some(function (re) { return re.test(file.path); })) return;
    if (file.size > 200000) return;
    let body = '';
    try { body = readFileSync(join(dir, file.path), 'utf8'); } catch (err) { return; }
    total += body.length;
    chunks.push(body);
  });
  return chunks.join('\n');
}

// 主入口：仓库 → { scan, knowledge, draft }
export function analyzeRepo(dir, options) {
  const opts = options || {};
  const scan = scanRepo(dir, opts);
  if (!scan) return null;
  // 知识点只看正文（README/manifest/工作流）与命令文本，不看文件名清单（见 repoDigest 里的说明）
  const digest = repoDigest(dir, scan, Object.assign({}, opts, { includeFileList: false }));
  const knowledge = analyzeText(digest, { limit: opts.limit || 20 });
  const repoName = opts.source || dir.split('/').pop();
  const draft = buildDraftPack(repoCommandText(dir, scan, opts), {
    source: repoName,
    limit: opts.limit || 20,
    // 包名要能一眼看出是仓库草案（网站草案是 site- 前缀）
    packId: opts.packId || ('repo-' + String(repoName).replace(/.git$/, '').split('/').pop().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 24))
  });
  return { scan: scan, knowledge: knowledge, draft: draft };
}
