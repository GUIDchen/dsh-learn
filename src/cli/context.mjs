// CLI 运行上下文：解析参数、准备平台与客户端信息，并给命令实现提供公共工具。
// 命令实现统一接收 ctx，模块之间不互相 import 内部实现。
import { parseArgs } from '../core/args.mjs';
import { detectPlatform, getProfile, listPlatforms } from '../core/platform.mjs';
import { findTask, PACK_IDS, EXTRA_PACK_DIR, TRACKS, LEVELS } from '../core/tasks.mjs';

export const VALUE_FLAGS = ['client', 'platform', 'track', 'level', 'hours', 'runner', 'endpoint', 'token', 'image', 'limit', 'signer', 'out', 'tasks', 'minutes',
  // analyze / knowledge 用到的输入参数（--text 里可能带空格，必须当取值型处理）
  'text', 'file', 'url', 'ocr', 'html', 'top', 'cookie', 'cookie-file', 'out', 'from',
  // project / learn-repo：项目名与本地目录都可能带空格或中文
  'project', 'name', 'repo', 'note',
  // 批量导入与调研：目录、前缀、每类份数
  'dir', 'files', 'prefix', 'per', 'min-jobs', 'only', 'delay', 'list-url', 'recursive',
  // jobs（简历投递）：公司名/岗位名/备注都可能带空格，--jd-file 是路径
  'company', 'position', 'status', 'date', 'jd', 'jd-file', 'q',
  // prefs（界面偏好）：语言与主题都是取值型
  'theme', 'lang',
  // search / research：引擎名是短取值，关键词走位置参数
  'engine'];

// 命令实现抛这个错误表示"用法/参数问题"，由入口统一转成退出码。
// 不直接 process.exit()，是为了让 handler 能在测试里被直接调用。
export class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = 'CliError';
    this.exitCode = typeof exitCode === 'number' ? exitCode : 2;
  }
}

// 用法文本里出现的选项就是白名单：不认识 --xxx 说明多半是拼错了，
// 静默忽略会让结果悄悄变成另一回事（实测：--platfrom=linux 拼错 → 按 darwin 判定还照样退 0）。
// 用函数延迟计算：USAGE_LINES 在文件后面才声明，直接写 const 会撞上暂时性死区
let knownFlagsCache = null;
function knownFlags() {
  if (!knownFlagsCache) {
    knownFlagsCache = new Set((USAGE_LINES.join(String.fromCharCode(10)).match(/--[a-z][a-z0-9-]*/g) || [])
      .map(function (flag) { return flag.slice(2); }));
  }
  return knownFlagsCache;
}

// 编辑距离：给拼错的选项一个「是不是想写 --level？」的建议
function editDistance(a, b) {
  const rows = [];
  for (let i = 0; i <= a.length; i += 1) { rows.push([i]); }
  for (let j = 0; j <= b.length; j += 1) { rows[0][j] = j; }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

function suggestFlag(name) {
  let best = '';
  let bestScore = 99;
  knownFlags().forEach(function (known) {
    const score = editDistance(name, known);
    if (score < bestScore) { bestScore = score; best = known; }
  });
  return bestScore <= 2 ? best : '';
}

export function unknownFlags(args) {
  return Object.keys(args || {}).filter(function (key) {
    if (key === '_') return false;
    return !knownFlags().has(String(key).toLowerCase());
  });
}

// 取到的值也要校验：拼错选项现在会被拦下，但**拼错值**照样静默走默认——
// 实测 --track=dokcer 会列出整个题库、--platform=linx 会按 generic 判定（变体题就判错了）、
// --hours=abc 会退成默认 2 小时。都在这里一次性拦掉。
const NUMERIC_FLAGS = ['limit', 'hours', 'minutes', 'top'];

function validateArgs(args) {
  if (typeof args.platform === 'string' && args.platform) {
    const allowed = listPlatforms().map(function (row) { return row.id; })
      .concat(['generic', typeof process !== 'undefined' ? process.platform : 'generic']);
    if (allowed.indexOf(args.platform) === -1) {
      throw new CliError('未知平台：' + args.platform + '　可选：' + listPlatforms().map(function (row) { return row.id; }).join(' / ')
        + '（不写 --platform 就用本机平台）', 2);
    }
  }
  if (typeof args.track === 'string' && args.track && args.track !== 'all' && TRACKS.indexOf(args.track) === -1) {
    // 建议要在**轨道名**里找最接近的，不是在一堆选项名里找（否则会给出"是不是想写 某个内置轨道"这种废话）
    let guess = '';
    let bestScore = 99;
    TRACKS.forEach(function (known) {
      const score = editDistance(args.track, known);
      if (score < bestScore) { bestScore = score; guess = known; }
    });
    throw new CliError('未知轨道：' + args.track + (bestScore <= 2 ? '（是不是想写 ' + guess + '？）' : '') + '　可选：'
      + TRACKS.slice(0, 8).join(' / ') + ' …（全部 ' + TRACKS.length + ' 条：node src/cli.mjs list --track=all）', 2);
  }
  if (typeof args.level === 'string' && args.level && args.level !== 'all' && LEVELS.indexOf(args.level) === -1) {
    throw new CliError('未知难度：' + args.level + '　可选：' + LEVELS.join(' / '), 2);
  }
  NUMERIC_FLAGS.forEach(function (name) {
    const value = args[name];
    if (value === undefined) return;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw new CliError('--' + name + ' 需要一个非负整数，收到：' + JSON.stringify(value), 2);
    }
  });
}

export function createContext(argv) {
  const args = parseArgs(argv, VALUE_FLAGS);
  // 拼错的选项直接拦下：静默忽略会让"我以为按 linux 判的"变成按 darwin 判，而且退出码还是 0
  const unknown = unknownFlags(args);
  if (unknown.length) {
    const tips = unknown.map(function (key) {
      const guess = suggestFlag(String(key).toLowerCase());
      return '--' + key + (guess ? '（是不是想写 --' + guess + '？）' : '');
    });
    throw new CliError('不认识的选项：' + tips.join('、') + '。用 "node src/cli.mjs help" 看全部选项。', 2);
  }
  validateArgs(args);
  const platform = detectPlatform(typeof args.platform === 'string' ? args.platform : undefined);
  const profile = getProfile(platform);

  const ctx = {
    args: args,
    command: args._[0] || 'help',
    platform: platform,
    profile: profile,
    client: String(typeof args.client === 'string' ? args.client : 'cli-' + platform),
    asJson: Boolean(args.json),
    out: function (data) {
      if (ctx.asJson) console.log(JSON.stringify(data, null, 2));
      else console.log(data);
    },
    requireTask: function (id) {
      const task = findTask(id);
      if (!task) {
        throw new CliError('未找到任务：' + id + '。可用 "node src/cli.mjs list" 查看全部任务。', 2);
      }
      return task;
    }
  };
  return ctx;
}

// 用法文本同时是**选项白名单的来源**：不认识 --xxx 时报错并给最接近的建议（见 createContext）。
// 所以新增命令选项时，这里必须一起写——test/cli-commands.test.mjs 有一条守卫盯着两者的漂移。
export const USAGE_LINES = [
    'dsh-learn / cmdlearn —— 跨平台命令行学习与验证（macOS 优先，Linux 同步支持）',
    '',
    '用法：',
    '  node src/cli.mjs list [--track=docker|linux] [--level=easy|medium|hard] [--platform=darwin|linux]',
    '  node src/cli.mjs show <taskId> [--platform=darwin]',
    '  node src/cli.mjs check <taskId> "<你的命令>" [--client=mac-dev] [--platform=darwin] [--run] [--timeout=5000]',
    '  node src/cli.mjs verify <taskId> [--run] [--runner=local|docker|remote]',
    '  node src/cli.mjs probe [--run]',
    '  node src/cli.mjs runners',
    '  node src/cli.mjs board',
    '  node src/cli.mjs progress [--client=mac-air]',
    '  node src/cli.mjs daily [--track=docker]',
    '  node src/cli.mjs review [--limit=10] [--track=docker]',
    '     按间隔重复列出该复习的题（未通过 1 天、一次通过 7 天、连续通过 7n 天，上限 30 天）。',
    '  node src/cli.mjs goal [show] | goal set [--tasks=3] [--minutes=20]',
    '  node src/cli.mjs note [<taskId> ["内容"] [--delete]]',
    '  node src/cli.mjs jobs list [--status=applied|interview|offer|closed|todo|all] [--q=关键词] [--json]',
    '  node src/cli.mjs jobs follow [--stale-days=5] [--now=YYYY-MM-DD] [--out=跟进.md] [--json]',
    '  node src/cli.mjs jobs add --company=某某科技 --position=运维工程师 [--status=applied] [--date=YYYY-MM-DD] [--url=链接] [--note=备注] [--jd="…" | --jd-file=jd.txt]',
    '  node src/cli.mjs jobs update <记录 id> [--status=interview] [--note=…] [--company=…] [--position=…] [--date=…]',
    '  node src/cli.mjs jobs analyze <记录 id>　　jobs drill <记录 id> [--csv]　　jobs delete <记录 id>',
    '  node src/cli.mjs ocr <图片> [--json]　|　node src/cli.mjs ocr --capabilities',
    '     识图：把截图里的文字识别出来（macOS 走系统 Vision，离线；其它平台走 tesseract 或 DSH_LEARN_OCR）；--capabilities 自查能力矩阵',
    '  node src/cli.mjs understand --text 「岗位描述」 | --file jd.md | --ocr 截图.png [--json]',
    '     文字理解：把自由文本读成结构化信息（岗位/公司/级别/硬要求/加分项/技术栈/知识点/可练题），每条判断都给出依据',
    '  node src/cli.mjs survey --dir=岗位目录 | --files=a.txt,b.txt [--min-jobs=2] [--out=调研.md] [--json]',
    '  node src/cli.mjs survey --dir=语料根目录 --by-category [--only=imaging,yolo] [--out=分方向.md] [--json]',
    '  node src/cli.mjs corpus <关键词…> [--project=名字] [--any] [--limit=20] [--context=40] [--out=结果.md] [--json]',
    '  node src/cli.mjs doctor [--fix] [--json]',
    '  node src/cli.mjs mastery [--limit=5] [--now=YYYY-MM-DD] [--json]',
    '  node src/cli.mjs metrics [--limit=200] [--json]',
    '  node src/cli.mjs start [--json]   # 首次运行引导：看走到哪一步、下一步跑什么',
    '  node src/cli.mjs commands [--query=词] [--json]   # 命令面板的命令表（含快捷键）',
    '  node src/cli.mjs prefs [--theme=auto|light|dark] [--lang=zh-CN|en] [外观] [语言] [--json]   # 三端共用的外观与语言偏好（也可写位置参数：prefs dark en）',
    '  node src/cli.mjs model [--json]   # 可选模型：配置状态（默认离线，失败回退规则引擎）',
    '  node src/cli.mjs scorecard [--days=14] [--out=成绩单.md|.csv] [--json]   # 进度趋势与成绩单导出',
    '  node src/cli.mjs remind [--now=YYYY-MM-DDTHH:MM] [--json]   # 目标提醒：今天还差几题',
    '  node src/cli.mjs storage status|migrate [--dry-run] [--json]',
    '  node src/cli.mjs backup [--out=文件] [--dry-run] [--json]',
    '  node src/cli.mjs restore <备份文件> [--home=目录] [--dry-run] [--json]',
    '     多岗位调研：热度排行（出现在多少个岗位）+ 跨岗位通用技能 + 缺口 + 行动建议',
    '  node src/cli.mjs describe [--file=JD.txt | --text=「…」 | --ocr=截图.png | --url=链接] [--out=报告.md] [--json]',
    '     把一份岗位要求/文档/截图/链接「描述清楚」，再抽全技术栈（按类别）与知识点（含未覆盖清单）',
    '  node src/cli.mjs flow status|next [--json]　|　flow resume [--md] [--out=resume.md] [--json]',
    '  node src/cli.mjs flow collect --query=「运维 招聘」 [--limit=5]　|　flow recommend [--limit=5] [--threshold=60]',
    '  node src/cli.mjs flow apply <岗位记录 id> [--open] [--json]',
    '     七步闭环：学习 → 项目解析学习 → 生成简历 → 搜集招聘信息 → 按岗位补知识点 → 岗位推荐 → 投递。状态从真实数据推出来，不含虚构经历',
    '  node src/cli.mjs search <关键词> [--engine=bing|duckduckgo|custom] [--limit=8] [--json]',
    '  node src/cli.mjs research <关键词> [--limit=5] [--project=项目名] [--engine=…] [--json]',
    '     搜索并解析：先搜（默认 Bing，失败自动换 DuckDuckGo），再把命中页面抓回来抽知识点与命令草案；--project 直接收进项目',
    '     投递记录与 JD 分析（与网页版「简历投递」页、原生端同一份数据）：analyze 把知识点与可练题存回记录，drill 打印开练命令',
    '  node src/cli.mjs report [--out=report.md]',
    '  node src/cli.mjs plan [--hours=2] [--track=docker] [--platform=darwin] [--status]',
    '  node src/cli.mjs export [file.json]',
    '  node src/cli.mjs import <file.json>',
    '  node src/cli.mjs repl [--track=docker]',
    '  node src/cli.mjs drill [--weak|--all] [--limit=5] [--track=] [--tasks=a,b,c]',
    '     默认挑出"练过但没满分"的题定向重练；--all 练全部；--tasks 按指定清单练（可直接接 analyze 的输出）。',
    '  node src/cli.mjs analyze --text "岗位描述" | --file jd.md | --url https://... | --ocr shot.png [--top=10] [--html] [--cookie=...] [--cookie-file=文件]',
    '     分析岗位 JD / 技术文档 / 截图：列出命中的知识点、对应题目与建议训练顺序（也可用管道喂文字）。',
    '     截图 OCR 走 macOS 自带 Vision（本地识别，不联网）；其他平台请用 --text / --file。',
    '  node src/cli.mjs knowledge [--json]',
    '  node src/cli.mjs modules [--json]',
    '  node src/cli.mjs learn-site <链接|文件> [--limit=20] [--out=drafts/x.json] [--apply]',
    '     抓取文档页里的命令示例，生成"题库草案"（含复核清单），入库前必须人工改写并跑 audit。',
    '  node src/cli.mjs project init|list|show|add <名字> [--file 图片/文本] [--text "..."] [--url 链接] [--note=...] [--name=...] [--csv]',
    '  node src/cli.mjs project list [--query=关键词] [--missing-text] [--sort=updated|name|sources|knowledge|tasks] [--json]',
    '  node src/cli.mjs project drill <名字> | --prefix=boss- [--limit=12] [--csv] [--json]',
    '  node src/cli.mjs project jdplan <名字> [--source=N] [--max=10] [--json]',
    '  node src/cli.mjs project refresh <名字> | --prefix=boss- [--json]',
    '  node src/cli.mjs project backfill --dir=语料根目录 [--project=名字] [--json]',
    '  node src/cli.mjs project rename <旧名字> <新名字>',
    '  node src/cli.mjs project import --dir=目录 [--prefix=boss-] [--project=单个项目名] [--limit=20] [--json]',
    '  node src/cli.mjs project promote <名字> <草案文件> [--project-only] [--force] [--dry-run]',
    '     按目录批量导入语料：目录下每个子目录建一个项目（可加前缀），每份文件收成一条来源并抽知识点',
    '     草案 → 总题库（写进仓库 packs/，所有客户端下次启动就能练）；--project-only 只写项目的 promoted/，'
    + '--dry-run 先看一遍（打印目标路径与提醒），--force 覆盖同名包',
    '     建立项目目录（默认 ~/.dsh-learn/projects/<名字>/）：截图 OCR / 文字描述 / 链接都能收进来，',
    '     解析出的知识点写进 notes/，抽到的命令写进 drafts/（草案，不自动进题库）。',
    '  node src/cli.mjs learn-repo <本地目录 | git 链接> [--project=名字] [--limit=20] [--branch=分支] [--refresh] [--repo=目录]',
    '     浅克隆（链接时）或直接扫描本地仓库：识别技术信号 → 匹配知识点 → 从 README/Makefile/脚本抽命令出草案。',
    '     打印知识点字典（模块、难度、对应题目），也能看到哪些知识点还没有题。',
    '  node src/cli.mjs selftest [--run] [--platform=darwin|linux] [--runner=local|docker] [--image=]',
    '  node src/cli.mjs audit [--json]',
    '     题库体检：参考答案是否自查满分、变体是否有区分度、验证命令是否都在白名单内。',
    '  node src/cli.mjs security whitelist [--json]',
    '     白名单与题库对账：题库声明的验证命令是否都能跑、有没有该删的条目、危险命令是否仍被拒绝。',
    '  node src/cli.mjs pack list',
    '  node src/cli.mjs pack validate <file.json> [--deep] [--json]',
    '  node src/cli.mjs pack new <id> [--name=…] [--track=…] [--title=…] [--sample=…] [--task=…] [--verify-cmd=…] [--dir=packs] [--force] [--json]',
    '  node src/cli.mjs pack keygen | sign <file> [--signer=名字] | verify <file> | trust <file> | trusted',
    '  node src/cli.mjs pack promote <草案.json> [--into=packs/名字.json] [--dry-run] [--force]',
    '     外部包可用本地密钥签名，并用 DSH_LEARN_REQUIRE_TRUST=1 打开加载门禁。',
    '',
    '外部题库：export DSH_LEARN_PACKS=/path/to/packs 后，该目录下的包会被加载并覆盖同 id 内置题。',
    '当前包：' + PACK_IDS.join(', ') + (EXTRA_PACK_DIR ? '（外部目录 ' + EXTRA_PACK_DIR + '）' : ''),
    '',
    '说明：默认不执行任何命令；--run 只放行只读白名单内的探测命令。',
    '远程后端示例：--runner=remote --endpoint=http://linux-box:8790 --token=xxx',
    '容器后端示例：--runner=docker --image=alpine:3.20',
    ''
];

export function printUsage(ctx) {
  // 用法文本与选项白名单必须来自同一处：只写在 printUsage 里而不进 USAGE_LINES 的选项，
  // 会被当成拼写错误拦下（实测 --endpoint / --token 就是这么暴露出来的）。
  console.log(USAGE_LINES.concat([
    '当前平台：' + ctx.profile.name + '（' + ctx.profile.tools + '，Docker 运行时：' + ctx.profile.dockerRuntime + '）'
  ]).join(String.fromCharCode(10)));
}
