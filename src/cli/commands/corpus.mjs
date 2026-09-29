// 语料检索：在项目来源原文里搜关键词（跨项目）。
// 与网页版/原生端共用 core/corpus.mjs，口径一致。
import { searchCorpus } from '../../core/corpus.mjs';
import { writeFileSync } from 'node:fs';

export async function corpus(ctx) {
  const { args, out, asJson } = ctx;
  const query = String(args._[1] || args.q || '').trim();
  if (!query) throw new Error('用法：node src/cli.mjs corpus <关键词…> [--project=名字] [--any] [--limit=20] [--json] [--out=结果.md]');
  const projects = String(args.project || '').split(',').map(function (row) { return row.trim(); }).filter(Boolean);
  const opts = {
    limit: Number(args.limit) || 20,
    mode: args.any ? 'any' : 'all',
    projects: projects,
    context: Number(args.context) || 0
  };
  const result = searchCorpus(query, opts);
  if (asJson) { out(result); return 0; }
  if (typeof args.out === 'string' && args.out.trim()) {
    writeFileSync(args.out, result.markdown);
    console.log('已写入 ' + args.out + '（' + result.markdown.length + ' 字）');
  }
  console.log(result.markdown);
  return 0;
}
