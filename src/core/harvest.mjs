// 招聘抓取的纯逻辑：文件头构造与「详情为什么没取到」的判定。
//
// 抽出来的两个理由：
//   1. 抓取脚本要在浏览器里跑，无法单测；把可判定的部分挪出来就能离线验证；
//   2. 「公司/城市/薪资/经验/学历」现在由 core 解析器现算（与 CLI/网页/原生同一份口径），
//      而不是只依赖页面上的选择器命中——实测选择器经常只剩列表卡片。
import { parseJobCard, understandText } from './understand.mjs';

// 详情没取到时的原因（如实写进文件与 index.json，事后可 --resume 重抓）
export function detailReasonOf(fields, pageText) {
  const jd = String((fields && fields.jd) || '').trim();
  if (jd.length >= 40) return '';
  const text = String(pageText || '');
  if (/扫码登录|登录后查看|请先登录|安全验证|滑动验证|验证码|请稍后重试/.test(text)) return '需要登录或触发了安全验证';
  if (/加载中|请稍候|skeleton/i.test(text) && jd.length === 0) return '页面还在加载（正文没渲染出来）';
  return jd.length ? '正文过短（可能被折叠）' : '页面上没找到职位描述节点（选择器没命中或页面被降级）';
}

// 一行卡片兜底：从列表卡片文本里抽字段（与 understand 同一套规则）
export function cardFields(cardText) {
  const card = parseJobCard(String(cardText || '').replace(/\s+/g, ' ').trim());
  if (!card) return { title: '', company: '', city: '', experience: '', degree: '', salary: '' };
  return {
    title: card.title || '', company: card.company || '', city: card.city || '',
    experience: card.experience || '', degree: card.degree || '', salary: card.salary || ''
  };
}

// 组装一个来源文件：头部（分类/来源/详情页/字段/抓取状态）+ 正文（详情原文或卡片原文）
export function buildSourceFile(meta) {
  const input = meta || {};
  const card = cardFields(input.cardText || '');
  const fields = input.fields || {};
  const parsed = understandText([input.jd || input.cardText || ''].join(String.fromCharCode(10)), {});
  const pick = function (fromScript, fromParser, fallback) {
    const a = String(fromScript || '').trim();
    if (a) return a;
    const b = String(fromParser || '').trim();
    if (b) return b;
    return fallback;
  };
  const company = pick(fields.company, parsed.company, card.company || '（未取到）');
  const city = pick(fields.city, parsed.location, card.city || '-');
  const salary = pick(fields.salary, (parsed.salary && parsed.salary.text) || '', card.salary || '-');
  const exp = pick(fields.exp, parsed.seniority, card.experience || '-');
  const degree = pick(fields.degree, parsed.education, card.degree || '-');
  const tags = Array.isArray(fields.tags) ? fields.tags : [];
  const detail = String(input.jd || '').trim();
  const reason = String(input.reason || '');
  const lines = [
    '# ' + (input.title || card.title || '（无标题）'),
    '',
    '分类：' + (input.categorySlug || '-') + '（关键词「' + (input.keyword || '-') + '」）',
    '来源：' + (fields.url || input.detailUrl || input.listUrl || '-'),
    '详情页：' + (input.detailUrl || '（列表页抓取，未记录详情链接）'),
    '公司：' + company + '　城市：' + city + '　薪资：' + salary + '　经验：' + exp + '　学历：' + degree,
    '技能标签：' + (tags.join('、') || '（无）'),
    '抓取：' + (detail ? ('详情正文 ' + detail.length + ' 字') : ('只有列表卡片' + (reason ? ('——' + reason) : ''))),
    '',
    '职位描述（原文）',
    detail || '（详情未取到，以下为列表卡片原文）',
    detail ? '' : String(input.cardText || '')
  ];
  return { text: lines.join(String.fromCharCode(10)), company: company, city: city, salary: salary, exp: exp, degree: degree, jdChars: detail.length, reason: reason };
}
