// 技术栈抽取：把 JD / 文档 / 截图里提到的技术栈按类别抽全，再映射到知识点与可练题。
//
// 为什么单独做：原来的技术栈是一个 60 词平表（STACK_WORDS），JD 里常见的 ArgoCD / GitLab CI /
// eBPF / ClickHouse / Istio 之类根本抽不到，用户看到的"技术栈"就不全面。这里改成分类词库 + 覆盖映射：
//   ① 分类抽全（语言 / 容器编排 / CI-CD / 监控 / IaC / 数据库 / 中间件 / 网关 / 网络排障 / 安全 / 云 / 数据 AI …）
//   ② 每个技术栈都标注：出现在哪一行（依据）、命中哪些知识点、可练多少题、**字典有没有覆盖**
//   ③ 没覆盖的单独列出来——这是"这个 JD 我该补题库"的信号，而不是悄悄丢掉
import { POINTS } from './knowledge.mjs';

export const CATEGORIES = [
  '语言', '操作系统与 Shell', '容器与编排', 'CI/CD 与版本控制', '监控与可观测', '配置与 IaC',
  '数据库与缓存', '中间件与消息', 'Web 与网关', '网络与排障', '安全', '云平台与虚拟化',
  '构建与测试', '数据与 AI', '其他工具'
];

// 词库：term 是规范名，aliases 是 JD 里可能出现的写法（大小写不敏感，短别名按词边界匹配）
export const STACK_LEXICON = [
  // ---- 语言 ----
  { category: '语言', term: 'Python', aliases: ['python', 'python3', 'py'] },
  { category: '语言', term: 'Go', aliases: ['golang', 'go '] },
  { category: '语言', term: 'Rust', aliases: ['rust'] },
  { category: '语言', term: 'Java', aliases: ['java', 'jdk', 'jvm'] },
  { category: '语言', term: 'C/C++', aliases: ['c++', 'cpp', 'c语言'] },
  { category: '语言', term: 'Shell', aliases: ['shell', 'bash', 'zsh', 'awk', 'sed', 'grep'] },
  { category: '语言', term: 'JavaScript/TypeScript', aliases: ['javascript', 'typescript', 'node.js', 'nodejs'] },
  { category: '语言', term: 'SQL', aliases: ['sql'] },
  { category: '语言', term: 'Lua', aliases: ['lua'] },
  { category: '语言', term: 'Scala', aliases: ['scala'] },

  // ---- 操作系统与 Shell ----
  { category: '操作系统与 Shell', term: 'Linux', aliases: ['linux', 'centos', 'ubuntu', 'debian', 'rocky', 'alpine', '内核'] },
  { category: '操作系统与 Shell', term: 'systemd', aliases: ['systemd', 'systemctl', 'journalctl', 'unit 文件'] },
  { category: '操作系统与 Shell', term: 'Windows Server', aliases: ['windows server', 'iis', 'powershell'] },
  { category: '操作系统与 Shell', term: '性能诊断', aliases: ['perf', '火焰图', 'strace', 'ltrace', 'top', 'vmstat', 'iostat', 'sar', '负载'] },
  { category: '操作系统与 Shell', term: '存储与文件系统', aliases: ['lvm', 'raid', 'nfs', 'xfs', 'ext4', 'inode', '磁盘'] },

  // ---- 容器与编排 ----
  { category: '容器与编排', term: 'Docker', aliases: ['docker', 'dockerfile', '容器镜像', 'buildkit'] },
  { category: '容器与编排', term: 'Docker Compose', aliases: ['compose', 'docker-compose'] },
  { category: '容器与编排', term: 'Kubernetes', aliases: ['kubernetes', 'k8s', 'kubectl'] },
  { category: '容器与编排', term: 'Helm', aliases: ['helm'] },
  { category: '容器与编排', term: 'Kustomize', aliases: ['kustomize'] },
  { category: '容器与编排', term: 'Istio/Service Mesh', aliases: ['istio', 'service mesh', 'linkerd', 'envoy'] },
  { category: '容器与编排', term: 'Harbor/镜像仓库', aliases: ['harbor', '镜像仓库', 'registry', 'nexus'] },
  { category: '容器与编排', term: 'containerd/CRI', aliases: ['containerd', 'cri-o', 'cri'] },

  // ---- CI/CD 与版本控制 ----
  { category: 'CI/CD 与版本控制', term: 'Git', aliases: ['git', 'gitlab', 'github', 'gitee', 'gerrit'] },
  { category: 'CI/CD 与版本控制', term: 'GitLab CI', aliases: ['gitlab ci', 'gitlab-ci', '.gitlab-ci.yml'] },
  { category: 'CI/CD 与版本控制', term: 'GitHub Actions', aliases: ['github actions', 'workflow'] },
  { category: 'CI/CD 与版本控制', term: 'Jenkins', aliases: ['jenkins', 'pipeline 脚本'] },
  { category: 'CI/CD 与版本控制', term: 'ArgoCD', aliases: ['argocd', 'argo'] },
  { category: 'CI/CD 与版本控制', term: '发布策略', aliases: ['滚动发布', '滚动更新', '蓝绿', '灰度', '金丝雀', 'canary', 'rollout'] },

  // ---- 监控与可观测 ----
  { category: '监控与可观测', term: 'Prometheus', aliases: ['prometheus', 'promql', 'promtool', 'exporter', '告警规则'] },
  { category: '监控与可观测', term: 'Grafana', aliases: ['grafana', '看板', 'dashboard'] },
  { category: '监控与可观测', term: 'Zabbix', aliases: ['zabbix'] },
  { category: '监控与可观测', term: 'ELK/EFK', aliases: ['elk', 'elasticsearch', 'logstash', 'kibana', 'fluentd', 'fluentbit'] },
  { category: '监控与可观测', term: 'Loki', aliases: ['loki', 'promtail'] },
  { category: '监控与可观测', term: '链路追踪', aliases: ['jaeger', 'skywalking', 'zipkin', 'tracing', '链路追踪', 'opentelemetry', 'otel'] },
  { category: '监控与可观测', term: 'eBPF', aliases: ['ebpf', 'bcc', 'bpftrace'] },
  { category: '监控与可观测', term: '值班与告警', aliases: ['on-call', 'oncall', '值班', '告警收敛', 'pagerduty', 'sls'] },

  // ---- 配置与 IaC ----
  { category: '配置与 IaC', term: 'Terraform', aliases: ['terraform', 'hcl'] },
  { category: '配置与 IaC', term: 'Ansible', aliases: ['ansible', 'playbook'] },
  { category: '配置与 IaC', term: 'Pulumi', aliases: ['pulumi'] },
  { category: '配置与 IaC', term: 'SaltStack', aliases: ['saltstack', 'salt'] },
  { category: '配置与 IaC', term: '配置中心', aliases: ['nacos', 'consul', 'apollo', 'etcd', 'zookeeper', '配置中心'] },

  // ---- 数据库与缓存 ----
  { category: '数据库与缓存', term: 'MySQL', aliases: ['mysql', 'mariadb', 'innodb'] },
  { category: '数据库与缓存', term: 'PostgreSQL', aliases: ['postgres', 'postgresql', 'pg'] },
  { category: '数据库与缓存', term: 'Redis', aliases: ['redis', '缓存击穿', '雪崩'] },
  { category: '数据库与缓存', term: 'MongoDB', aliases: ['mongodb', 'mongo'] },
  { category: '数据库与缓存', term: 'ClickHouse', aliases: ['clickhouse'] },
  { category: '数据库与缓存', term: 'TiDB/OceanBase', aliases: ['tidb', 'oceanbase', 'polardb', '分布式数据库'] },
  { category: '数据库与缓存', term: '备份与恢复', aliases: ['备份', '恢复', 'binlog', '主从', 'gtid', '慢查询'] },

  // ---- 中间件与消息 ----
  { category: '中间件与消息', term: 'Kafka', aliases: ['kafka', '消息队列'] },
  { category: '中间件与消息', term: 'RabbitMQ', aliases: ['rabbitmq'] },
  { category: '中间件与消息', term: 'RocketMQ', aliases: ['rocketmq'] },
  { category: '中间件与消息', term: 'NATS/Pulsar', aliases: ['nats', 'pulsar'] },
  { category: '中间件与消息', term: '任务调度', aliases: ['xxl-job', 'airflow', 'cron', '调度'] },

  // ---- Web 与网关 ----
  { category: 'Web 与网关', term: 'Nginx', aliases: ['nginx', '反向代理', 'upstream'] },
  { category: 'Web 与网关', term: 'Apache', aliases: ['apache', 'httpd'] },
  { category: 'Web 与网关', term: 'HAProxy/LVS', aliases: ['haproxy', 'lvs', 'keepalived', '负载均衡'] },
  { category: 'Web 与网关', term: 'API 网关', aliases: ['kong', 'apisix', 'spring cloud gateway', 'api 网关'] },
  { category: 'Web 与网关', term: 'Web 框架', aliases: ['django', 'flask', 'fastapi', 'spring boot', 'gin', 'fiber'] },

  // ---- 网络与排障 ----
  { category: '网络与排障', term: 'TCP/IP', aliases: ['tcp', 'udp', 'ip', '三次握手', 'mtu', '端口'] },
  { category: '网络与排障', term: 'DNS', aliases: ['dns', 'bind', '解析', 'coredns'] },
  { category: '网络与排障', term: '抓包分析', aliases: ['tcpdump', 'wireshark', 'tshark', '抓包'] },
  { category: '网络与排障', term: '防火墙与 NAT', aliases: ['iptables', 'nftables', 'firewalld', 'nat', '防火墙'] },
  { category: '网络与排障', term: 'HTTP/HTTPS', aliases: ['http', 'https', 'curl', '状态码', 'tls', 'ssl', '证书'] },
  { category: '网络与排障', term: 'VPN/专线', aliases: ['vpn', 'wireguard', 'openvpn', '专线', '隧道'] },
  { category: '网络与排障', term: '网络诊断工具', aliases: ['ping', 'traceroute', 'mtr', 'ss', 'netstat', 'nc', 'nmap', 'telnet'] },

  // ---- 安全 ----
  { category: '安全', term: 'SSH 与密钥', aliases: ['ssh', 'ssh-keygen', 'known_hosts', '密钥登录'] },
  { category: '安全', term: '权限与加固', aliases: ['sudo', 'rbac', '最小权限', '加固', '基线', '等保'] },
  { category: '安全', term: '漏洞与扫描', aliases: ['cve', '漏洞', '扫描', 'trivy', 'nessus', 'openscap'] },
  { category: '安全', term: '密钥与证书管理', aliases: ['vault', 'kms', 'tls 证书', 'sealed secret'] },
  { category: '安全', term: '审计与合规', aliases: ['审计', '合规', 'soc2', 'iso27001', '日志留存'] },

  // ---- 云平台与虚拟化 ----
  { category: '云平台与虚拟化', term: 'AWS', aliases: ['aws', 'ec2', 's3', 'eks'] },
  { category: '云平台与虚拟化', term: '阿里云', aliases: ['阿里云', 'aliyun', 'ack', 'slb', 'ecs'] },
  { category: '云平台与虚拟化', term: '腾讯云/华为云', aliases: ['腾讯云', '华为云', 'tke', 'cce'] },
  { category: '云平台与虚拟化', term: 'KVM/虚拟化', aliases: ['kvm', 'qemu', 'vmware', 'esxi', '虚拟化', 'openstack'] },
  { category: '云平台与虚拟化', term: '容器运行时安全', aliases: ['gvisor', 'kata', 'seccomp', 'apparmor'] },

  // ---- 构建与测试 ----
  { category: '构建与测试', term: '构建系统', aliases: ['cmake', 'make', 'makefile', 'bazel', 'gradle', 'maven', 'cargo', 'pip'] },
  { category: '构建与测试', term: '编译器与调试', aliases: ['gcc', 'clang', 'gdb', 'lldb', 'objdump', 'nm', 'readelf', 'otool', 'strip'] },
  { category: '构建与测试', term: '静态检查', aliases: ['shellcheck', 'pylint', 'golangci', 'sonarqube', 'eslint', '代码扫描'] },
  { category: '构建与测试', term: '测试与压测', aliases: ['单元测试', 'pytest', 'junit', 'jmeter', 'wrk', 'ab', 'locust', '压测', '混沌'] },

  // ---- 数据与 AI ----
  { category: '数据与 AI', term: '数据处理', aliases: ['numpy', 'pandas', 'spark', 'flink', 'etl', '数据管道', 'hive'] },
  { category: '数据与 AI', term: '深度学习框架', aliases: ['pytorch', 'tensorflow', 'onnx', 'tensorrt', '推理部署', '模型量化'] },
  { category: '数据与 AI', term: '视觉', aliases: ['opencv', 'yolo', '图像处理', '目标检测', 'ocr'] },
  { category: '数据与 AI', term: '向量与检索', aliases: ['faiss', 'milvus', '向量检索', 'rag', 'embedding'] },

  // ---- 其他工具 ----
  { category: '其他工具', term: '编辑器与终端', aliases: ['vim', 'neovim', 'tmux', 'screen', 'zsh'] },
  { category: '其他工具', term: '文档与协作', aliases: ['confluence', 'jira', 'markdown', '飞书', 'wiki'] },
  { category: '其他工具', term: '编排运维平台', aliases: ['rancher', 'kubesphere', '蓝鲸', 'salt-api'] },
  // ---- 下面这批是按 BOSS 真实岗位调研补的（2026-09-28，15 份西安/深圳 C++、内核、AI infra 岗位）----
  // 依据：survey --dir=docs/samples/boss 的热度排行，出现在多个岗位但词库原来抽不到的词。
  { category: '语言', term: 'C#', aliases: ['c#', '.net', 'dotnet', 'wpf'] },
  { category: '数据库与缓存', term: 'Oracle', aliases: ['oracle', 'pl/sql', 'rac'] },
  { category: '网络与排障', term: '网络编程', aliases: ['socket', 'epoll', 'select', 'io 多路复用', 'i/o 多路复用', '网络编程', 'socket 编程'] },
  { category: '操作系统与 Shell', term: '内核与驱动', aliases: ['内核开发', '内核模块', '驱动程序', '字符设备', '中断处理', '系统调用'] },
  { category: '操作系统与 Shell', term: '嵌入式与上位机', aliases: ['嵌入式', 'rtos', 'freertos', '单片机', 'arm', '上位机', '交叉编译'] },
  { category: '数据与 AI', term: 'AI Infra 与异构计算', aliases: ['ai infra', '异构计算', 'ai 算力', 'gpu 调度', 'gpu 资源', '显存', '大模型训练', '分布式训练', '混合精度', '大模型'] },
  // 编译栈这类需要厂商工具链，命令行无法稳定验证 —— 归到白名单（见 ANNOTATE_ONLY）
  { category: '数据与 AI', term: 'AI 编译与算子', aliases: ['算子', 'kernel 优化', '图编译', '训推', '推理优化', 'cann', 'tensorrt'] },
  { category: '数据与 AI', term: '国产 AI 芯片', aliases: ['昇腾', 'ascend', '鲲鹏', 'kunpeng', 'npu', '寒武纪', 'cann'] },
  { category: '构建与测试', term: '并行计算', aliases: ['cuda', 'mpi', 'openmp', 'omp', '多线程', '并行计算', 'simd', 'avx'] },
  { category: '构建与测试', term: '硬件与电路', aliases: ['fpga', 'cpld', 'pcb', '电源完整性', '信号完整性', '原理图', '电路设计', '模电', '数电'] },
  { category: '其他工具', term: 'AI 编程助手', aliases: ['copilot', 'cursor', 'claude code', 'ai 编程', '代码生成'] },
];

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 短别名（<4 字符或含非字母）按词边界匹配，避免 'go' 命中 'google'、'py' 命中 'python'
function aliasPattern(alias) {
  const raw = String(alias).trim();
  const escaped = escapeRegExp(raw);
  // http/https 必须排除 URL：实测整页文本里 "https://..." 会让 HTTP/HTTPS 命中 14/14 个岗位
  if (/^https?$/i.test(raw)) return new RegExp('(^|[^a-z0-9])' + escaped + '(?![a-z0-9:/])', 'i');
  if (/^[a-z0-9+#./ -]+$/i.test(raw) && raw.length >= 4) return new RegExp(escaped, 'i');
  return new RegExp('(^|[^a-z0-9+#])' + escaped + '($|[^a-z0-9+#])', 'i');
}

// OCR 常见混淆：只用于"匹配"，展示给用户的依据仍然是原文。
// 实测：截图里 GitLab CI 被识别成 GitLab Cl（大写 I 看成小写 l），技术栈就少了一项。
export const OCR_FIXES = [
  [/\bCl\/CD\b/g, 'CI/CD'],
  [/\b([A-Za-z]+)\s+Cl\b/g, '$1 CI'],
  [/\bCl\b/g, 'CI'],
  [/kubemetes/gi, 'kubernetes'],
  [/kubernet[eas]{1,2}s/gi, 'kubernetes'],
  [/promethues/gi, 'prometheus'],
  [/dockcr/gi, 'docker'],
  [/ngin[xk]/gi, 'nginx'],
  [/terraforrn/gi, 'terraform'],
  [/grafan[a-z]/gi, 'grafana']
];

export function normalizeForMatch(text) {
  let out = String(text || '');
  OCR_FIXES.forEach(function (pair) { out = out.replace(pair[0], pair[1]); });
  return out;
}

export function linesWith(lines, alias) {
  const pattern = aliasPattern(alias);
  return lines.filter(function (line) { return pattern.test(line) || pattern.test(normalizeForMatch(line)); }).slice(0, 3);
}

// 技术栈 → 知识点：先用知识点的 patterns 关键词对，再退回模块名相同
export function pointsForTerm(term, aliases, points) {
  const list = points || POINTS;
  const needles = [term].concat(aliases || []).map(function (item) { return String(item).toLowerCase().trim(); });
  return list.filter(function (point) {
    const haystack = (point.id + ' ' + point.name + ' ' + (point.patterns || []).join(' ') + ' ' + point.module).toLowerCase();
    return needles.some(function (needle) { return needle.length >= 2 && haystack.indexOf(needle) > -1; });
  });
}

export function extractStack(text, options) {
  const opts = options || {};
  const lines = String(text || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  const points = opts.points || POINTS;
  const taskIndex = opts.taskIndex || null;
  const rows = [];
  STACK_LEXICON.forEach(function (entry) {
    const evidence = [];
    entry.aliases.forEach(function (alias) {
      linesWith(lines, alias).forEach(function (line) { if (evidence.indexOf(line) === -1) evidence.push(line); });
    });
    if (!evidence.length) return;
    const matched = pointsForTerm(entry.term, entry.aliases, points);
    const pointIds = matched.map(function (point) { return point.id; });
    const taskIds = [];
    matched.forEach(function (point) {
      (point.tasks || []).forEach(function (id) { if (taskIds.indexOf(id) === -1) taskIds.push(id); });
    });
    const playable = taskIndex ? taskIds.filter(function (id) { return taskIndex.has(id); }) : taskIds;
    rows.push({
      category: entry.category,
      term: entry.term,
      aliases: entry.aliases,
      evidence: evidence,
      points: pointIds,
      pointNames: matched.map(function (point) { return point.name; }),
      tasks: playable,
      covered: pointIds.length > 0
    });
  });
  return rows;
}

export function stackReport(rows, options) {
  const opts = options || {};
  const categories = [];
  rows.forEach(function (row) {
    let bucket = categories.filter(function (item) { return item.name === row.category; })[0];
    if (!bucket) { bucket = { name: row.category, items: [] }; categories.push(bucket); }
    bucket.items.push(row);
  });
  // 类别顺序按词表定义来，别按命中顺序（JD 里先提什么就排前面会很乱）
  categories.sort(function (a, b) { return CATEGORIES.indexOf(a.name) - CATEGORIES.indexOf(b.name); });
  // 未覆盖里再分两类：该补题（真缺口）与只调研不出题（白名单，带原因）
  rows.forEach(function (row) {
    const note = annotateOnlyFor(row.term);
    if (note) { row.annotateOnly = true; row.annotateReason = note.reason; row.annotateSuggestion = note.suggestion || ''; }
  });
  const uncovered = rows.filter(function (row) { return !row.covered && !row.annotateOnly; });
  const annotated = rows.filter(function (row) { return row.annotateOnly; });
  const covered = rows.filter(function (row) { return row.covered; });
  const taskIds = [];
  rows.forEach(function (row) { row.tasks.forEach(function (id) { if (taskIds.indexOf(id) === -1) taskIds.push(id); }); });
  return {
    categories: categories,
    rows: rows,
    covered: covered,
    uncovered: uncovered,
    annotated: annotated,
    tasks: taskIds,
    stats: {
      terms: rows.length,
      categories: categories.length,
      covered: covered.length,
      uncovered: uncovered.length,
      annotated: annotated.length,
      points: rows.reduce(function (set, row) { row.points.forEach(function (id) { set.add(id); }); return set; }, new Set()).size,
      tasks: taskIds.length
    }
  };
}

// 「只调研不出题」白名单：有些技术栈**故意不出题**——不是忘了，是本机命令行练不了。
//
// 为什么需要它：调研报告里"未覆盖"会一直挂着这些词（硬件要开发板与示波器、云控制台要真账号、
// 专用 AI 芯片要昇腾/寒武纪环境），混在"该补题"里会让缺口清单永远清不干净，也让人误以为软件有遗漏。
// 这里显式登记：每个条目必须写清**为什么只能标注**，报告里分开呈现（该补题 / 只标注）。
export const ANNOTATE_ONLY = [
  {
    term: 'AI 编译与算子',
    reason: '需要厂商编译栈（如 CANN / TensorRT）与对应硬件才能验证，命令行里跑不出可判定的结果；能练的是容器与调度侧（见 ai.infra / ai.schedule 题）',
    suggestion: '把调度与排障练熟（GPU 容量、标签污点、OOM、rank），算子与图编译留到有设备的环境里做实验'
  },
  {
    term: '硬件与电路',
    reason: '需要实物（开发板 / 示波器 / 电源），命令行练习覆盖不到；能覆盖的部分已归到 c 与 embedded 轨',
    suggestion: '面试前按 JD 准备原理图与信号完整性的口述，或用仿真软件单独练'
  },
  {
    term: '国产 AI 芯片',
    reason: '需要昇腾 / 寒武纪等专用硬件与 CANN 工具链，本机没有对应设备',
    suggestion: '能覆盖的算子/调度部分走 k8s 与容器题；芯片亲和性只能在有设备的环境练'
  },
  {
    term: '腾讯云/华为云',
    reason: '需要真实云账号与控制台（计费、权限、配额），不适合做成本地可验证练习',
    suggestion: '用 CLI 侧能练的替代：k8s 与容器题覆盖 TKE/CCE 的日常操作'
  },
  {
    term: 'AI 编程助手',
    reason: '属于工具偏好而非可验证技能（同一任务换工具结果等价），出题无法稳定判定',
    suggestion: '把它当效率选项，不作为学习目标'
  }
];

// 查一个技术栈是否在白名单里（按 term 匹配；大小写与空格无关）
export function annotateOnlyFor(term) {
  const key = String(term || '').trim().toLowerCase();
  return ANNOTATE_ONLY.filter(function (row) { return row.term.toLowerCase() === key; })[0] || null;
}
