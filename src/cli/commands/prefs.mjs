// 界面偏好：打印当前外观主题，或用 --theme= 设置（网页与原生端读同一份）。
import { preferencesPath, readPrefs, writePrefs } from '../../store.mjs';

export async function prefs(ctx) {
  const { args, asJson, out } = ctx;
  // 位置参数而不是新旗标：CLI 有旗标白名单，为两种语言不值得再开一个口子
  const positional = Array.isArray(args._) ? args._.slice(1) : [];
  const wanted = typeof args.theme === 'string' ? args.theme : (positional[0] || null);
  const wantedLang = typeof args.lang === 'string' ? args.lang : (positional[1] || null);
  if (wanted || wantedLang) {
    let next = null;
    const patch = {};
    if (wanted) patch.theme = wanted;
    if (wantedLang) patch.lang = wantedLang;
    try { next = writePrefs(patch); } catch (err) {
      console.error('设置失败：' + err.message);
      return 2;
    }
    if (asJson) { out({ ok: true, prefs: next }); return 0; }
    console.log('偏好已更新：外观 ' + next.theme + ' / 语言 ' + next.lang + '　（网页版与原生端下次刷新即生效）');
    return 0;
  }
  const current = readPrefs();
  if (asJson) { out({ ok: true, prefs: current, file: preferencesPath() }); return 0; }
  console.log('外观主题：' + current.theme + (current.theme === 'auto' ? '（跟随系统）' : '') + '　语言：' + current.lang);
  console.log('可选：外观 auto/light/dark，语言 zh-CN/en');
  console.log('设置：node src/cli.mjs prefs dark en　（第一个是外观，第二个是语言）');
  console.log('偏好文件：' + preferencesPath());
  return 0;
}
