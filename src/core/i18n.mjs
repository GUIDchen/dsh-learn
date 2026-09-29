// UI 层 i18n：语言表与文案的**单一事实源**（网页版从 /api/i18n 取，CLI 与原生端也能读到同一份）。
//
// 口径：
//   * 只收「界面上真正会显示的字」——页面名、命令面板、引导卡片、主题切换这类；
//   * 两种语言必须**成对**存在，缺一条就被 test/i18n.test.mjs 拦下（不做「先中文后补英文」的债）；
//   * 默认 zh-CN（界面本来就是中文），语言偏好与外观偏好存在同一份 preferences.json 里。
export const LANGS = ['zh-CN', 'en'];

export const MESSAGES = {
  'nav.learn': { 'zh-CN': '学习', en: 'Learn' },
  'nav.projects': { 'zh-CN': '项目', en: 'Projects' },
  'nav.jobs': { 'zh-CN': '简历投递', en: 'Applications' },
  'nav.flow': { 'zh-CN': '流程', en: 'Flow' },
  'palette.open': { 'zh-CN': '命令面板', en: 'Command palette' },
  'palette.placeholder': { 'zh-CN': '输入命令（例如：备份 / 投递 / 复习）', en: 'Type a command (backup / jobs / review)' },
  'palette.empty': { 'zh-CN': '没有匹配的命令', en: 'No matching command' },
  'onboarding.title': { 'zh-CN': '从这里开始', en: 'Start here' },
  'onboarding.progress': { 'zh-CN': '已走 {done} / {total} 步', en: '{done} / {total} steps done' },
  'onboarding.done': { 'zh-CN': '六步都走过了：可以开始每天练几道、定期备份。', en: 'All six steps done: practise daily and keep backups.' },
  'theme.dark': { 'zh-CN': '深色', en: 'Dark' },
  'theme.light': { 'zh-CN': '浅色', en: 'Light' },
  'lang.toggle': { 'zh-CN': 'English', en: '中文' },
  'common.close': { 'zh-CN': '关闭', en: 'Close' },
  'common.loading': { 'zh-CN': '正在读取…', en: 'Loading…' }
};

export function langLabel(lang) { return lang === 'en' ? 'English' : '中文'; }

export function isLang(value) { return LANGS.indexOf(String(value)) > -1; }

// t(lang, key, vars)：缺 key 时**原样返回 key**（便于在界面上一眼看出漏了哪条，而不是显示空白）
export function t(lang, key, vars) {
  const row = MESSAGES[key];
  const use = lang === 'en' ? 'en' : 'zh-CN';
  let text = row && row[use] !== undefined ? row[use] : key;
  if (vars) {
    Object.keys(vars).forEach(function (name) {
      text = text.split('{' + name + '}').join(String(vars[name]));
    });
  }
  return text;
}

export function dictionary(lang) {
  const use = lang === 'en' ? 'en' : 'zh-CN';
  const out = {};
  Object.keys(MESSAGES).forEach(function (key) { out[key] = MESSAGES[key][use]; });
  return out;
}

// 守卫用：列出任何一条缺语言/空串的 key
export function missingKeys() {
  const missing = [];
  Object.keys(MESSAGES).forEach(function (key) {
    LANGS.forEach(function (lang) {
      const value = MESSAGES[key][lang];
      if (typeof value !== 'string' || !value.trim()) missing.push(key + ':' + lang);
    });
  });
  return missing;
}
