// 题库包与信任相关命令：pack list / validate / keygen / sign / verify / trust / trusted。
import { PACK_IDS, BUILTIN_PACK_DIR, EXTRA_PACK_DIR } from '../../core/tasks.mjs';
import { validatePack } from '../../core/schema.mjs';
import { loadPackDir } from '../../core/packs.mjs';
import { isAllowed } from '../../core/exec.mjs';
import { generateKey, signFile, verifyFile, addTrust, listTrust, keyPath, trustStorePath } from '../../core/trust.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { slug, withinDir } from '../../core/project.mjs';
import { expectedLevel } from '../../core/tasks.mjs';
import { packTemplate, deepValidate, renderPackCheck } from '../../core/packfile.mjs';

export async function pack(ctx) {
  const { args, asJson, out } = ctx;
  const sub = args._[1];

  if (sub === 'new') {
    // 建包脚手架：生成**开箱即通过深度校验**的模板（不替作者编题面）
    const id = args._[2];
    if (typeof id !== 'string') {
      console.error('用法：node src/cli.mjs pack new <id> --name=… --track=… [--title=…] [--sample=…] [--task=…] [--dir=packs] [--force] [--json]');
      return 2;
    }
    let candidate;
    try {
      candidate = packTemplate({
        id: id,
        name: typeof args.name === 'string' ? args.name : '',
        track: typeof args.track === 'string' ? args.track : '',
        title: typeof args.title === 'string' ? args.title : '',
        sample: typeof args.sample === 'string' ? args.sample : '',
        taskId: typeof args.task === 'string' ? args.task : '',
        verifyCmd: typeof args['verify-cmd'] === 'string' ? args['verify-cmd'] : ''
      });
    } catch (err) {
      console.error(err.message);
      return 2;
    }
    const dir = typeof args.dir === 'string' ? args.dir : BUILTIN_PACK_DIR;
    const file = join(dir, id + '.json');
    if (existsSync(file) && !args.force) {
      console.error('已经存在：' + file + '　（要覆盖请加 --force）');
      return 3;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(candidate, null, 2) + String.fromCharCode(10));
    const check = deepValidate(candidate);
    if (asJson) {
      out({ file: file, pack: candidate, check: check });
      return check.ok ? 0 : 1;
    }
    console.log('已生成：' + file);
    console.log(renderPackCheck(check));
    console.log('下一步：补齐 TODO 后跑　node src/cli.mjs pack validate ' + file + ' --deep');
    return check.ok ? 0 : 1;
  }

  if (sub === 'validate') {
    const file = args._[2];
    if (typeof file !== 'string') {
      console.error('用法：node src/cli.mjs pack validate <file.json>');
      return 2;
    }
    let pack;
    try {
      pack = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      console.error('读取或解析失败：' + err.message);
      return 1;
    }
    // --deep：把「难度口径」与「参考答案必须自测满分」也查了（这两条以前只在 CI 审计里）
    const deep = Boolean(args.deep);
    const result = deep ? deepValidate(pack) : validatePack(pack, { isAllowedCommand: isAllowed });
    if (asJson) {
      out(result);
    } else {
      console.log('包：' + result.packId + '　任务数：' + result.taskCount);
      result.errors.forEach(function (msg) { console.log('错误：' + msg); });
      result.warnings.forEach(function (msg) { console.log('警告：' + msg); });
      // 深度校验要明确说清是哪一档，避免作者以为「结构过了就等于能发布」
    const label = deep ? '深度校验' : '校验';
    console.log(result.errors.length ? (label + '失败') : (label + '通过'));
    }
    return result.errors.length ? 1 : 0;
  }

  if (sub === 'promote') {
    // 把草案变成正式题的中间那一步：校验 + 补齐难度标注 + 落到 packs/。
    // 刻意不做"自动改写题面"——题面必须是人写的，这里只做机器能确定的事。
    const file = args._[2];
    if (typeof file !== 'string') {
      console.error('用法：node src/cli.mjs pack promote <草案.json> [--into=packs/名字.json] [--dry-run]');
      return 2;
    }
    let draft;
    try {
      draft = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      console.error('读取或解析失败：' + err.message);
      return 1;
    }
    const result = promoteDraft(draft, {
      into: typeof args.into === 'string' ? args.into : null,
      dryRun: Boolean(args['dry-run']),
      validate: function (candidate) { return validatePack(candidate, { isAllowedCommand: isAllowed }); }
    });
    if (asJson) {
      out(result);
    } else {
      console.log('草案包：' + result.packId + '　题数：' + result.taskCount);
      if (result.levelsAdded.length) {
        console.log('按难度口径补上 level：' + result.levelsAdded.map(function (row) { return row.id + '=' + row.level; }).join('、'));
      }
      result.warnings.forEach(function (msg) { console.log('提醒：' + msg); });
      result.errors.forEach(function (msg) { console.log('错误：' + msg); });
      if (result.errors.length) { console.log('未通过校验，已中止'); return 1; }
      if (result.dryRun) {
        console.log('（--dry-run：没有写文件。去掉 --dry-run 就会写到 ' + result.target + '）');
      } else {
        console.log('已写入：' + result.target);
      }
      // 两条路要分开说：内置包要改源码（挂知识点、进 BUILTIN_PACKS），
      // 外部包不用——之前一律让用户去改 src/core/knowledge.mjs，那是条走不通的路
      console.log('下一步（两条路选一条）：');
      console.log('  放进内置题库：1) 把 "' + result.packId + '" 加进 src/core/packs.mjs 的 BUILTIN_PACKS');
      console.log('                2) 每题至少挂一个知识点：src/core/knowledge.mjs（内置题没挂，audit 会判错）');
      console.log('                3) node src/cli.mjs audit');
      console.log('  当外部包用（不改源码）：1) DSH_LEARN_PACKS=' + result.target.replace(/\/[^/]+$/, '') + ' node src/cli.mjs list');
      console.log('                          2) node src/cli.mjs audit（外部题不参与知识点对账，也不进 BUILTIN_PACKS）');
    }
    return result.errors.length ? 1 : 0;
  }

  if (sub === 'list') {
    const dirs = [BUILTIN_PACK_DIR].concat(EXTRA_PACK_DIR ? [EXTRA_PACK_DIR] : []);
    const rows = [];
    dirs.forEach(function (dir) {
      loadPackDir(dir).forEach(function (pack_) {
        rows.push({ id: pack_.id, name: pack_.name || pack_.id, track: pack_.track, tasks: (pack_.tasks || []).length, dir: dir });
      });
    });
    if (asJson) {
      out(rows);
    } else {
      rows.forEach(function (row) {
        console.log(row.id + '　[' + row.track + ']　' + row.name + '　' + row.tasks + ' 题　' + row.dir);
      });
    }
    return 0;
  }

  if (sub === 'keygen') {
    const result = generateKey({ force: Boolean(args.force) });
    console.log((result.created ? '已生成：' : '未改动：') + result.path + '　' + result.reason);
    return result.created ? 0 : 1;
  }

  if (sub === 'sign') {
    const file = args._[2];
    if (typeof file !== 'string') {
      console.error('用法：node src/cli.mjs pack sign <file.json> [--signer=名字]');
      return 2;
    }
    const result = signFile(file, { signer: typeof args.signer === 'string' ? args.signer : undefined });
    if (!result.ok) {
      console.error(result.reason);
      return 1;
    }
    console.log('已签名：' + result.path);
    console.log('哈希：' + result.signature.sha256);
    console.log('签发者：' + result.signature.signer + '　算法：' + result.signature.alg);
    return 0;
  }

  if (sub === 'verify') {
    const file = args._[2];
    if (typeof file !== 'string') {
      console.error('用法：node src/cli.mjs pack verify <file.json>');
      return 2;
    }
    const result = verifyFile(file);
    if (asJson) {
      out(result);
    } else {
      console.log('文件：' + file);
      console.log('结果：' + (result.ok ? '签名有效' : '未通过') + '　' + result.reason);
      console.log('哈希：' + (result.sha256 || '-'));
    }
    return result.ok ? 0 : 1;
  }

  if (sub === 'trust') {
    const file = args._[2];
    if (typeof file !== 'string') {
      console.error('用法：node src/cli.mjs pack trust <file.json>');
      return 2;
    }
    const result = addTrust(file, {});
    console.log('已记录信任：' + result.entry.file + '（' + (result.entry.verified ? '签名已校验' : '无签名，仅哈希锁定 TOFU') + '）');
    console.log('信任库：' + result.store);
    return 0;
  }

  if (sub === 'trusted') {
    const rows = listTrust({});
    if (asJson) {
      out(rows);
    } else if (!rows.length) {
      console.log('信任库为空：' + trustStorePath({}));
    } else {
      console.log('已信任的题库包（密钥：' + keyPath({}) + '）');
      rows.forEach(function (row) {
        console.log('  ' + row.file + '　' + (row.verified ? '签名有效' : '仅哈希锁定') + '　' + row.sha256.slice(0, 16) + '...　' + (row.trustedAt || ''));
      });
    }
    return 0;
  }

  console.error('用法：node src/cli.mjs pack list | validate <file> | keygen | sign <file> | verify <file> | trust <file> | trusted');
  return 2;
}
// 草案 → 正式包：机器能确定的事只做两件（校验 + 按口径补 level），题面改写仍然交给人。
// 导出出来是为了让测试直接调，不必走命令行。
export function promoteDraft(draft, options) {
  const opts = options || {};
  const pack = JSON.parse(JSON.stringify(draft || {}));
  const tasks = pack.tasks || [];
  const levelsAdded = [];
  const warnings = [];

  tasks.forEach(function (task) {
    if (!task.level) {
      task.level = expectedLevel(task);
      levelsAdded.push({ id: task.id, level: task.level });
    }
    if (/（草案）|草案/.test(String(task.title || ''))) warnings.push(task.id + '：标题还是草案字样，改成一句话说清要做什么');
    if (/请人工确认|来自网站示例/.test(String(task.hint || ''))) warnings.push(task.id + '：提示还是生成时的占位话，改成自己的话');
    const elements = (task.require || []).length;
    if (elements <= 2) warnings.push(task.id + '：只有 ' + elements + ' 个要素，学员随便敲一下就满分，建议补要素或删掉');
    if (!task.verify) warnings.push(task.id + '：没有只读验证项（可选，但有的话能真跑一次）');
  });

  const result = opts.validate ? opts.validate(pack) : { errors: [], warnings: [] };
  const errors = (result.errors || []).slice();
  // 目标路径只允许落在 baseDir 之内：--into 是调用方给的字符串，
  // 直接当路径用就能写到仓库外（实测 --into=../../escaped.json 真的写到了上一层目录）。
  // 判定规则：
  //   给了 baseDir（网页版会把它设成项目目录）→ 目标必须落在其中；
  //   没给 baseDir 而 --into 是相对路径 → 以当前目录为根，不许 ../ 爬出去（相对路径最容易"看着像是写在 packs/"）；
  //   显式写绝对路径 → 放行（调用方清楚自己在写哪儿，CLI 用户在给自己写文件）。
  const baseDir = opts.baseDir ? resolve(opts.baseDir) : null;
  const target = opts.into
    ? (baseDir ? resolve(baseDir, opts.into) : resolve(opts.into))
    : resolve(process.cwd(), join('packs', slug(pack.id || 'draft-pack') + '.json'));
  const guardRoot = baseDir || (opts.into && isAbsolute(String(opts.into)) ? null : resolve(process.cwd()));
  if (guardRoot && !withinDir(guardRoot, target)) {
    errors.push('目标必须写在 ' + guardRoot + ' 之内，收到的是：' + opts.into);
  }

  if (!errors.length && !opts.dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target) && !opts.force) {
      errors.push('目标已存在，不想覆盖就换 --into，或加 --force：' + target);
    } else {
      writeFileSync(target, JSON.stringify(pack, null, 2) + '\n');
    }
  }

  return {
    packId: pack.id,
    taskCount: tasks.length,
    levelsAdded: levelsAdded,
    warnings: warnings.concat((result.warnings || []).map(function (msg) { return '校验提醒：' + msg; })),
    errors: errors,
    target: target,
    dryRun: Boolean(opts.dryRun)
  };
}
