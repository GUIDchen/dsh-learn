// 招聘列表卡片的字段解析：详情抓不到时，卡片里其实带着经验/学历/公司/城市。
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseJobCard, parseCardLines, understandText } = await import('../src/core/understand.mjs');
const NL = String.fromCharCode(10);

test('单行卡片：从行尾倒推城市/公司/学历/经验/薪资', function () {
  const card = parseJobCard('人工智能新方向+底薪五千无考核 -K 经验不限 中专/中技 陕西泰亚鑫豪 西安·未央区·凤城一路');
  assert.ok(card, '应当识别为卡片');
  assert.equal(card.company, '陕西泰亚鑫豪');
  assert.equal(card.city, '西安');
  assert.equal(card.cityArea, '西安·未央区·凤城一路');
  assert.equal(card.degree, '中专/中技');
  assert.equal(card.experience, '经验不限');
  assert.equal(card.salary, '-K');
  assert.equal(card.title, '人工智能新方向+底薪五千无考核');
  assert.equal(parseJobCard('这不是卡片，只是一句话'), null);
  assert.equal(parseJobCard(''), null);
});

test('多行卡片：标题/薪资/城市/经验/学历各占一行也能解析（完整 JD 常见）', function () {
  const lines = ['人工智能新方向+底薪五千无考核', '-K', '西安', '经验不限', '中专/中技', '陕西泰亚鑫豪', '职位描述（原文）', '负责客户对接与售后'];
  const card = parseCardLines(lines);
  assert.ok(card, '应当识别为多行卡片：' + JSON.stringify(card));
  assert.equal(card.city, '西安');
  assert.equal(card.experience, '经验不限');
  assert.equal(card.degree, '中专/中技');
  assert.equal(card.company, '陕西泰亚鑫豪');
  assert.equal(card.title, '人工智能新方向+底薪五千无考核');
});

test('understandText：卡片兜底填字段；占位值不当成真值；标签值不吞下一个字段', function () {
  const card = understandText('# 求职|找工作|招聘信息-BOSS直聘' + NL + NL + '公司：（未取到）　城市：-　薪资：-　经验：-　学历：-' + NL + NL + '人工智能新方向+底薪五千无考核 -K 经验不限 中专/中技 陕西泰亚鑫豪 西安·未央区·凤城一路', {});
  assert.equal(card.company, '陕西泰亚鑫豪', '文件头写着未取到，应当用卡片里的公司');
  assert.equal(card.location, '西安');
  assert.equal(card.education, '中专/中技');
  assert.equal(card.seniority, '经验不限');
  assert.notEqual(card.company, '（未取到）', '占位值不是公司名');
  const labeled = understandText('公司：陕西跃界网络科技　城市：西安　薪资：6-8K' + NL + '岗位：运维工程师', {});
  assert.equal(labeled.company, '陕西跃界网络科技', '标签值只取到分隔符为止');
  assert.equal(labeled.position, '运维工程师');
});
