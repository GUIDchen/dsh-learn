// 评测内核：纯函数，不依赖 Node API，浏览器与 CLI 共用。
import { getProfile } from './platform.mjs';

export const PASS_SCORE = 100;
export const PARTIAL_SCORE = 60;
export const FORBID_PENALTY = 30;
// 命中 severity: block 的禁止写法（删数据、丢改动一类）时，分数封顶在及格线以下：
// 这类写法不该出现"部分通过"，必须明确判为未通过。
export const BLOCKED_CEILING = 59;

export function normalize(answer) {
  return String(answer || '').replace(/\s+/g, ' ').trim();
}

// 匹配规则：规则里**写了大写字母**就按大小写敏感匹配，否则忽略大小写。
// 理由：命令本身区分大小写（git branch -d 删已合并分支，-D 是强删），
// 而把 -D 写成忽略大小写会误伤 -d，直接导致安全规则判错。
export function ruleFlags(pattern) {
  return /[A-Z]/.test(String(pattern)) ? '' : 'i';
}

export function ruleMatches(pattern, text) {
  return new RegExp(pattern, ruleFlags(pattern)).test(text);
}

// 命中时把"实际匹配到的片段"也带回来：学员看到的是自己写对的那一小段命令，
// 而不是规则里那句为"缺失"写的提示文案。
export function ruleMatchText(pattern, text) {
  const hit = new RegExp(pattern, ruleFlags(pattern)).exec(String(text || ''));
  return hit ? hit[0].trim() : null;
}

// 短选项合并写法（-Eo、-dit、-rh、-bn1）在命令行里很常见，但按字面量匹配会误判成"缺少 -o / 缺少 -n 1"。
// 这里把合并簇展开成影子文本再匹配：
//   -Eo   -> 追加 "-E -o"
//   -bn1  -> 追加 "-b -n -n1"（字母各自成 flag，带数字的那一组单独保留）
// 纯数字（-3）与长选项（--name）不动。
export function expandShortFlags(text) {
  const tokens = String(text || '').split(' ');
  const extra = [];
  tokens.forEach(function (token, index) {
    // 紧跟其后的取值：shell 语义里它绑在簇的最后一个字母上（-rwc 10 = -r -w -c 10）
    const next = tokens[index + 1] || '';
    const value = next && next.charAt(0) !== '-' ? next : '';
    if (/^-[A-Za-z]{2,}$/.test(token)) {
      const letters = token.slice(1).split('');
      letters.forEach(function (letter) { extra.push('-' + letter); });
      // 只有取值时才补 "-末字母 取值"，避免给纯开关簇造出多余文本
      if (value) extra.push('-' + letters[letters.length - 1] + ' ' + value);
      return;
    }
    const mixed = token.match(/^-([A-Za-z][A-Za-z0-9]*)$/);
    if (mixed) {
      const body = mixed[1];
      const letters = body.replace(/[0-9]/g, '');
      const digits = body.replace(/[^0-9]/g, '');
      if (letters.length >= 2) {
        letters.split('').forEach(function (letter) { extra.push('-' + letter); });
        if (digits) extra.push('-' + letters.slice(-1) + digits);
        else if (value) extra.push('-' + letters.charAt(letters.length - 1) + ' ' + value);
      }
    }
  });
  return extra.length ? text + ' ' + extra.join(' ') : text;
}

// 平台变体优先：有 variants[platform] 时，整套要素以变体为准。
// 题目声明了 platforms 时，不在声明范围里的平台不该判分：
// 顶层兜底规则可能是「launchctl|systemctl」这种在该平台上根本不存在的命令，
// 判 100 分等于教错（学员会在 Windows 上练到一条 Windows 没有的命令）。
// 返回 null 表示可以判；返回字符串表示要拦住，并把原因原样给用户看。
export function platformBlocker(resolved) {
  if (!resolved || resolved.supported !== false) return null;
  const platforms = (resolved.taskPlatforms || []).join(' / ');
  return '这道题只在 ' + platforms + ' 上有参考答案，' + resolved.platform + ' 平台不适用：换平台再练，或看"其他平台写法"对比着记';
}

export function resolveTask(task, platform) {
  const variant = (task.variants && task.variants[platform]) || {};
  // 题目可以用 platforms 声明「只在某些平台上成立」（launchctl 就是 macOS 独有）。
  // 声明排除当前平台时照样能判（用顶层兜底规则），但客户端要能把这件事说出来——
  // 否则 Windows 上练到一道只写了 macOS/Linux 参考答案的题，学员会以为自己的写法错了。
  const declared = Array.isArray(task.platforms) && task.platforms.length ? task.platforms : null;
  return Object.assign({}, task, {
    platform,
    profile: getProfile(platform).name,
    taskPlatforms: declared,
    supported: !declared || declared.indexOf(platform) > -1,
    sample: variant.sample || task.sample || '',
    hint: variant.hint || task.hint || '',
    require: variant.require || task.require || [],
    forbid: variant.forbid || task.forbid || [],
    verify: variant.verify || task.verify || null
  });
}

export function judge(task, answer, platform) {
  const resolved = resolveTask(task, platform);
  const text = normalize(answer);
  const result = {
    taskId: task.id,
    platform,
    answer: text,
    score: 0,
    verdict: '未作答',
    pass: false,
    missing: [],
    matched: [],
    scoring: '',
    notes: [],
    tips: ''
  };
  if (!text) {
    result.notes.push('请先写下要执行的命令');
    result.tips = '请先写下要执行的命令';
    return result;
  }

  const haystack = expandShortFlags(text);
  const require = resolved.require || [];
  let matched = 0;
  require.forEach(function (rule) {
    const hitText = ruleMatchText(rule.p, haystack);
    if (hitText !== null) {
      matched += 1;
      // 命中要素回给学员的是"你写对的那一段"，比重复缺失文案有用
      result.matched.push(hitText);
    } else {
      result.missing.push(rule.tip);
    }
  });
  result.required = require.length;
  result.score = require.length ? Math.round(matched / require.length * 100) : 0;

  let blocked = false;
  (resolved.forbid || []).forEach(function (rule) {
    if (ruleMatches(rule.p, haystack)) {
      result.notes.push(rule.tip);
      result.score = Math.max(0, result.score - FORBID_PENALTY);
      if (rule.severity === 'block') blocked = true;
    }
  });
  if (blocked) {
    result.blocked = true;
    result.score = Math.min(result.score, BLOCKED_CEILING);
  }

  // 评分构成透明化：学员能看到分数是怎么算出来的，而不是只看到一个数字
  const parts = [];
  parts.push('命中 ' + matched + '/' + require.length + ' 个要素');
  if (result.notes.length) parts.push('命中 ' + result.notes.length + ' 条禁止写法（每条 -' + FORBID_PENALTY + ' 分）');
  if (blocked) parts.push('含 block 级写法，分数封顶 ' + BLOCKED_CEILING);
  result.scoring = '得分 ' + result.score + '：' + parts.join('，');

  result.pass = result.score >= PASS_SCORE;
  result.verdict = result.pass ? '通过' : (result.score >= PARTIAL_SCORE ? '部分通过' : '未通过');
  result.tips = (result.missing.length === 1 && require.length > 1 ? '就差 1 项：' : '')
    + (result.missing.length ? '缺失要点：' + result.missing.join('；') : '关键要素齐全')
    + (result.notes.length ? '；问题：' + result.notes.join('；') : '')
    // block 级禁止项不止"删数据"一种（还有把密钥写进镜像这类），所以措辞保持中性
    + (blocked ? '；命中 block 级禁止项，直接判定为未通过' : '');
  return result;
}
