// 版本号：语义化版本解析与自增。放成纯函数，release 脚本与测试共用同一份实现。
export function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text || '').trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), raw: match[1] + '.' + match[2] + '.' + match[3] };
}

export function formatVersion(parts) {
  return parts.major + '.' + parts.minor + '.' + parts.patch;
}

// kind: patch | minor | major（minor/major 自增时把低位清零，符合语义化版本的直觉）
export function bumpVersion(current, kind) {
  const parts = parseVersion(current);
  if (!parts) throw new Error('当前版本号不是 x.y.z 形式：' + current);
  const which = kind || 'patch';
  if (which === 'patch') return formatVersion({ major: parts.major, minor: parts.minor, patch: parts.patch + 1 });
  if (which === 'minor') return formatVersion({ major: parts.major, minor: parts.minor + 1, patch: 0 });
  if (which === 'major') return formatVersion({ major: parts.major + 1, minor: 0, patch: 0 });
  throw new Error('不支持的版本自增类型：' + which + '（可选 patch / minor / major）');
}

// 构建号：用版本号加零填充，保证 CFBundleVersion 单调递增
export function buildNumber(version) {
  const parts = parseVersion(version);
  if (!parts) return '1';
  return String(parts.major * 10000 + parts.minor * 100 + parts.patch);
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  return (left.major - right.major) || (left.minor - right.minor) || (left.patch - right.patch);
}
