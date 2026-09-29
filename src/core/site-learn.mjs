// 从网页/文档里"学"出题库草案：抽取命令行示例 → 生成 draft 任务（供人工复核后再入库）。
// 刻意不做自动入库：草案是给人看的，入库要过一次体检（node src/cli.mjs audit）。
import { readFileSync } from 'node:fs';
import { slugAscii } from './text.mjs';

// 工具 → 轨道：只认我们已经有轨道的工具，认不出来就不生成（宁缺毋滥）
const TOOL_TRACK = [
  { re: /^docker\s+compose\b|^docker-compose\b/, tool: 'docker compose', track: 'docker' },
  { re: /^docker\b/, tool: 'docker', track: 'docker' },
  { re: /^kubectl\b/, tool: 'kubectl', track: 'k8s' },
  { re: /^git\b/, tool: 'git', track: 'git' },
  { re: /^mysqldump\b|^mysql\b/, tool: 'mysql', track: 'database' },
  { re: /^redis-cli\b/, tool: 'redis-cli', track: 'database' },
  { re: /^curl\b/, tool: 'curl', track: 'network' },
  { re: /^tcpdump\b|^dig\b|^iperf3\b|^ip\b|^ifconfig\b|^netstat\b|^mtr\b/, tool: 'netops', track: 'netops' },
  { re: /^systemctl\b|^journalctl\b|^service\b/, tool: 'systemctl', track: 'service' },
  { re: /^python3?\b|^pip3?\b|^pytest\b/, tool: 'python', track: 'python' },
  { re: /^gcc\b|^clang\b/, tool: 'gcc', track: 'c' },
  { re: /^g\+\+\b|^clang\+\+\b|^cmake\b|^valgrind\b/, tool: 'cpp', track: 'cpp' },
  { re: /^arm-none-eabi-\w+|^openocd\b/, tool: 'embedded', track: 'embedded' },
  { re: /^yolo\b/, tool: 'yolo', track: 'yolo' },
  { re: /^magick\b|^convert\b|^ffmpeg\b/, tool: 'imaging', track: 'imaging' },
  { re: /^promtool\b|^node_exporter\b|^ansible-playbook\b|^npm\b|^npx\b/, tool: 'ops', track: 'ops' },
  { re: /^find\b|^sed\b|^awk\b|^grep\b|^tar\b|^rsync\b|^xargs\b|^du\b/, tool: 'linux', track: 'linux' },
  // Go / Rust / 构建与压测工具：仓库里最常见的几类命令，之前不在表里，
  // 结果从 Go 或 Rust 仓库解析草案时一条都抽不出来
  { re: /^go\b|^gofmt\b|^staticcheck\b|^govulncheck\b|^golangci-lint\b/, tool: 'go', track: 'go' },
  { re: /^cargo\b|^rustc\b|^rustup\b|^clippy-driver\b/, tool: 'rust', track: 'rust' },
  { re: /^make\b|^just\b/, tool: 'make', track: 'shell' },
  { re: /^helm\b|^kustomize\b|^kind\b|^minikube\b/, tool: 'k8s', track: 'k8s' },
  { re: /^terraform\b|^ansible\b|^vault\b/, tool: 'ops', track: 'ops' },
  { re: /^ab\b|^wrk\b|^iostat\b|^vm_stat\b|^sar\b/, tool: 'perf', track: 'perf' },
  { re: /^ss\b|^ip\b|^nft\b|^iptables\b|^conntrack\b|^ssh\b|^ssh-keyscan\b|^traceroute\b/, tool: 'netops', track: 'netops' },
  { re: /^openssl\b|^gitleaks\b|^trivy\b|^ssh-audit\b/, tool: 'security', track: 'security' },
  // Windows 运维：PowerShell 的「动词-名词」命令与 cmd/系统工具。
  // 之前没有 windows 轨道，从 Windows 文档或截图里解析出来的命令一条都归不到轨（现在有 10 道题的 windows 轨）
  { re: /^(Get|Test|Resolve|Measure|Select|Where|Sort|Format|Out|Import|Export|Copy|Move|New)-[A-Za-z]+\b/, tool: 'powershell', track: 'windows' },
  { re: /^powershell\b|^pwsh\b/, tool: 'powershell', track: 'windows' },
  { re: /^netsh\b|^icacls\b|^ipconfig\b|^register\.exe|^dumpbin\b|^w32tm\b/, tool: 'windows', track: 'windows' }
];

// 带环境变量的命令（CGO_ENABLED=0 GOOS=linux go build …）在 shell 里很常见，
// 但工具名不在行首，按行首匹配会一条都抓不到。剥掉前导 VAR=value 再认工具名。
export function stripEnvPrefix(line) {
  let text = String(line || '').trim();
  while (/^[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+/.test(text)) {
    text = text.replace(/^[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+/, '');
  }
  return text;
}

// 危险写法：命中就写成 forbid（带 block 的照旧 block）
const DANGEROUS = [
  { p: 'rm\\s+-rf', tip: '删目录属于不可逆操作', severity: 'block' },
  { p: 'prune\\s+.*--volumes|--volumes', tip: '--volumes 会删掉数据卷', severity: 'block' },
  { p: 'git\\s+reset\\s+--hard', tip: '--hard 会丢掉未提交改动', severity: 'block' },
  { p: 'git\\s+push\\s+--force(?!-with-lease)', tip: '强推会覆盖别人的提交' },
  { p: 'kubectl\\s+delete\\s+(ns|namespace|deployment)\\b', tip: '删除命名空间/工作负载影响面很大', severity: 'block' },
  { p: 'keys\\s+\\*', tip: 'KEYS * 会阻塞 Redis', severity: 'block' },
  { p: 'chmod\\s+777', tip: '777 权限过宽' },
  { p: '--privileged', tip: 'privileged 会给容器主机权限' }
];

function htmlToCodeBlocks(html) {
  const blocks = [];
  const re = /<pre[^>]*>([\s\S]*?)<\/pre>|<code[^>]*>([\s\S]*?)<\/code>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const raw = (m[1] || m[2] || '');
    const text = raw.replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
    text.split('\n').forEach(function (line) {
      const clean = line.replace(/^[\s$#>]+/, '').trim();
      if (clean) blocks.push(clean);
    });
  }
  return blocks;
}

// 一句话：把命令变成"题目要素"
// 工具名必须是**完整的第一个词**，且后面跟空格或行尾。
// 实测（真克隆 kubernetes/examples）：只写 \b 会把这些当命令抽出来——
//   "kind: PersistentVolume"（YAML 的 key: value，"kind" 恰好是个真工具名）
//   "service, but you can use your own. See the etcd docs for more:"（英文句子，"service" 后面是逗号）
// 两条都成了「只有工具名」的废话题。工具名后必须是空白，这两类自然出局。
function matchTool(bare) {
  const firstToken = bare.split(/\s/)[0] || '';
  const row = TOOL_TRACK.filter(function (matched) {
    const m = bare.match(matched.re);
    if (!m) return false;
    return m[0].length === firstToken.length || bare.charAt(m[0].length) === ' ';
  })[0];
  if (!row) return null;
  const m = bare.match(row.re);
  // 生成判定规则时要用**命令里真实出现的那个词**，不能用工具标签：
  // 标签是分组的（k8s / linux / netops / cpp / ops…），拿它拼出来的规则永远匹配不上，
  // 学员写对了命令也会被判缺要素。实测：minikube start 生成的是 k8s 规则，sed -i … 生成的是 linux 规则。
  return Object.assign({}, row, { word: (m && m[0].split(/\s/)[0]) || firstToken });
}

export function extractCommands(text) {
  // 反斜杠续行先接起来：README 里长命令常写成多行，
  // 只取第一行会得到 "curl -X POST \"$URL\" \" 这种半截命令（实测被标成"要素太少"）。
  const joined = String(text || '').replace(/\\\s*\n\s*/g, ' ');
  const lines = joined.split('\n').map(function (line) { return line.replace(/^[\s$#>]+/, '').trim(); });
  const out = [];
  const seen = new Set();
  lines.forEach(function (line) {
    if (!line || line.length < 6 || line.length > 200) return;
    if (/[<>{}]|https?:\/\//.test(line)) return; // 占位符与链接不是可直接练的命令
    if (/^(#|\/\/|--)/.test(line)) return;
    if (/^(Usage|用法)[:：]/.test(line)) return;
    if (/\[[A-Z]{2,}\]|\[OPTIONS\]|\bOPTIONS\b/.test(line)) return; // 用法签名（[OPTIONS] [IMAGE]）不是可执行的命令
    if (/\s\|\s|Docker Docs|目录|上一页|下一页/.test(line)) return; // 导航/面包屑不是命令
    const bare = stripEnvPrefix(line);
    const hit = matchTool(bare);
    if (!hit) return;
    const normalized = line.replace(/\s+/g, ' ');
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ command: normalized, tool: hit.tool, word: hit.word, track: hit.track });
  });
  return out;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^$()|[\]\\]|\{|\}/g, '\\$&');
}

// 原行为：只留 ASCII、限长 40（用的是 slugAscii）
function slug(text) { return slugAscii(text, { max: 40 }); }

// 命令里有没有"裸词"（不是选项、不是路径、不是占位符）：子命令与目标名就长这样
function isBareWord(token) {
  if (!token) return false;
  if (/^-/.test(token)) return false;
  if (/[\/\\$`{}<>|&;"'=]/.test(token)) return false;
  // 允许冒号：镜像名带 tag（nginx:1.25）是最常见的目标对象；
  // 斜杠仍然排除，免得把路径/localhost:8080 路径当成目标
  return /^[a-z][a-z0-9._:-]*$/i.test(token) && token.length <= 32;
}

// 目标对象：裸词（nginx:1.25 / openshift-origin）之外，**带引号的参数、URL 与路径**也算——
// isBareWord 明确排除斜杠，于是 curl "localhost:8085/bookable?check_in=…" 这种示例一个目标都抽不到，
// 草案只剩工具名一个要素（实测 gin 的 3 条 curl 草案全被判"要素太少"）。
// URL 只保留主机与路径：查询串的值每次都不同，这道题要考的是"写对主机与路径"。
function targetOf(token) {
  const raw = String(token || '').replace(/^["']|["']$/g, '');
  if (isBareWord(raw)) return raw;
  const stable = raw.split('?')[0].replace(/\/+$/, '');
  if (/^https?:\/\/[a-z0-9._~\-%:\/]+$/i.test(stable)) return stable;
  // 带主机/端口的路径（curl localhost:8085/bookable）与绝对路径（stty -f /dev/tty.usbserial）
  if (/^[a-z][a-z0-9._-]*(:\d+)?\/[a-z0-9._~\-%\/]+$/i.test(stable)) return stable;
  if (/^\/[a-z0-9._~\-%\/]+$/i.test(stable)) return stable;
  return '';
}

// 是不是"路径/URL 形态"：这类词（接口地址、设备文件）通常比结尾的裸词更该当目标
function looksLikePath(token) {
  const stable = String(token || '').replace(/^["']|["']$/g, '').split('?')[0].replace(/\/+$/, '');
  return /^(https?:\/\/|\/|[a-z][a-z0-9._-]*(:\d+)?\/)/i.test(stable);
}

// 从命令里挑出"值得当要素"的部分：子命令、目标对象、长选项、带值的短选项
export function ruleHints(command) {
  const tokens = command.split(/\s+/).slice(1);
  const words = [];
  const flags = [];
  // 子命令（docker run / kubectl delete / minikube start 里的第二个词）。
  // 这里原来只收选项、注释却写着"子命令"，实测出来的草案长这样：
  //   minikube start         → 只有一个要素 minikube（敲 minikube 就满分）
  //   kubectl delete ns demo → 同样只有一个 kubectl
  // 少一个要素，题目就从"会不会写"退化成"敲没敲工具名"。
  if (isBareWord(tokens[0])) words.push({ token: tokens[0], presence: 'word' });

  // 目标对象（docker run … nginx:1.25 里的镜像名、kubectl delete ns openshift-origin 里的名字）：
  // 它才是这道题真正该考的东西，所以先占名额——选项先来会把名额占满，对象反而进不来。
  // 先找路径/URL 形态的目标（stty -f /dev/tty… 里的设备、curl 里的接口、-o 后面的输出文件不算），
  // 没有再退回到"最后一个裸词"（kubectl delete ns openshift-origin 里的名字）。
  let target = '';
  for (let i = tokens.length - 1; i >= 0 && !target; i--) {
    if (tokens[i].startsWith('-')) continue;
    if (looksLikePath(tokens[i])) target = targetOf(tokens[i]);
  }
  if (!target) {
    for (let i = tokens.length - 1; i >= 0 && !target; i--) {
      if (tokens[i].startsWith('-')) continue;
      target = targetOf(tokens[i]);
    }
  }
  if (target) words.push({ token: target, presence: 'word' });


  // 选项最后收，最多再多 3 个（加上工具名一共不超过 6 个要素，免得草案变成一句话念不完）
  for (let i = 0; i < tokens.length && flags.length < 3; i++) {
    const token = tokens[i];
    if (/^-{1,2}[a-zA-Z]/.test(token) && token.length > 1) {
      const next = tokens[i + 1] && !/^-/.test(tokens[i + 1]) ? tokens[i + 1] : '';
      // 带值才连上：-p 8080:80、--name web 都算一个要素；--detach 这类开关不要吃掉下一个参数。
      // 另外：下一个词如果是 URL/路径，它多半是这道题真正要考的目标（curl -v localhost:8088/x 里的接口，
      // 实测被 -v 吃成了 "-v localhost:8088/x" 一个要素），这种情况不要吞。
      const nextIsTarget = Boolean(next) && /\//.test(next) && targetOf(next) !== '';
      const takesValue = !nextIsTarget && (token.length <= 3 || /^--[a-z-]+$/.test(token));
      const value = token.indexOf('=') > -1 || !takesValue ? token : (next ? token + ' ' + next : token);
      flags.push({ token: value.trim(), presence: 'flag' });
    }
  }

  // 收尾去重：已经被别的要素覆盖的裸词不再单列（curl -X GET x 里的 GET 已算进 "-X GET"，
  // cargo build --features pcre2 里的 pcre2 已算进 "--features pcre2"）——
  // 否则同一个东西被数两遍：要素看着多了，实际没多判任何东西。
  const covered = function (token) {
    return flags.some(function (flag) { return flag.token.split(/\s+/).indexOf(token) > -1; });
  };
  const kept = [];
  words.forEach(function (word) {
    // minikube start 这种"子命令就是最后一个词"的，别数成两遍
    if (covered(word.token)) return;
    if (kept.some(function (row) { return row.token === word.token; })) return;
    kept.push(word);
  });
  return kept.concat(flags);
}

export function draftTask(entry, index) {
  const sub = entry.command.split(/\s+/)[1] || '';
  const hints = ruleHints(entry.command);
  // 规则锚在命令里真实出现的词（entry.word）；entry.tool 只是给人看的标签，
  // 分组标签（k8s / linux / netops…）拼出来的规则永远匹配不上。
  const require = [{ p: '^\\s*' + escapeRegex(entry.word || entry.tool.split(' ')[0]), tip: '应使用 ' + entry.tool }];
  hints.forEach(function (hint) {
    const pattern = escapeRegex(hint.token).replace(/\\ /g, '\\s+');
    if (require.some(function (rule) { return rule.p === pattern; })) return;
    require.push({ p: pattern, tip: '缺少 ' + hint.token });
  });

  // 只把"与这条命令相关"的危险写法带进 forbid；示例自身命中的危险写法会在复核清单里点名
  const related = DANGEROUS.filter(function (row) { return new RegExp(row.p, 'i').test(entry.command); });

  return {
    task: {
      id: 'draft.' + (entry.track || 'misc') + '.' + (slug(sub || entry.command.split(/\s+/)[0]) || ('cmd-' + index)),
      track: entry.track,
      title: '（草案）' + entry.command.slice(0, 40),
      goal: '按站内示例完成：' + entry.command,
      hint: '来自网站示例，请人工确认要素是否合理后改成自己的话',
      sample: entry.command,
      require: require,
      forbid: related.map(function (row) {
        return { p: row.p, tip: row.tip, severity: row.severity || 'warn' };
      }).filter(function (rule) { return !new RegExp(rule.p, 'i').test(entry.command); })
    },
    requireCount: require.length,
    forbidden: related.length
  };
}

// 主入口：文本（或 HTML）→ 草案包 + 复核清单
// 命令的"写法"：工具 + 子命令 + 用到哪些开关（值不算）。
// go build -tags=jsoniter 与 go build -tags=sonic 是同一个写法，
// kubectl create -f a.yaml 与 kubectl delete ns x 不是。
export function commandShape(command) {
  const tokens = String(command || '').trim().split(/\s+/);
  // 只有"裸词"才算子命令：curl "localhost:8085/x?y=1" 的第二个词是参数不是子命令，
  // 拿它当子命令会让三条同样的 curl 示例各自成一条草案（实测 gin 里就是 3 条）。
  const sub = isBareWord(tokens[1]) ? tokens[1] : '';
  const flags = tokens.slice(1)
    .filter(function (t) { return /^-{1,2}[a-zA-Z]/.test(t); })
    .map(function (t) { return t.split('=')[0]; })
    .sort();
  return [tokens[0] || ''].concat([sub], flags).join('|');
}

export function buildDraftPack(input, options) {
  const opts = options || {};
  const limit = opts.limit || 20;
  const source = opts.source || 'unknown';
  const raw = String(input || '');
  // HTML 输入只认代码块：文档页的导航里全是"docker build"这种碎片，混进来就全是废话题
  const blocks = raw.indexOf('<') > -1 ? htmlToCodeBlocks(raw) : [];
  const extraction = blocks.length ? 'code-blocks' : 'text-lines';
  // 同一写法的命令只留第一条：真仓库里常见 go build -tags=a / -tags=b / -tags=c 连着来，
  // 实测 gin 抓到 10 条里有 4 条是 go build -tags=<不同值>、ripgrep 有 3 条是 cargo install <不同包>。
  // 它们生成出来的题要素完全一样，占满 limit 名额还把复核清单淹了。先去重再截断，
  // 同样的名额能出更多**不同**的草案。
  const all = extractCommands(blocks.length ? blocks.join('\n') : raw);
  const shapes = new Set();
  const commands = [];
  all.forEach(function (entry) {
    const key = commandShape(entry.command);
    if (shapes.has(key)) return;
    shapes.add(key);
    commands.push(entry);
  });
  const collapsed = all.length - commands.length;
  const picked = commands.slice(0, limit);

  const tasks = [];
  const review = [];
  const seenIds = new Set();
  picked.forEach(function (entry, index) {
    const drafted = draftTask(entry, index);
    let id = drafted.task.id;
    if (seenIds.has(id)) id = id + '-' + index;
    seenIds.add(id);
    drafted.task.id = id;
    tasks.push(drafted.task);

    const warnings = [];
    if (drafted.requireCount <= 2) warnings.push('要素太少（只有工具名），可能是废话题');
    if (drafted.task.sample.length < 12) warnings.push('命令太短，不像完整示例');
    if (drafted.forbidden) warnings.push('示例本身命中了危险写法：确认真要把它当参考答案吗');
    review.push({ taskId: id, track: entry.track, command: drafted.task.sample, warnings: warnings });
  });

  // 包级 track 取出现最多的那个（题库校验要求包有轨道）；每道题自己还带着 track
  const tally = {};
  tasks.forEach(function (task) { tally[task.track] = (tally[task.track] || 0) + 1; });
  const dominant = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; })[0];

  const pack = {
    id: (opts.packId || ('site-' + slug(source).slice(0, 24) || 'site-draft')),
    name: '（草案）来自 ' + source + ' 的题库',
    track: dominant,
    version: 1,
    tasks: tasks
  };

  return {
    pack: pack,
    review: review,
    stats: {
      extraction: extraction,
      commands: commands.length,
      picked: picked.length,
      collapsed: collapsed,
      tasks: tasks.length,
      tracks: Array.from(new Set(tasks.map(function (t) { return t.track; }))),
      needsReview: review.filter(function (row) { return row.warnings.length; }).length
    },
    checklist: [
      '这些题是按来源里的命令示例自动生成的草案（网站文档或代码仓库都可能）：先把 goal / hint 改成自己的话，再入库。',
      '要素太少的题（只有工具名）建议删掉或补要素，否则学员随便敲一下就能满分。',
      '生成时只保留与命令本身相关的禁止项；丢失数据的写法要自己补 severity: block。',
      '入库前跑一次：node src/cli.mjs audit（参考答案必须自查满分、变体要有区分度）。'
    ]
  };
}

export function renderDraft(result) {
  const lines = [];
  lines.push('草案包：' + result.pack.id + '　' + result.stats.tasks + ' 道题（识别 ' + result.stats.commands + ' 条命令示例，来源：'
    + (result.stats.extraction === 'code-blocks' ? '页面代码块' : '正文行扫描') + '）');
  lines.push('涉及轨道：' + (result.stats.tracks.join('、') || '无'));
  lines.push('需要人工复核：' + result.stats.needsReview + ' 道');
  // 合并了多少条要写出来：否则用户看到"识别 10 条、出 6 道"会以为是漏抓
  if (result.stats.collapsed) {
    lines.push('同一写法的重复示例已合并 ' + result.stats.collapsed + ' 条（只留第一条；想要多条就照它改）');
  }
  lines.push('');
  result.review.slice(0, 12).forEach(function (row) {
    lines.push('  · [' + row.track + '] ' + row.taskId);
    lines.push('      ' + row.command);
    if (row.warnings.length) lines.push('      ⚠ ' + row.warnings.join('；'));
  });
  if (result.review.length > 12) lines.push('  …还有 ' + (result.review.length - 12) + ' 道，见 --out 输出的 JSON');
  lines.push('');
  lines.push('复核清单：');
  result.checklist.forEach(function (item) { lines.push('  - ' + item); });
  return lines.join('\n');
}

export function readSourceFile(file) {
  try {
    return { ok: true, text: readFileSync(String(file), 'utf8') };
  } catch (err) {
    return { ok: false, reason: '读取失败：' + err.message };
  }
}
