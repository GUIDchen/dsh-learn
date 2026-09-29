// 存储 schema 版本化：检测旧形状 + 生成迁移后的值（纯函数，好单测）。
//
// 现状（第 209 轮前）：progress.json 是 {version: 1, records}，jobs.json 是**裸数组**，goals.json 没有版本字段。
// 没有版本就没法安全改结构——改完只能靠人记得旧数据长什么样。这里把三份存储的版本与形状显式化：
//   progress v2 / jobs v2（数组 → {version, jobs}）/ goals v1。
// 读侧一律**同时接受新旧形状**（所以不迁移也不会坏），写侧只写新形状。
export const STORAGE_SCHEMA = { progress: 2, jobs: 2, goals: 1 };

function versionOf(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.version === 'number') return raw.version;
  return 0;
}

export function detectStorage(name, raw) {
  const target = STORAGE_SCHEMA[name];
  if (!target) throw new Error('未知存储：' + name);
  if (name === 'progress') {
    const version = versionOf(raw);
    const records = Array.isArray(raw) ? raw.length : ((raw && raw.records) || []).length;
    return { name: name, target: target, version: version, records: records,
      needsMigration: version < target,
      shape: Array.isArray(raw) ? 'array' : (raw && typeof raw === 'object' ? 'object' : 'missing'),
      note: version >= target ? '已是最新' : ('升级到 v' + target + '（补 version / migratedAt，不改记录）') };
  }
  if (name === 'jobs') {
    if (Array.isArray(raw)) {
      return { name: name, target: target, version: 1, jobs: raw.length, needsMigration: true, shape: 'array',
        note: '裸数组：迁移成 { version: ' + target + ', jobs: [...] }（读侧两种都认）' };
    }
    const version = versionOf(raw);
    return { name: name, target: target, version: version, jobs: ((raw && raw.jobs) || []).length, needsMigration: version < target,
      shape: raw && typeof raw === 'object' ? 'object' : 'missing',
      note: version >= target ? '已是最新' : ('升级到 v' + target + '（裸数组 → 带版本的对象）') };
  }
  // goals
  const version = versionOf(raw);
  return { name: name, target: target, version: version, needsMigration: version < target,
    shape: raw && typeof raw === 'object' ? 'object' : 'missing',
    note: version >= target ? '已是最新' : '补 version 字段（不改其它字段）' };
}

export function migrateStorageValue(name, raw, now) {
  const at = now || new Date().toISOString();
  if (name === 'progress') {
    const records = Array.isArray(raw) ? raw : ((raw && raw.records) || []);
    return { version: STORAGE_SCHEMA.progress, migratedAt: at, records: records };
  }
  if (name === 'jobs') {
    const jobs = Array.isArray(raw) ? raw : ((raw && raw.jobs) || []);
    return { version: STORAGE_SCHEMA.jobs, migratedAt: at, jobs: jobs };
  }
  if (name === 'goals') {
    const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return Object.assign({}, base, {
      version: STORAGE_SCHEMA.goals,
      migratedAt: base.migratedAt || at,
      dailyTasks: Math.max(0, Number(base.dailyTasks) || 0),
      dailyMinutes: Math.max(0, Number(base.dailyMinutes) || 0),
      updatedAt: base.updatedAt || null
    });
  }
  throw new Error('未知存储：' + name);
}

// 三份存储的统一报告（CLI / 接口 / 体检共用同一份口径）
export function storageReport(rows) {
  const need = rows.filter(function (row) { return row.exists && row.needsMigration; });
  return {
    ok: need.length === 0,
    rows: rows,
    needsMigration: need.map(function (row) { return row.name + ' v' + row.version + ' → v' + row.target; }),
    summary: rows.map(function (row) { return row.name + ' v' + (row.exists ? row.version : '（无文件）'); }).join(' / '),
    hint: need.length ? '跑 node src/cli.mjs storage migrate（或 doctor --fix）升级；升级前会自动留 .bak 备份' : '存储 schema 都是最新的'
  };
}
