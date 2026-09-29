// survey：多岗位调研。把 N 份岗位要求聚合成"市场需要什么 + 我们缺什么"。
//   --dir=目录（读里面所有 .txt/.md/.html）| --files=a,b,c | --text=…（可重复用 --file）
//   也支持 --url=链接（能抓到的站点；BOSS 这类要登录/反爬的走 --file 或截图）
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { CliError } from '../context.mjs';
import { surveyGroups, surveyJds } from '../../core/survey.mjs';
import { TASKS } from '../../core/tasks.mjs';
import { PASS_SCORE } from '../../core/judge.mjs';
import { fetchText } from '../../core/ingest.mjs';
import { taskStats } from '../../core/progress.mjs';
import { load } from '../../store.mjs';

function stripHtml(text) {
  return String(text).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

function readSources(list) {
  const items = [];
  list.forEach(function (filePath) {
    let stat = null;
    try { stat = statSync(filePath); } catch (err) { throw new CliError('读不到：' + filePath + '（' + err.message + '）', 3); }
    if (stat.isDirectory()) {
      readdirSync(filePath).forEach(function (name) {
        const full = join(filePath, name);
        if (statSync(full).isDirectory()) return;
        const ext = extname(name).toLowerCase();
        if (['.txt', '.md', '.html', '.htm'].indexOf(ext) === -1) return;
        const raw = readFileSync(full, 'utf8');
        items.push({ name: name, source: full, text: ext === '.html' || ext === '.htm' ? stripHtml(raw) : raw });
      });
    } else {
      const raw = readFileSync(filePath, 'utf8');
      const ext = extname(filePath).toLowerCase();
      items.push({ name: filePath.split('/').pop(), source: filePath, text: ext === '.html' || ext === '.htm' ? stripHtml(raw) : raw });
    }
  });
  return items;
}

function listOf(value) {
  if (typeof value === 'string') return value.split(',').map(function (item) { return item.trim(); }).filter(Boolean);
  if (Array.isArray(value)) return value.map(String);
  return [];
}

// 分方向调研：--dir 下的每个子目录算一个方向（可用 --only=a,b 只挑几个）
async function surveyByCategory(ctx, args, out, asJson) {
  const base = String(args.dir || '').trim();
  if (!base) throw new CliError('用法：node src/cli.mjs survey --dir=语料根目录 --by-category [--only=imaging,yolo] [--out=报告.md]', 2);
  const wanted = listOf(args.only);
  const dirs = readdirSync(base).filter(function (name) {
    const full = join(base, name);
    if (!statSync(full).isDirectory()) return false;
    if (wanted.length && wanted.indexOf(name) === -1) return false;
    return true;
  }).sort();
  if (!dirs.length) throw new CliError('这个目录下没有子目录（分方向需要 <根目录>/<方向>/*.txt 的结构）', 3);
  const groups = dirs.map(function (name) {
    const dir = join(base, name);
    const items = readdirSync(dir).filter(function (file) {
      return ['.txt', '.md', '.html', '.htm'].indexOf(extname(file).toLowerCase()) > -1;
    }).sort().map(function (file) {
      const raw = readFileSync(join(dir, file), 'utf8');
      const ext = extname(file).toLowerCase();
      return { name: name + '/' + file, text: (ext === '.html' || ext === '.htm') ? stripHtml(raw) : raw };
    });
    return { name: name, items: items };
  });
  const result = surveyGroups(groups, { tasks: TASKS, minJobs: Number(args['min-jobs']) || 1 });
  if (asJson) { out(result); return 0; }
  if (typeof args.out === 'string' && args.out.trim()) {
    writeFileSync(args.out, result.markdown);
    console.log('已写入 ' + args.out + '（' + result.markdown.length + ' 字）');
  } else {
    console.log(result.markdown);
  }
  console.log('分方向：' + result.stats.groups + ' 个方向 / ' + result.stats.jobs + ' 份岗位；技术栈 ' + result.stats.terms
    + ' 项；跨方向共性 ' + result.stats.shared + ' 项；方向专有 ' + result.stats.unique + ' 项');
  return 0;
}

export async function survey(ctx) {
  const { args, asJson, out } = ctx;
  if (args['by-category']) return surveyByCategory(ctx, args, out, asJson);
  const paths = listOf(args.dir).concat(listOf(args.files)).concat(listOf(args.file));
  let items = readSources(paths);
  if (typeof args.text === 'string' && args.text.trim()) items.push({ name: '文本', source: '参数', text: args.text });
  const urls = listOf(args.url);
  for (const url of urls) {
    const page = await fetchText(url, { maxBytes: 2 * 1024 * 1024, timeout: 20000 });
    if (!page.ok) { console.error('抓取失败 ' + url + '：' + page.reason); continue; }
    items.push({ name: url.split('/').pop() || url, source: url, text: page.text });
  }
  if (!items.length) {
    throw new CliError('没有岗位样本：用 --dir=目录 / --files=a,b / --file=一份 / --url=链接', 2);
  }
  const stats = taskStats(load().records || [], TASKS);
  const passedIds = new Set(stats.known.filter(function (row) { return row.best >= PASS_SCORE; }).map(function (row) { return row.taskId; }));
  const result = surveyJds(items, { tasks: TASKS, minJobs: Number(args['min-jobs']) || 1 });
  result.passedIds = undefined;
  if (asJson) { out(result); return 0; }
  if (typeof args.out === 'string' && args.out.trim()) {
    writeFileSync(args.out, result.markdown);
    console.log('已写入 ' + args.out + '（' + result.markdown.length + ' 字）');
    console.log('岗位 ' + result.stats.jobs + ' 份；技术栈 ' + result.stats.terms + ' 项 / ' + result.stats.categories + ' 类；通用 ' + result.stats.common + ' 项；缺口 ' + result.stats.gaps + ' 项');
    console.log('（已通过题数 ' + passedIds.size + '，只用于统计，不改变调研口径）');
    return 0;
  }
  console.log(result.markdown);
  return 0;
}
