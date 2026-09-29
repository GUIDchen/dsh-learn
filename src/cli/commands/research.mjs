// 搜索与资料收集的命令行入口：先搜，再把命中的页面解析成知识点与草案题。
// 口径都在 core/search.mjs（三端共用）；这里只管"怎么敲"与"怎么打印"。
// 命令名与 core 的函数同名（都叫 research），导入时改名避免撞车
import { research as researchQuery, searchWeb, ENGINES } from '../../core/search.mjs';
import { ingestIntoProject } from '../../core/project.mjs';

function engineOption(args) {
  const engine = typeof args.engine === 'string' ? args.engine.trim() : '';
  if (engine && ENGINES.indexOf(engine) === -1) {
    throw new Error('未知引擎：' + engine + '（可用：' + ENGINES.join(' / ') + '）');
  }
  return engine || '';
}

function limitOption(args, fallback) {
  const n = Number(args.limit);
  return Number.isFinite(n) && n > 0 ? Math.min(20, Math.floor(n)) : fallback;
}

export async function search(ctx) {
  const { args, asJson, out } = ctx;
  const query = args._.slice(1).join(' ').trim();
  if (!query) {
    console.error('用法：node src/cli.mjs search <关键词> [--engine=bing|duckduckgo|custom] [--limit=8] [--json]');
    return 2;
  }
  const result = await searchWeb(query, { engine: engineOption(args), limit: limitOption(args, 8) });
  if (asJson) { out(result); return result.ok ? 0 : 3; }
  if (!result.ok) {
    console.error('搜索失败：' + result.reason);
    return 3;
  }
  console.log('关键词：' + result.query + '　引擎：' + result.engine + '　结果 ' + result.total + ' 条');
  result.results.forEach(function (row, index) {
    console.log('  ' + String(index + 1) + '. ' + row.title);
    console.log('     ' + row.url);
    if (row.snippet) console.log('     ' + row.snippet.slice(0, 120));
  });
  console.log('');
  console.log('下一步：node src/cli.mjs research "' + result.query + '" [--project=项目名] 会把这些页面抓回来解析');
  return 0;
}

export async function research(ctx) {
  const { args, asJson, out } = ctx;
  const query = args._.slice(1).join(' ').trim();
  if (!query) {
    console.error('用法：node src/cli.mjs research <关键词> [--limit=5] [--project=项目名] [--engine=…] [--json]');
    return 2;
  }
  const project = typeof args.project === 'string' ? args.project.trim() : '';
  const result = await researchQuery(query, {
    engine: engineOption(args),
    limit: limitOption(args, 5),
    // 要收进项目就得拿原文，否则入库还得再抓一遍同样的链接
    keepText: Boolean(project)
  });
  if (asJson) { out(result); return result.ok ? 0 : 3; }
  if (!result.ok) {
    console.error('搜索失败：' + result.reason);
    return 3;
  }
  console.log('关键词：' + result.query + '　引擎：' + result.engine + '　搜到 ' + result.searched + ' 条，抓到 ' + result.fetched + ' 页');
  result.results.forEach(function (row) {
    if (row.ok) {
      console.log('  ✓ 知识点 ' + String(row.matched) + ' 个 / 草案题 ' + String(row.tasks) + ' 道　' + row.url);
    } else {
      console.log('  ✗ ' + row.url + '：' + row.reason);
    }
  });
  console.log('合并：知识点 ' + result.points.length + ' 个，可练题 ' + result.tasks.length + ' 道');
  if (!project) {
    console.log('');
    console.log('想把这些页面收进项目：加 --project=<项目名>（会写 notes/ 与 drafts/，草案不自动进题库）');
    return 0;
  }
  let ingested = 0;
  const artifacts = [];
  for (const row of result.results) {
    if (!row.ok || !row.text) continue;
    const one = ingestIntoProject(project, { kind: 'link', source: row.url, text: row.text }, { limit: 20 });
    if (one && one.ok !== false) {
      ingested += 1;
      (one.artifacts || []).forEach(function (file) { artifacts.push(file); });
    }
  }
  console.log('');
  console.log('已收进项目 ' + project + '：' + String(ingested) + ' 个来源，产物 ' + String(artifacts.length) + ' 个文件');
  artifacts.slice(0, 6).forEach(function (file) { console.log('  → ' + file); });
  console.log('看项目索引：node src/cli.mjs project show ' + project);
  return 0;
}
