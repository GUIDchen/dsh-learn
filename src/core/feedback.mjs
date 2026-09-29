// 判定反馈定位：把「缺哪些要素」推进到「缺的那一条最可能该写在哪一行」。
//
// 现状：judge 给出 missing（缺哪些要素的提示文案），但学员拿到的是一句抽象的话。
// 这里做的是**定位建议**——在学员自己的答案里找最接近的那一行，并说清相似在哪；
// 找不到就如实说「答案里没有相关片段」，不硬编一个行号。
//
// 做法：把规则里的**字面片段**抽出来（去掉正则元字符与分组），再按整行累加与各片段的
// 最长公共子串长度；累加值最高且整体相似度 ≥0.5 的那一行才算「最接近」。
import { judge, resolveTask } from './judge.mjs';

// 从正则里抽字面片段：去掉转义、字符类与分组包裹，再按空白切开
export function literalFragments(pattern) {
  const text = String(pattern || '')
    .replace(/\\[a-zA-Z]/g, ' ')        // \s \d \b 之类的转义
    .replace(/\[[^\]]*\]/g, ' ')         // 字符类 [0-9]
    .replace(/\(([^)]*)\)/g, ' $1 ')     // 分组只保留内容
    .replace(/[?*+^$|{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.split(' ')
    // 只剥尾部的标点：-c / --version 这类开关本身就是有效字面量
    .map(function (row) { return row.replace(/[-.]+$/g, ''); })
    .filter(function (row) { return row.length >= 2; });
}

export function longestCommon(a, b) {
  const s1 = String(a || '').toLowerCase();
  const s2 = String(b || '').toLowerCase();
  if (!s1 || !s2) return 0;
  let best = 0;
  const table = new Array(s2.length + 1).fill(0);
  for (let i = 1; i <= s1.length; i += 1) {
    let prev = 0;
    for (let j = 1; j <= s2.length; j += 1) {
      const cur = table[j];
      table[j] = s1[i - 1] === s2[j - 1] ? prev + 1 : 0;
      if (table[j] > best) best = table[j];
      prev = cur;
    }
  }
  return best;
}

// 给一条规则找最接近的答案行（整行累加片段匹配长度）
export function locateRule(rule, lines) {
  const fragments = literalFragments(rule.p);
  if (!fragments.length) return null;
  const totalFragments = fragments.reduce(function (sum, row) { return sum + row.length; }, 0);
  let best = null;
  lines.forEach(function (line, index) {
    // 只看「最长片段」会让 kubectl 这种共同前缀把行与行拉平，所以整行累加
    let matched = 0;
    fragments.forEach(function (fragment) { matched += longestCommon(fragment, line); });
    if (!matched) return;
    const similarity = matched / totalFragments;
    if (!best || matched > best.matched) {
      best = { index: index, matched: matched, similarity: Number(similarity.toFixed(2)) };
    }
  });
  if (!best || best.similarity < 0.5) return null;
  return best;
}

export function locateMissing(task, answer, platform) {
  const resolved = resolveTask(task, platform);
  const require = resolved.require || [];
  const judged = judge(task, answer, platform);
  // 只给**确实没命中**的要素做定位：命中的要素不需要建议
  const missingTips = (judged.missing || []).slice();
  const seen = {};
  const missingRules = [];
  require.forEach(function (rule) {
    const key = String(rule.tip);
    if (missingTips.indexOf(key) === -1) return;
    if (seen[key]) return;
    seen[key] = true;
    missingRules.push(rule);
  });
  const lines = String(answer || '').split(/\n+/)
    .map(function (row) { return row.trim(); })
    .filter(Boolean);
  const located = [];
  const unmatched = [];
  missingRules.forEach(function (rule) {
    const hit = locateRule(rule, lines);
    if (!hit) { unmatched.push({ tip: rule.tip }); return; }
    located.push({
      tip: rule.tip,
      line: hit.index + 1,
      lineText: lines[hit.index].slice(0, 100),
      similarity: hit.similarity,
      suggestion: '第 ' + (hit.index + 1) + ' 行最接近（整体相似 ' + Math.round(hit.similarity * 100) + '%），但还缺「' + rule.tip + '」'
    });
  });
  return { located: located, unmatched: unmatched };
}
