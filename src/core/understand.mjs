// 文字描述理解：把一段自由文本（JD / 项目文档 / 随手笔记）读成**结构化信息**。
//
// 为什么需要它：知识点匹配只能回答"涉及哪些知识"，但流程要往下走就必须知道
// "这是什么、什么岗位、哪些是硬要求、哪些是加分项、职责是什么"——简历、岗位推荐、
// 项目生成都要用这几项。规则化实现（关键词 + 分档 + 证据），不用模型也能解释每一条判断。
import { analyzeText } from './knowledge.mjs';
import { TASKS } from './tasks.mjs';

const MUST_WORDS = ['熟悉', '掌握', '精通', '深入理解', '要求', '具备', '扎实'];
const NICE_WORDS = ['了解', '加分', '优先', '有加分', 'nice to have', 'bonus', '有经验优先', '有…经验优先'];
const SENIOR_WORDS = [
  { level: '应届/实习', p: /应届|实习|在校|毕业生/ },
  { level: '初级', p: /初级|junior|1\s*-\s*3\s*年|一年/ },
  { level: '中级', p: /中级|3\s*-\s*5\s*年|三年/ },
  { level: '高级', p: /高级|senior|5\s*年|五年|资深/ },
  { level: '专家', p: /专家|架构师|principal|tech\s*lead|技术负责人/ }
];
const POSITION_HINT = /(工程师|开发|研发|运维|测试|架构|算法|数据|前端|后端|全栈|安全|SRE|DevOps|实习生|经理|主管|专家)/i;
const SECTION_HEADS = [
  { id: 'responsibility', p: /^(岗位职责|工作职责|职责描述|工作内容|你要做什么|你的工作)/ },
  { id: 'requirement', p: /^(任职要求|岗位要求|职位要求|技能要求|我们期待|任职资格|要求)/ },
  { id: 'bonus', p: /^(加分项|加分|优先考虑|nice\s*to\s*have)/ },
  { id: 'about', p: /^(团队|团队介绍|我们是谁|关于我们|公司介绍|福利)/ }
];
const STACK_WORDS = ['kubernetes', 'k8s', 'docker', 'compose', 'python', 'golang', 'go ', 'rust', 'java', 'c++', 'linux', 'shell', 'bash',
  'mysql', 'postgres', 'postgresql', 'redis', 'kafka', 'rabbitmq', 'elasticsearch', 'mongodb',
  'prometheus', 'grafana', 'zabbix', 'elk', 'loki', 'terraform', 'ansible', 'jenkins', 'gitlab', 'github actions', 'argocd',
  'nginx', 'haproxy', 'tcpdump', 'wireshark', 'iptables', 'systemd', 'nginx', 'fastapi', 'django', 'flask', 'pytorch', 'tensorflow',
  'yolo', 'opencv', 'numpy', 'pandas', 'cmake', 'make', 'gcc', 'clang', 'gdb', 'node', 'typescript', 'react', 'vue', 'aws', 'azure', 'gcp'];

function cleanLines(text) {
  return String(text || '')
    .split('\n')
    .map(function (line) { return line.replace(/[\t\u00a0]+/g, ' ').replace(/^[\s•\-*·]+/, '').trim(); })
    .filter(Boolean);
}

// 公司名/岗位名后面常跟「·」「-」「|」这类分隔符，取出来要清掉，否则会变成「某某科技 ·」
function tidy(text) {
  // 先折成一行：岗位名/公司名跨行会污染标题（实测「岗位职责」这行被当成岗位名，材料标题成了「某某科技 · 职责」）
  const flat = String(text || '').split(/[\r\n]+/)[0].replace(/\s+/g, ' ').trim();
  return flat.replace(/[·•\-|,，;；:：\s]+$/, '').replace(/^[·•\-|,，;；:：\s]+/, '').trim().slice(0, 60);
}

function pick(lines, patterns) {
  for (const line of lines) {
    for (const p of patterns) {
      const hit = line.match(p);
      if (hit) return tidy(hit[1] || line);
    }
  }
  return '';
}

// 分档：一行同时命中硬要求与加分项时，按"加分项"算（先松后紧，避免把加分项当硬要求）
// 没有「岗位：」标签时，从正文里挑"像标题"的那一行：短、没有职责动词、不是分段小标题。
// 实测：不做这个过滤时，"岗位职责" 后面的 "负责集群运维" 会被当成岗位名（它含"运维"两个字）。
function pickPositionTitle(lines) {
  const RESP_VERB = /^(负责|参与|协助|完成|支持|维护|推动|承担|制定|推进|对接|管理)/;
  for (const line of lines) {
    if (line.length > 20) continue;
    if (RESP_VERB.test(line)) continue;
    if (SECTION_HEADS.some(function (head) { return head.p.test(line); })) continue;
    if (POSITION_HINT.test(line)) return tidy(line);
  }
  return '';
}

function gradeLine(line) {
  const nice = NICE_WORDS.filter(function (word) { return line.indexOf(word) > -1; });
  if (nice.length) return { level: 'nice', evidence: nice[0] };
  const must = MUST_WORDS.filter(function (word) { return line.indexOf(word) > -1; });
  if (must.length) return { level: 'must', evidence: must[0] };
  return null;
}

export function understandText(text, options) {
  const opts = options || {};
  const raw = String(text || '');
  const lines = cleanLines(raw);
  const report = analyzeText(raw, { limit: Math.max(1, Math.min(100, Number(opts.limit) || 20)) });
  const why = [];

  // 1) 这是什么：有职责/要求分段或硬要求词 → JD；有命令块 → 文档；其余当笔记
  const hasSection = lines.some(function (line) { return SECTION_HEADS.some(function (head) { return head.p.test(line); }); });
  // 小标题本身不参与分档："任职要求"里带"要求"两个字，不排掉就会被当成一条硬要求
  const isHead = function (line) { return SECTION_HEADS.some(function (head) { return head.p.test(line); }); };
  const graded = lines
    .filter(function (line) { return !isHead(line); })
    .map(function (line) { return { line: line, grade: gradeLine(line) }; })
    .filter(function (row) { return row.grade; });
  // JD 与文档的区分靠三条一起看（实测：Kubernetes 文档页会被误判成 JD，因为文档里也有"熟悉/了解"这类词）：
  //   ① 有招聘语境：出现 招聘 / 岗位 / 职位 / 应聘 / 任职 这些词，或标题里有岗位词
  //   ② 有 JD 结构：职责/要求/加分分段，或两行以上"熟悉/了解"类词
  //   ③ 不是命令堆：三行以上以命令开头的行（kubectl/docker/git…）当技术文档
  const commandLines = lines.filter(function (line) { return /^(kubectl|docker|git|npm|pip|go|cargo|make|helm|ansible|systemctl|journalctl|tar|find|grep|awk|sed)\s+\S/.test(line); }).length;
  const hiring = /(招聘|诚聘|应聘|岗位|职位|任职|薪资|工作地点|投递)/.test(raw) || POSITION_HINT.test(lines[0] || '');
  const structured = hasSection || graded.length >= 2;
  let kind = 'notes';
  if (structured && hiring && commandLines <= 1) kind = 'jd';
  else if (commandLines >= 2 || /^\s*(\$|#)\s*\w/m.test(raw)) kind = 'doc';
  else if (structured) kind = 'doc';
  const kindWhy = kind === 'jd'
    ? ('有 JD 结构（' + (hasSection ? '职责/要求分段' : graded.length + ' 行要求词') + '）+ 招聘语境，且命令行只有 ' + commandLines + ' 行')
    : (kind === 'doc' ? ('按技术文档处理：命令行 ' + commandLines + ' 行' + (structured ? '（虽然有要求词，但没有招聘语境）' : '')) : '没看到 JD 结构');
  why.push({ field: 'kind', value: kind, evidence: kindWhy });

  // 2) 分段：职责 / 要求 / 加分 / 团队
  const sections = { responsibility: [], requirement: [], bonus: [], about: [], other: [] };
  let current = 'other';
  lines.forEach(function (line) {
    const head = SECTION_HEADS.filter(function (row) { return row.p.test(line); })[0];
    if (head) { current = head.id; return; }
    sections[current].push(line);
  });
  why.push({ field: 'sections', value: Object.keys(sections).filter(function (key) { return sections[key].length; }), evidence: '按小标题切分：' + Object.keys(sections).map(function (key) { return key + ' ' + sections[key].length; }).join(' / ') });

  // 3) 公司 / 岗位 / 级别。第一行常见「公司 招聘 岗位」结构，先按它拆，拆不出来再各自匹配。
  const firstRow = (lines[0] || '').match(/^(.{2,20}?)[\s·|,，-]*(?:招聘|诚聘|招募)[\s·|,，-]*(.{2,30})$/);
  // 注意：文件头是「公司：X　城市：Y　薪资：Z」这种一行多字段结构，
  // 所以标签值只能取到分隔符（全角空格/竖线/逗号）为止，否则会把后面几个字段一起吞掉。
  const company = meaningful(firstRow ? tidy(firstRow[1]) : pick(lines, [/(?:公司|企业|雇主)[:：]\s*([^　|，,]{2,20})/, /^(.{2,18})(?:招聘|诚聘|公司)/]));
  const position = meaningful(firstRow
    ? tidy(firstRow[2])
    : (pick(lines, [/(?:岗位|职位|招聘岗位|职位名称)[:：]\s*([^　|，,]{2,30})/]) || pickPositionTitle(lines)));
  if (firstRow) why.push({ field: 'company/position', value: company + ' / ' + position, evidence: '第一行是「公司 招聘 岗位」结构' });
  const seniorityHit = SENIOR_WORDS.filter(function (row) { return row.p.test(raw); })[0];
  const years = (raw.match(/(\d+)\s*年(?:以上)?(?:工作)?经验/) || [])[1] || '';
  const seniority = seniorityHit ? seniorityHit.level : (years ? years + ' 年经验' : '');
  if (company) why.push({ field: 'company', value: company, evidence: '匹配到公司名那一行' });
  if (position) why.push({ field: 'position', value: position, evidence: '匹配到岗位词' });
  if (seniority) why.push({ field: 'seniority', value: seniority, evidence: seniorityHit ? '命中级别词' : (years + ' 年经验') });

  // 4) 硬要求 / 加分项（带证据：命中的那个词）
  const mustHave = [];
  const niceToHave = [];
  graded.forEach(function (row) {
    const item = { text: row.line.slice(0, 160), evidence: row.grade.evidence };
    if (row.grade.level === 'must') { if (mustHave.length < 20) mustHave.push(item); }
    else if (niceToHave.length < 20) niceToHave.push(item);
  });
  // 要求分段里的条目即使没写"熟悉"，也算硬要求
  if (mustHave.length < 20) {
    sections.requirement.slice(0, 10).forEach(function (line) {
      if (mustHave.some(function (row) { return row.text === line; })) return;
      if (niceToHave.some(function (row) { return row.text === line; })) return;
      mustHave.push({ text: line.slice(0, 160), evidence: '在「要求」分段里' });
    });
  }

  // 5) 技术栈：已知技术词命中（与知识点匹配互补：一个给"名字"，一个给"知识点"）
  const lower = raw.toLowerCase();
  const stack = [];
  STACK_WORDS.forEach(function (word) {
    if (lower.indexOf(word) > -1 && stack.indexOf(word.trim()) === -1) stack.push(word.trim());
  });

  // 6) 知识点与可练题：复用同一份字典（三端一致）
  const points = [];
  (report.modules || []).forEach(function (mod) {
    (mod.points || []).forEach(function (point) { if (!points.some(function (row) { return row.id === point.id; })) points.push({ id: point.id, name: point.name, module: mod.name }); });
  });
  const taskIds = [];
  points.forEach(function (point) {
    const hit = TASKS.filter(function (task) { return task.id === point.id; })[0];
    void hit;
  });
  // 知识点 → 题：字典里每个知识点自带 tasks
  (report.modules || []).forEach(function (mod) {
    (mod.points || []).forEach(function (point) {
      (point.tasks || []).forEach(function (id) { if (taskIds.indexOf(id) === -1) taskIds.push(id); });
    });
  });

  const title = tidy(lines[0] || '');
  // 列表卡片兜底：详情抓不到时，卡片里仍带着经验/学历/公司/城市
  const singleCard = parseJobCard((lines[0] || '')) || parseJobCard((lines.filter(Boolean).pop() || ''));
  const multiCard = singleCard ? null : parseCardLines(lines);
  const card = singleCard || multiCard;
  const cardSalary = card && /\d/.test(card.salary) ? card.salary : '';
  const location = extractLocation(raw) || (card ? card.city : '');
  const salary = extractSalary(raw);
  const education = educationOf(raw);
  if (card) {
    why.push({ field: 'card', value: [card.company, card.city, card.degree, card.experience].filter(Boolean).join(' / '),
      evidence: '这行是招聘列表卡片结构（标题 薪资 经验 学历 公司 城市），详情抓不到时用它兜底' });
  }
  // 公司名以卡片为准的三种情形：没猜到 / 猜到的明显不是公司名（带 # 或 |）/ 太长。
  // 实测：卡片文件的第 0 行是「# 求职|找工作|招聘信息-BOSS直聘」，旧逻辑会把它当公司名。
  const companyLooksOff = !company || /[|#]/.test(company) || company.length > 20;
  const finalCompany = (card && companyLooksOff) ? card.company : (company || (card ? card.company : ''));
  const finalSeniority = seniority || (card ? card.experience : '');
  // 卡片标题比"文件头里切出来的词"更可能是岗位（实测会切出「信息-BOSS直聘」这种）
  const finalPosition = position || (card && card.title ? card.title : '');
  const postedAt = extractPostedAt(raw);
  return {
    kind: kind,
    title: (finalCompany && finalPosition) ? (finalCompany + ' · ' + finalPosition) : title,
    company: finalCompany,
    position: finalPosition,
    seniority: finalSeniority,
    years: years ? Number(years) : null,
    education: (card && card.degree) ? card.degree : education,
    location: location,
    salary: salary || cardSalary,
    postedAt: postedAt,
    remote: /远程|居家|remote/i.test(raw),
    sections: sections,
    mustHave: mustHave,
    niceToHave: niceToHave,
    stack: stack,
    responsibilities: sections.responsibility.slice(0, 10),
    points: points,
    tasks: taskIds,
    matched: report.matched,
    why: why
  };
}

// 一句话摘要：CLI 与界面都用它，避免三处各写一套
export function summarizeUnderstanding(understood) {
  const parts = [];
  parts.push(understood.kind === 'jd' ? '岗位描述' : (understood.kind === 'doc' ? '技术文档' : '随手笔记'));
  if (understood.company || understood.position) parts.push((understood.company || '?') + ' · ' + (understood.position || '?'));
  if (understood.seniority) parts.push(understood.seniority);
  if (understood.location) parts.push(understood.location);
  if (understood.salary && understood.salary.text) parts.push(understood.salary.text);
  parts.push('硬要求 ' + understood.mustHave.length + ' 条 / 加分 ' + understood.niceToHave.length + ' 条');
  if (understood.stack.length) parts.push('技术栈 ' + understood.stack.slice(0, 6).join('、'));
  parts.push('知识点 ' + understood.points.length + ' 个 → 可练题 ' + understood.tasks.length + ' 道');
  return parts.join('　');
}

// 岗位属性抽取：地点 / 薪资 / 发布时间 / 是否远程。
// 为什么值得单独抽：推荐排序只看"能练多少题"是片面的——地点与薪资是硬门槛，发布时间影响还值不值得投。
export const CITY_WORDS = ['北京', '上海', '深圳', '广州', '杭州', '成都', '武汉', '南京', '西安', '苏州', '长沙', '厦门', '郑州', '重庆', '天津', '济南', '青岛', '合肥', '福州', '东莞', '佛山', '珠海', '无锡', '宁波', '大连', '沈阳', '哈尔滨', '昆明', '贵阳', '南昌', '石家庄', '太原', '兰州', '乌鲁木齐', '香港', '新加坡'];

export function extractSalary(text) {
  const raw = String(text || '');
  // 25-40K·14薪 / 25k-40k / 20~35万 / 15K 以上
  const range = raw.match(/(\d+(?:\.\d+)?)\s*[-~～到至]\s*(\d+(?:\.\d+)?)\s*([kK万wW])/);
  if (range) {
    const factor = /万|w/i.test(range[3]) ? 10 : 1; // 万 → 千（K），好比较
    const unit = factor === 10 ? '万' : 'K';
    return {
      min: Math.round(Number(range[1]) * factor),
      max: Math.round(Number(range[2]) * factor),
      unit: unit,
      text: range[0]
    };
  }
  const single = raw.match(/(\d+(?:\.\d+)?)\s*([kK万wW])(?:\s*(?:以上|起|\+))?/);
  if (single) {
    const factor = /万|w/i.test(single[2]) ? 10 : 1;
    return { min: Math.round(Number(single[1]) * factor), max: null, unit: factor === 10 ? '万' : 'K', text: single[0] };
  }
  return null;
}


// 招聘列表卡片行（BOSS 等）：标题 薪资 经验 学历 公司 城市·区·街道。
// 这类卡片是很多来源**唯一**拿到的原文（详情抓取被反爬挡住时会退化成卡片），
// 而卡片里其实带着经验/学历/公司/城市——以前全被当成「未取到」。
// 从行尾倒着推：最后一段是城市，往前依次是公司、学历、经验、薪资，剩下的是标题。
const DEGREE_WORDS = ['学历不限', '初中', '中专', '中技', '高中', '大专', '专科', '本科', '硕士', '博士'];
const EXP_RE = /^(?:经验不限|应届(?:生)?|\d{1,2}(?:[-~～]\d{1,2})?年(?:以上)?(?:经验)?|经验\d{1,2}(?:[-~～]\d{1,2})?年)$/;
const SALARY_RE = /^(?:\d+(?:\.\d+)?(?:[-~～到至]\d+(?:\.\d+)?)?|-)\s*[kK万W]$/;

// 抓取当时没拿到字段时，文件头会写「（未取到）」「-」「（无）」这类占位。
// 它们是"当时的事实"，不是解析结果——不能当成公司名/地点回填给学员看。
const PLACEHOLDER_RE = /^(?:[（(]?\s*(?:未取到|未提及|未知|无|none|n\/a|null|待定|—|-+)\s*[）)]?)$/i;
function meaningful(text) {
  const t = tidy(text);
  return PLACEHOLDER_RE.test(t) ? '' : t;
}

// 文件头/占位行：这些行是抓取脚本写的元信息，不能当职位描述内容参与抽取
const HEADER_LINE_RE = /^(?:#|分类[:：]|来源[:：]|公司[:：]|城市[:：]|技能标签[:：]|职位描述|（详情未取到|（原文|职位描述（原文）)/;

// 多行卡片：BOSS 的完整 JD 里，标题 / 薪资 / 城市 / 经验 / 学历常常**各占一行**。
// 单行卡片解析器认不出来，这里按行分类兜底（实测 115 份来源里有 64 份是这种）。
export function parseCardLines(lines) {
  const body = (lines || []).map(function (row) { return String(row || '').trim(); })
    .filter(function (row) { return row && !HEADER_LINE_RE.test(row); });
  const out = { degree: '', experience: '', city: '', salary: '', company: '', title: '' };
  body.forEach(function (row, index) {
    if (!out.degree && row.split('/').every(function (part) { return DEGREE_WORDS.indexOf(part) > -1; })) { out.degree = row; return; }
    if (!out.experience && EXP_RE.test(row)) { out.experience = row; return; }
    if (!out.salary && SALARY_RE.test(row)) { out.salary = row; return; }
    if (!out.city && /^[\u4e00-\u9fa5]{2,8}(?:·[\u4e00-\u9fa5A-Za-z0-9]{1,12})*$/.test(row)) {
      out.city = row;
      out.cityIndex = index;   // 记下位置：真实布局里公司名常出现在城市**之后**
      return;
    }
  });
  if (!out.city) return null;
  if (!out.degree && !out.experience) return null;
  // 公司名：整段扫描（城市之后优先），取一个短的、不是字段词、也不是标题的行
  const isField = function (row) {
    return !row || row === out.degree || row === out.experience || row === out.salary || row === out.city
      || DEGREE_WORDS.indexOf(row) > -1 || EXP_RE.test(row) || SALARY_RE.test(row)
      || row === body[0] || row.length > 20 || HEADER_LINE_RE.test(row);
  };
  const candidates = body.map(function (row, index) { return { row: row, index: index }; })
    .filter(function (item) { return !isField(item.row) && /^[\u4e00-\u9fa5A-Za-z0-9（）()]{2,20}$/.test(item.row); })
    .sort(function (a, b) {
      const da = a.index >= (out.cityIndex || 0) ? 0 : 1;
      const db = b.index >= (out.cityIndex || 0) ? 0 : 1;
      return da - db;
    });
  if (candidates.length) out.company = candidates[0].row;
  out.title = body[0] && !/^[\d.]+$/.test(body[0]) ? body[0].slice(0, 120) : '';
  return out;
}

export function parseJobCard(line) {
  const text = String(line || '').trim();
  if (!text || text.length < 12) return null;
  const parts = text.split(/\s+/);
  if (parts.length < 5) return null;
  const cityArea = parts[parts.length - 1];
  if (!/^[\u4e00-\u9fa5]{2,8}(?:·[\u4e00-\u9fa5A-Za-z0-9]{1,12})*$/.test(cityArea)) return null;
  let i = parts.length - 2;
  const company = parts[i] || '';
  if (!company || /^[\d.]+$/.test(company) || company.length < 2) return null;
  i -= 1;
  let degree = '';
  if (i >= 0 && parts[i].split('/').every(function (row) { return DEGREE_WORDS.indexOf(row) > -1; })) {
    degree = parts[i];
    i -= 1;
  }
  if (!degree) return null;
  let experience = '';
  if (i >= 0 && EXP_RE.test(parts[i])) { experience = parts[i]; i -= 1; }
  let salary = '';
  if (i >= 0 && SALARY_RE.test(parts[i])) { salary = parts[i]; i -= 1; }
  const title = parts.slice(0, i + 1).join(' ').trim();
  if (!title || title.length > 120) return null;
  return { title: title, salary: salary, experience: experience, degree: degree, company: company, city: cityArea.split('·')[0], cityArea: cityArea };
}

// 卡片里的学历/经验也要能进 understandText 的结果
export function educationOf(text) {
  const raw = String(text || '');
  const hit = raw.match(/(学历不限|初中|中专|中技|高中|大专|专科|本科|硕士|博士)/);
  return hit ? hit[1] : '';
}

export function extractLocation(text) {
  const raw = String(text || '');
  const labelled = raw.match(/(?:工作地点|办公地点|base|Base|BASE)[:：]?\s*([^\s，,。;；、|]{2,20})/);
  if (labelled && meaningful(labelled[1])) return meaningful(labelled[1]);
  const hit = CITY_WORDS.filter(function (city) { return raw.indexOf(city) > -1; });
  if (hit.length) return hit.slice(0, 2).join('/');
  if (/远程|居家|remote/i.test(raw)) return '远程';
  return '';
}

export function extractPostedAt(text) {
  const raw = String(text || '');
  const rel = raw.match(/(今天|昨天|前天|\d+\s*天前|\d+\s*周前|\d+\s*个月前|刚刚)\s*(?:发布|更新)?/);
  if (rel) return tidy(rel[1]);
  const abs = raw.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\s*月\s*\d{1,2}\s*日)\s*(?:发布|更新)?/);
  if (abs) return tidy(abs[1]);
  return '';
}
