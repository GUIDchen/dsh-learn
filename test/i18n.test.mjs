// UI 层 i18n：两种语言必须成对、占位符可替换、缺 key 原样返回（界面上一眼看出）。
import test from 'node:test';
import assert from 'node:assert/strict';

const { LANGS, MESSAGES, dictionary, isLang, langLabel, missingKeys, t } = await import('../src/core/i18n.mjs');

test('文案表：两种语言成对存在，没有空串', function () {
  assert.deepEqual(missingKeys(), [], '有 key 缺语言或有空串：' + missingKeys().join(', '));
  assert.ok(Object.keys(MESSAGES).length >= 12, '条目太少：' + Object.keys(MESSAGES).length);
  assert.deepEqual(LANGS, ['zh-CN', 'en']);
  assert.ok(isLang('en') && isLang('zh-CN'));
  assert.equal(isLang('fr'), false);
});

test('t()：取值、占位符替换、缺 key 时返回 key 本身', function () {
  assert.equal(t('zh-CN', 'nav.learn'), '学习');
  assert.equal(t('en', 'nav.learn'), 'Learn');
  assert.equal(t('en', 'onboarding.progress', { done: 2, total: 6 }), '2 / 6 steps done');
  assert.equal(t('zh-CN', 'onboarding.progress', { done: 2, total: 6 }), '已走 2 / 6 步');
  assert.equal(t('en', 'missing.key'), 'missing.key', '缺 key 要显形，不要变空白');
  assert.equal(langLabel('en'), 'English');
  assert.equal(langLabel('zh-CN'), '中文');
});

test('dictionary()：按语言导出全部键值（接口就用它）', function () {
  const zh = dictionary('zh-CN');
  const en = dictionary('en');
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  assert.equal(zh['nav.jobs'], '简历投递');
  assert.equal(en['nav.jobs'], 'Applications');
});
