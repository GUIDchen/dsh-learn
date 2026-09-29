// 只读执行器：默认不跑任何命令；只有显式 run 且通过白名单才真正执行。
// 白名单是唯一的安全边界，所以它必须是静态可审计的。
import { spawn } from 'node:child_process';

// 白名单：安全边界只有这一处，所以每条都带 id / 归属 / 示例，便于审计与对账。
// 题库里声明的 verify 命令必须落在这些条目里；反过来，没人用的条目应该被删掉（见 auditWhitelist）。
export const ALLOWLIST = [
  { id: 'uname', family: '平台探测', p: /^uname(\s+-[a-z]+)*$/, examples: ['uname -s'] },
  { id: 'sw_vers', family: '平台探测', p: /^sw_vers(\s+-\w+)?$/, examples: ['sw_vers -productVersion'] },
  { id: 'node-version', family: '平台探测', p: /^node\s+-v$/, examples: ['node -v'] },
  { id: 'git-version', family: '工具版本', p: /^git\s+--version$/, examples: ['git --version'] },
  // 二进制工具的前置检查：只打印版本，不读也不改任何东西（题库里 c-binary 包的只读验证项要用）
  // 只收新引入的二进制工具：gcc/clang 已有 gcc-version 条目，重叠会让对账把那条报成"闲置"
  { id: 'nm-version', family: '工具版本', p: /^(nm|size|strings|otool|readelf|ldd)(\s+--version|\s+-v)?$/, examples: ['nm --version', 'size --version'] },
  { id: 'date', family: '平台探测', p: /^date(\s+[-+][0-9a-zA-Z%:'\/+ -]*)*$/, examples: ["date -v+1d '+%Y-%m-%d'"] },
  { id: 'docker-version', family: 'Docker 只读', p: /^docker\s+version(\s+--format\s+\{\{[^}]*\}\})?$/, examples: ['docker version', "docker version --format {{.Server.Version}}"] },
  { id: 'docker-context-ls', family: 'Docker 只读', p: /^docker\s+context\s+ls$/, examples: ['docker context ls'] },
  { id: 'docker-info', family: 'Docker 只读', p: /^docker\s+info$/, examples: ['docker info'] },
  { id: 'docker-ps', family: 'Docker 只读', p: /^docker\s+ps(\s+-a)?$/, examples: ['docker ps', 'docker ps -a'] },
  { id: 'docker-volume-ls', family: 'Docker 只读', p: /^docker\s+volume\s+ls$/, examples: ['docker volume ls'] },
  { id: 'docker-network-ls', family: 'Docker 只读', p: /^docker\s+network\s+ls$/, examples: ['docker network ls'] },
  { id: 'kubectl-version', family: 'kubectl 只读', p: /^kubectl\s+version(\s+--client)?(\s+-o\s+json)?$/, examples: ['kubectl version --client'] },
  { id: 'kubectl-config', family: 'kubectl 只读', p: /^kubectl\s+config\s+(current-context|get-contexts)$/, examples: ['kubectl config get-contexts'] },
  { id: 'kubectl-get', family: 'kubectl 只读', p: /^kubectl\s+get\s+(ns|namespaces|pods|po|nodes|no)(\s+(-A|--all-namespaces))?(\s+-o\s+(wide|json|name))?$/, examples: ['kubectl get ns', 'kubectl get pods -A -o wide'] },
  // 受限压测：只允许打本机回环的 /health，且请求数与并发数写死上限。
  // 压测题要能"真跑一次"才有意义，但白名单不能变成任意流量的出口——上限就是这条的边界。
  { id: 'ab-bounded', family: '受限压测', p: /^ab\s+-n\s+([1-9]|[1-9][0-9]|1[0-9]{2}|200)\s+-c\s+([1-9]|1[0-9]|20)\s+http:\/\/127\.0\.0\.1:\d{2,5}\/health$/, examples: ['ab -n 50 -c 5 http://127.0.0.1:8899/health'] },
  { id: 'wrk-version', family: '受限压测', p: /^wrk\s+--version$/, examples: ['wrk --version'] },
  // 工具就绪检查：题目绑定它们做"前置检查"，让每个轨道都至少有一条可执行的 verify
  { id: 'python-version', family: '工具版本', p: /^python3\s+--version$/, examples: ['python3 --version'] },
  { id: 'gcc-version', family: '工具版本', p: /^gcc\s+--version$/, examples: ['gcc --version'] },
  { id: 'gpp-version', family: '工具版本', p: /^g\+\+\s+--version$/, examples: ['g++ --version'] },
  { id: 'bash-version', family: '工具版本', p: /^bash\s+--version$/, examples: ['bash --version'] },
  { id: 'curl-version', family: '工具版本', p: /^curl\s+--version$/, examples: ['curl --version'] },
  { id: 'ffmpeg-version', family: '工具版本', p: /^ffmpeg\s+-version$/, examples: ['ffmpeg -version'] },
  { id: 'redis-cli-version', family: '工具版本', p: /^redis-cli\s+--version$/, examples: ['redis-cli --version'] },
  { id: 'go-version', family: '工具版本', p: /^go\s+version$/, examples: ['go version'] },
  { id: 'cargo-version', family: '工具版本', p: /^cargo\s+--version$/, examples: ['cargo --version'] },
  { id: 'tcpdump-version', family: '工具版本', p: /^tcpdump\s+--version$/, examples: ['tcpdump --version'] },
  // Windows 轨的前置检查：题目本身只在 win32 上成立，先确认"对端是不是真的 Windows"。
  // 非 Windows 主机上这条会如实报"命令不存在"（不假装验证过）——cmd /c ver 里没有任何 shell 元字符。
  { id: 'cmd-ver', family: '平台探测', p: /^cmd\s+\/c\s+ver$/, examples: ['cmd /c ver'] }
];

// 工具自己内部会跑的只读命令（probe 探测、容器后端探测探针、测试里的跨平台样例）。
// 审计时它们也算"有人用"，否则会被误判成可删除的条目。
export const SYSTEM_USES = [
  { cmd: 'uname -s', usedBy: 'probe 平台探测' },
  { cmd: 'sw_vers -productVersion', usedBy: 'probe macOS 版本' },
  { cmd: 'docker version', usedBy: 'probe Docker 版本' },
  { cmd: 'docker context ls', usedBy: 'probe Docker 上下文' },
  { cmd: 'docker info', usedBy: '容器后端守护进程探测' },
  { cmd: 'node -v', usedBy: '测试里的跨平台验证样例' }
];

// 这些命令必须永远被拒绝：白名单被改宽时，测试与 security whitelist 会立刻报警。
export const MUST_STAY_BLOCKED = [
  'rm -rf /',
  'docker volume rm redis-data',
  'docker system prune --volumes',
  'docker image rm nginx',
  'git push --force origin main',
  'kubectl delete pod web-0',
  'kubectl apply -f deploy.yaml',
  'sh -c echo hi',
  'docker ps && rm -rf /',
  'echo hi > /tmp/x'
];

const SHELL_META = /[\n;&|><$]/;

// 常见失败的"人话解释"：学习者看到的不该只是一句英文报错。
// 顺序即优先级，命中第一条就返回。
const DIAGNOSES = [
  {
    p: /connection refused|The connection to the server .* was refused|couldn't get current server API group list|context deadline exceeded .*6443/i,
    advice: 'kubectl 连不上集群：先用 kubectl config get-contexts 看当前上下文，再确认集群本身（Rancher Desktop / kind / k3s）是否已启动'
  },
  {
    p: /no configuration has been provided|current-context is not set|no context exists/i,
    advice: '没有可用的 kubeconfig 上下文：用 kubectl config get-contexts 查看，或用 KUBECONFIG 指定配置文件'
  },
  {
    p: /failed to connect to the docker API|Cannot connect to the Docker daemon|Is the docker daemon running/i,
    advice: 'Docker 守护进程没在运行：macOS 上启动 Docker Desktop / OrbStack，Linux 上 sudo systemctl start docker'
  },
  {
    p: /Unable to find image|pull access denied|manifest unknown|no matching manifest/i,
    advice: '镜像不可用：先 docker pull 该镜像，或用 --image 指定本机已有的镜像'
  },
  {
    p: /command not found|not recognized as an internal or external command|No such file or directory|executable file not found/i,
    advice: '这台机器没有这个命令：换用平台等价的工具（macOS 是 BSD 工具链，Linux 是 GNU 工具链）'
  },
  {
    p: /forbidden|Unauthorized|prohibited by pod security/i,
    advice: '权限不足：确认 kubeconfig 里的凭据与 RBAC 是否允许这个只读操作'
  }
];

// cmd 可选：同一个报错在不同命令下的"人话"不一样（连接被拒在 kubectl 下是集群没起，
// 在压测/抓包类命令下是目标没在监听）。
const TARGET_REFUSED = /apr_socket_recv: Connection refused|Failed to connect to .* port \d+|curl: \(7\)/i;

export function diagnoseOutput(output, cmd) {
  const text = String(output || '');
  const command = String(cmd || '');
  if (TARGET_REFUSED.test(text) && !/^\s*kubectl\b/.test(command)) {
    return '目标端口没在监听：确认被测服务/靶机已启动（本项目可用 bash scripts/lab.sh up 起压测靶机 http://127.0.0.1:8899/health）';
  }
  for (let i = 0; i < DIAGNOSES.length; i += 1) {
    if (DIAGNOSES[i].p.test(text)) return DIAGNOSES[i].advice;
  }
  return null;
}

// 退出码 0 不等于成功：kubectl 连不上集群时就是"退出码 0 + 满屏错误"。
// 所以判成功要同时看退出码与输出里有没有已知的失败特征。
export function assessOutput(exitCode, output, cmd) {
  const advice = diagnoseOutput(output, cmd);
  if (exitCode === null || exitCode === undefined) {
    return {
      ok: false,
      advice: advice || undefined,
      reason: '命令没有正常退出（超时或被信号终止）' + (advice ? '　排查建议：' + advice : '')
    };
  }
  if (exitCode !== 0) {
    return {
      ok: false,
      advice: advice || undefined,
      reason: '命令非零退出（exit ' + exitCode + '）' + (advice ? '　排查建议：' + advice : '')
    };
  }
  if (advice) {
    return {
      ok: false,
      advice: advice,
      reason: '命令退出码是 0，但输出里是错误信息' + '　排查建议：' + advice
    };
  }
  return { ok: true, advice: undefined, reason: '命令执行成功' };
}

// 命中哪一条白名单（没命中返回 null）。审计与诊断都用它，避免各处重新实现匹配。
export function matchWhitelistEntry(cmd) {
  const text = String(cmd || '').trim();
  if (!text) return null;
  return ALLOWLIST.filter(function (entry) { return entry.p.test(text); })[0] || null;
}

export function whitelistEntries() {
  return ALLOWLIST.map(function (entry) {
    return { id: entry.id, family: entry.family, pattern: String(entry.p), examples: entry.examples.slice() };
  });
}

// 白名单与题库对账：既要保证题库声明的每条 verify 都能跑，也要保证没人用的条目被发现。
// 这是把"手写白名单"从一次性劳动变成可持续维护的关键一步。
export function auditWhitelist(tasks) {
  const list = tasks || [];
  const used = new Map();
  const declared = [];
  const blocked = [];
  const tasksWithoutVerify = [];

  list.forEach(function (task) {
    const specs = [];
    if (task.verify) specs.push({ where: task.id, spec: task.verify });
    Object.keys(task.variants || {}).forEach(function (platform) {
      if (task.variants[platform].verify) specs.push({ where: task.id + '/' + platform, spec: task.variants[platform].verify });
    });
    if (!specs.length) tasksWithoutVerify.push(task.id);
    specs.forEach(function (item) {
      const entry = matchWhitelistEntry(item.spec.cmd);
      if (!entry) {
        blocked.push({ taskId: item.where, cmd: item.spec.cmd, reason: '题库声明的验证命令不在白名单内，学员永远跑不了' });
        return;
      }
      if (!used.has(entry.id)) used.set(entry.id, []);
      used.get(entry.id).push(item.where);
      declared.push({ taskId: item.where, cmd: item.spec.cmd, entry: entry.id });
    });
  });

  const systemUses = new Map();
  SYSTEM_USES.forEach(function (item) {
    const entry = matchWhitelistEntry(item.cmd);
    if (!entry) {
      blocked.push({ taskId: '(工具内部)', cmd: item.cmd, reason: '工具自己要用这条命令，但白名单里没有' });
      return;
    }
    if (!systemUses.has(entry.id)) systemUses.set(entry.id, []);
    systemUses.get(entry.id).push(item.usedBy);
  });

  const entries = whitelistEntries().map(function (entry) {
    const fromTasks = used.get(entry.id) || [];
    const fromSystem = systemUses.get(entry.id) || [];
    return Object.assign({}, entry, {
      usedBy: fromTasks,
      usedBySystem: fromSystem,
      used: fromTasks.length + fromSystem.length > 0
    });
  });

  const stillBlocked = MUST_STAY_BLOCKED.map(function (cmd) {
    return { cmd: cmd, blocked: !isAllowed(cmd) };
  });
  const leaked = stillBlocked.filter(function (row) { return !row.blocked; });

  return {
    entries: entries,
    unused: entries.filter(function (entry) { return !entry.used; }).map(function (entry) { return entry.id; }),
    systemUses: SYSTEM_USES.map(function (item) { return item.cmd + '（' + item.usedBy + '）'; }),
    declared: declared,
    blocked: blocked,
    tasksWithoutVerify: tasksWithoutVerify,
    mustStayBlocked: stillBlocked,
    leaked: leaked,
    ok: blocked.length === 0 && leaked.length === 0
  };
}

export function isAllowed(cmd) {
  const text = String(cmd || '').trim();
  if (!text) return false;
  if (SHELL_META.test(text)) return false;
  if (text.indexOf(String.fromCharCode(96)) > -1) return false;
  return Boolean(matchWhitelistEntry(text));
}

// 输出上限：只读命令的输出不会这么大，超过就是命令失控了，截断并终止。
// 可通过 options.maxOutput 覆盖，测试用它覆盖"输出失控"这条路径。
export const MAX_OUTPUT = 65536;

// 一次带走整个进程组：命令用 shell 包装跑（要支持管道），少杀一层就会留下握着管道的孙进程
function killGroup(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (err) {
    try { child.kill('SIGKILL'); } catch (err2) { /* 已经自己退出了 */ }
  }
}

// 异步 + 独立进程组执行。为什么不用 spawnSync：
// ① spawnSync 超时只杀直接子进程，被 shell 包住的 docker/kubectl 会活下来并继续握着输出管道，
//    spawnSync 于是永远等不到管道关闭（实测 docker info 挂死 15 分钟，整个 CLI 一起卡住）；
// ② 杀掉整个进程组才有"超时就是超时"。
// 调用方基本都是 async，返回值改为 Promise（dry-run 与白名单拒绝直接 resolve）。
export function runReadonlyCommand(cmd, options) {
  const opts = options || {};
  const text = String(cmd || '').trim();
  if (!opts.run) {
    return Promise.resolve({ ok: false, ran: false, dryRun: true, cmd: text, reason: '默认不执行命令；加 --run 或勾选"真实执行"才会运行只读命令' });
  }
  if (!isAllowed(text)) {
    return Promise.resolve({ ok: false, ran: false, cmd: text, reason: '该命令不在只读白名单内，已拒绝执行' });
  }
  const timeoutMs = opts.timeout || 10000;
  const maxOutput = opts.maxOutput || MAX_OUTPUT;
  return new Promise(function (resolve) {
    const child = spawn(text, { shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    let timedOut = false;
    let overflow = false;
    const timer = setTimeout(function () {
      timedOut = true;
      killGroup(child);
    }, timeoutMs);

    function collect(chunk) {
      if (buffer.length >= maxOutput) return;
      buffer += chunk.toString('utf8');
      if (buffer.length >= maxOutput) {
        overflow = true;
        killGroup(child);
      }
    }
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    child.on('error', function (err) {
      clearTimeout(timer);
      resolve({ ok: false, ran: false, cmd: text, reason: '命令无法启动：' + err.message });
    });

    // close 而不是 exit：要等 stdio 也关掉，否则输出会被截断
    child.on('close', function (code, signal) {
      clearTimeout(timer);
      const output = buffer.trim();
      if (timedOut) {
        resolve({
          ok: false,
          ran: true,
          cmd: text,
          exitCode: null,
          timedOut: true,
          signal: signal || undefined,
          output: output.slice(0, 4000),
          reason: '命令超时：超过 ' + timeoutMs + 'ms 仍未结束，已终止（换用更快的只读命令，或调大 timeout）'
        });
        return;
      }
      if (overflow) {
        resolve({
          ok: false,
          ran: true,
          cmd: text,
          exitCode: null,
          output: output.slice(0, 4000),
          reason: '输出超过 ' + maxOutput + ' 字节，已截断并终止命令（只读命令不该产生这么大的输出）'
        });
        return;
      }
      const verdict = assessOutput(code, output, text);
      resolve({
        ok: verdict.ok,
        ran: true,
        cmd: text,
        exitCode: code,
        output: output.slice(0, 4000),
        advice: verdict.advice,
        reason: verdict.reason
      });
    });
  });
}

export async function runVerify(task, options) {
  const opts = options || {};
  const spec = task && task.verify;
  if (!spec) {
    return { ok: false, ran: false, reason: '该题没有可执行的验证项，按评测分判定即可' };
  }
  const result = await runReadonlyCommand(spec.cmd, { run: opts.run, timeout: opts.timeout });
  if (!result.ran) {
    return Object.assign({}, result, { expect: spec.expect, note: spec.note || '' });
  }
  // 超时/启动失败时不要再拿"输出未匹配"覆盖掉真正的原因（否则学员看不到"超时"这两个字）
  if (result.timedOut || result.exitCode === null) {
    return Object.assign({}, result, { expect: spec.expect, note: spec.note || '', matched: false });
  }
  const matched = new RegExp(spec.expect, 'i').test(result.output);
  return Object.assign({}, result, {
    ok: result.ok && matched,
    expect: spec.expect,
    note: spec.note || '',
    matched,
    reason: matched ? '输出符合预期：' + spec.expect : '输出未匹配预期 ' + spec.expect + '，先确认环境是否就绪'
  });
}

// 执行型判定：把**学员的答案**也真跑一遍（只读白名单内才跑）。
//
// 与 runVerify 的区别：runVerify 跑的是题目自带的"验证探针"；这个跑的是学员写的那条命令，
// 目的是把判定从"写法对"推进到"真能跑"。安全边界完全复用只读白名单：
//   · 不在白名单 → 拒绝执行，并如实说明原因（不假装跑过）；
//   · 含管道 / 重定向 / 命令替换 → isAllowed 直接否掉；
//   · 输出有上限，超了就截断终止。
export async function assessAnswer(task, answer, options) {
  const opts = options || {};
  const text = String(answer || '').trim();
  if (!text) return { allowed: false, ran: false, cmd: '', reason: '没有答案可执行' };
  if (!isAllowed(text)) {
    return {
      allowed: false,
      ran: false,
      cmd: text,
      reason: '不在只读白名单内：只执行经过审计的只读命令（管道、重定向、命令替换一律拒绝）'
    };
  }
  const result = await runReadonlyCommand(text, { run: opts.run !== false, timeout: opts.timeout });
  return Object.assign({ allowed: true, taskId: task && task.id ? task.id : '' }, result);
}
