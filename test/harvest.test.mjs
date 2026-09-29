// 招聘抓取的纯逻辑：头部构造与「详情为什么没取到」的判定（抓取脚本本身没法单测，所以抽出来）。
import test from 'node:test';
import assert from 'node:assert/strict';

const { detailReasonOf, cardFields, buildSourceFile } = await import('../src/core/harvest.mjs');
const NL = String.fromCharCode(10);
const CARD = '人工智能新方向+底薪五千无考核 -K 经验不限 中专/中技 陕西泰亚鑫豪 西安·未央区·凤城一路';

test('详情没取到时要如实给出原因（登录墙 / 还在加载 / 正文过短 / 选择器没命中）', function () {
  assert.equal(detailReasonOf({ jd: 'x'.repeat(80) }, '正文'), '', '拿到正文就没有原因');
  assert.equal(detailReasonOf({ jd: '' }, '请扫码登录后查看'), '需要登录或触发了安全验证');
  assert.equal(detailReasonOf({ jd: '' }, '加载中…'), '页面还在加载（正文没渲染出来）');
  assert.equal(detailReasonOf({ jd: '短' }, '正文'), '正文过短（可能被折叠）');
  assert.equal(detailReasonOf({ jd: '' }, '完全无关的页面'), '页面上没找到职位描述节点（选择器没命中或页面被降级）');
});

test('卡片兜底：从列表卡片文本抽字段', function () {
  const card = cardFields(CARD);
  assert.equal(card.company, '陕西泰亚鑫豪');
  assert.equal(card.city, '西安');
  assert.equal(card.degree, '中专/中技');
  assert.equal(card.experience, '经验不限');
  assert.deepEqual(cardFields('不是卡片'), { title: '', company: '', city: '', experience: '', degree: '', salary: '' });
});

test('buildSourceFile：详情拿到时写正文；只有卡片时写卡片并标注原因与详情链接', function () {
  const full = buildSourceFile({
    title: '高级运维工程师', categorySlug: 'ops', keyword: '运维',
    listUrl: 'https://example.com/list', detailUrl: 'https://example.com/job/1',
    jd: '职位描述：'.repeat(20), fields: { company: '某某科技', city: '杭州', exp: '3-5年', degree: '本科', tags: ['Kubernetes'] }
  });
  assert.ok(full.jdChars > 40, '正文长度要记下来：' + full.jdChars);
  assert.ok(full.text.indexOf('详情正文 ' + full.jdChars + ' 字') > -1, '头部要写抓取状态');
  assert.ok(full.text.indexOf('详情页：https://example.com/job/1') > -1, '要留下详情链接（事后可 --resume）');
  assert.equal(full.reason, '');

  const cardOnly = buildSourceFile({
    title: '人工智能新方向', categorySlug: 'rust', keyword: 'Rust',
    listUrl: 'https://example.com/list', detailUrl: 'https://example.com/job/2',
    cardText: CARD, fields: {}, reason: '需要登录或触发了安全验证'
  });
  assert.equal(cardOnly.jdChars, 0);
  assert.equal(cardOnly.company, '陕西泰亚鑫豪', '字段要用卡片兜底');
  assert.equal(cardOnly.degree, '中专/中技');
  assert.ok(cardOnly.text.indexOf('只有列表卡片——需要登录或触发了安全验证') > -1, '要把原因写进文件头');
  assert.ok(cardOnly.text.indexOf('（详情未取到，以下为列表卡片原文）') > -1, '正文区要保留卡片原文');
  assert.ok(cardOnly.text.indexOf(CARD) > -1, '卡片原文要原样保留');
});
