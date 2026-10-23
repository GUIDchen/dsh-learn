// 截图 OCR：macOS 上用系统自带的 Vision 框架，纯本地、不联网、零第三方依赖。
// 首次使用时用 swiftc 把 tools/ocr.swift 编译好，放进**共享缓存**（按源码哈希命名，源码改了自动重编）。
// 为什么不是按 home 放：测试、验收、发布前哨都会用临时 home，按 home 存会导致每处都重编一次
// （实测每次 60–90 秒，还容易被机器负载拖成超时）。同一份源码在一台机器上只该编一次。
// 非 macOS 或没有 swiftc 时如实说明，不假装能识别。
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OCR_SOURCE = resolve(HERE, '../../tools/ocr.swift');

// 共享缓存目录：DSH_LEARN_OCR_CACHE 可覆盖；默认放到 macOS 的 Caches 下（不进 home，换 home 不重编）
export function ocrCacheDir() {
  return process.env.DSH_LEARN_OCR_CACHE || join(homedir(), 'Library', 'Caches', 'dsh-learn');
}

// home 参数保留兼容（调用方不必改），但二进制放共享缓存，并按 Swift 源码哈希命名：
// 源码一改，哈希变、自动重编；改回旧源码还能命中旧产物。
export function ocrHelperPath(home) {
  try {
    const hash = createHash('sha1').update(readFileSync(OCR_SOURCE, 'utf8')).digest('hex').slice(0, 12);
    return join(ocrCacheDir(), 'dsh-ocr-' + hash);
  } catch (err) {
    const base = home || process.env.DSH_LEARN_HOME || join(homedir(), '.dsh-learn');
    return join(base, 'bin', 'dsh-ocr');
  }
}

function hasSwiftc() {
  const probe = spawnSync('swiftc', ['--version'], { encoding: 'utf8', timeout: 15000 });
  return probe.status === 0;
}

// 外部 OCR：DSH_LEARN_OCR 指定可执行文件，或系统里已有的 tesseract。
// 项目本身不引入依赖——有就用，没有就说清怎么装。
function findExternalOcr() {
  const custom = process.env.DSH_LEARN_OCR;
  if (custom) return { path: custom, kind: 'custom' };
  const probe = spawnSync('tesseract', ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (probe.status === 0) return { path: 'tesseract', kind: 'tesseract' };
  return null;
}

// tesseract 的输出在 stdout，语言包默认 chi_sim+eng（没装中文包时会自动只跑 eng）
function runExternalOcr(found, image, options) {
  const opts = options || {};
  const langs = opts.languages || process.env.DSH_LEARN_OCR_LANGS || 'chi_sim+eng';
  const args = found.kind === 'tesseract' ? [image, 'stdout', '-l', langs] : [image];
  let run = spawnSync(found.path, args, { encoding: 'utf8', timeout: opts.timeout || 60000, killSignal: 'SIGKILL' });
  if (run.status !== 0 && found.kind === 'tesseract') {
    // 常见情况：没装 chi_sim 语言包。退回英文再试一次，并在说明里讲清楚。
    run = spawnSync(found.path, [image, 'stdout', '-l', 'eng'], { encoding: 'utf8', timeout: opts.timeout || 60000, killSignal: 'SIGKILL' });
    if (run.status === 0) {
      const text = (run.stdout || '').trim();
      if (text) return { ok: true, text: text, helper: 'tesseract', note: '只装了 eng 语言包：中文截图建议 apt install tesseract-ocr-chi-sim' };
    }
  }
  if (run.status !== 0) {
    const detail = ((run.stdout || '') + (run.stderr || '')).trim().split('\n').filter(Boolean).slice(-1)[0] || '未知原因';
    return { ok: false, reason: '外部 OCR 失败：' + detail };
  }
  const text = (run.stdout || '').trim();
  if (!text) return { ok: false, reason: '外部 OCR 没有识别出文字' };
  return { ok: true, text: text, helper: found.path };
}

// 编译一次，之后复用。返回 { ok, path, reason }
export function ensureOcrHelper(options) {
  const opts = options || {};
  const target = opts.path || ocrHelperPath(opts.home);
  if (existsSync(target)) return { ok: true, path: target, compiled: false };
  if (opts.helper) return { ok: true, path: opts.helper, compiled: false };
  if (process.platform !== 'darwin') {
    return { ok: false, reason: '截图 OCR 目前用 macOS 自带的 Vision 实现；当前平台是 ' + process.platform + '，请把文字复制成文本再分析' };
  }
  if (!opts.skipCompile && !hasSwiftc()) {
    return { ok: false, reason: '没有 swiftc（Xcode Command Line Tools）：xcode-select --install 之后重试，或用 --text 直接贴文字' };
  }
  try {
    mkdirSync(dirname(target), { recursive: true });
    const build = spawnSync('swiftc', ['-O', '-o', target, opts.source || OCR_SOURCE], { encoding: 'utf8', timeout: 180000 });
    if (build.status !== 0 || !existsSync(target)) {
      return { ok: false, reason: '编译 OCR 助手失败：' + ((build.stderr || '').split('\n').filter(Boolean).slice(-1)[0] || '未知原因') };
    }
    return { ok: true, path: target, compiled: true };
  } catch (err) {
    return { ok: false, reason: '编译 OCR 助手失败：' + err.message };
  }
}

// 识别一张图片里的文字：返回 { ok, text, reason, helper, lines }
export function ocrImage(imagePath, options) {
  const opts = options || {};
  const image = String(imagePath || '').trim();
  if (!image) return { ok: false, reason: '没有给图片路径' };
  if (!existsSync(image)) return { ok: false, reason: '找不到图片文件：' + image };
  // 非 macOS：优先用外部 OCR（DSH_LEARN_OCR 或 tesseract）
  if (process.platform !== 'darwin' || opts.external) {
    const external = opts.helper ? { path: opts.helper, kind: 'custom' } : findExternalOcr();
    if (external) return runExternalOcr(external, image, opts);
    if (process.platform !== 'darwin') {
      return { ok: false, reason: '当前平台没有内置 OCR：装一个 tesseract（apt install tesseract-ocr tesseract-ocr-chi-sim）或设置 DSH_LEARN_OCR 指向你的 OCR 可执行文件；也可以直接用 --text / --file 贴文字' };
    }
  }

  const helper = ensureOcrHelper(opts);
  if (!helper.ok) return { ok: false, reason: helper.reason };
  const run = spawnSync(helper.path, [image], { encoding: 'utf8', timeout: opts.timeout || 60000, killSignal: 'SIGKILL' });
  if (run.status !== 0) {
    const detail = ((run.stdout || '') + (run.stderr || '')).trim().split('\n').filter(Boolean).slice(-1)[0] || '未知原因';
    return { ok: false, reason: 'OCR 失败：' + detail, helper: helper.path };
  }
  const text = (run.stdout || '').trim();
  if (!text) return { ok: false, reason: '这张图里没识别出文字（试试更清晰的截图）', helper: helper.path };
  return { ok: true, text: text, helper: helper.path, lines: text.split('\n').length, compiled: helper.compiled };
}


// 识图能力矩阵：这台机器会用哪个引擎、为什么、怎么开更多。
// 「软件本身具有识图解析的能力」这件事必须可自证：用户看一眼就知道当前能不能用、不能用时缺什么。
export function ocrCapabilities(options) {
  const opts = options || {};
  const custom = process.env.DSH_LEARN_OCR || '';
  const swiftc = hasSwiftc();
  const helper = ocrHelperPath(opts.home);
  const helperReady = existsSync(helper);
  const external = findExternalOcr();
  const engines = [
    {
      id: 'custom',
      name: 'DSH_LEARN_OCR 指定的可执行文件',
      available: Boolean(custom),
      detail: custom ? ('已指定：' + custom) : '没设这个环境变量',
      enable: 'export DSH_LEARN_OCR=/path/to/your-ocr（参数：<图片>，输出走 stdout）'
    },
    {
      id: 'vision',
      name: 'macOS Vision（系统自带，离线、免费）',
      available: process.platform === 'darwin' && swiftc,
      detail: process.platform === 'darwin'
        ? (swiftc ? (helperReady ? '助手已编译：' + helper : '助手未编译，首次识别时会自动用 swiftc 编译') : '找不到 swiftc')
        : '非 macOS 平台，系统里没有 Vision',
      enable: '装 Xcode 命令行工具（xcode-select --install）后即可用'
    },
    {
      id: 'tesseract',
      name: 'tesseract（跨平台，需另装）',
      available: Boolean(external && external.kind === 'tesseract'),
      detail: external && external.kind === 'tesseract' ? '已安装；语言包 ' + (process.env.DSH_LEARN_OCR_LANGS || 'chi_sim+eng') : '没装',
      enable: 'macOS：brew install tesseract tesseract-lang；Debian/Ubuntu：apt install tesseract-ocr tesseract-ocr-chi-sim'
    }
  ];
  const usable = engines.filter(function (row) { return row.available; });
  const order = ['custom', 'vision', 'tesseract'];
  const chosen = order.filter(function (id) { return usable.some(function (row) { return row.id === id; }); })[0] || null;
  return {
    platform: process.platform,
    engines: engines,
    chosen: chosen,
    // 能识别的图片格式：Vision 走 ImageIO（更宽），tesseract 看语言包与编译选项，这里给保守集合
    formats: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'],
    limits: {
      maxBytes: 8 * 1024 * 1024,
      note: '默认按整图识别；长截图（终端记录、聊天记录）识别完整文本，命令块会被抽成草案题'
    },
    advice: chosen ? ['当前会用：' + (engines.filter(function (row) { return row.id === chosen; })[0] || {}).name]
      : ['这台机器现在不能识图：装 Xcode 命令行工具（macOS）或 tesseract，或设 DSH_LEARN_OCR 指向自己的识别器']
  };
}
// 把 data URL（网页上传的截图）落到临时文件，交给 ocrImage
export function saveDataUrl(dataUrl, options) {
  const opts = options || {};
  const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim());
  if (!match) return { ok: false, reason: '只接受 PNG/JPEG/WebP/GIF 的 data URL' };
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > (opts.maxBytes || 8 * 1024 * 1024)) {
    return { ok: false, reason: '图片太大（上限 8MB）' };
  }
  const file = join(opts.dir || tmpdir(), 'dsh-learn-ocr-' + Date.now() + '.' + ext);
  try {
    writeFileSync(file, buffer);
    return { ok: true, path: file, bytes: buffer.length };
  } catch (err) {
    return { ok: false, reason: '写入临时文件失败：' + err.message };
  }
}
