// 语料全文检索：在项目的来源原文里搜关键词，回答"我在哪份 JD 里见过 X"。
//
// 为什么需要：115 份语料已经能画像、能按方向对比，但要查一个具体名词（"PostgreSQL"、"示波器"）
// 出现在哪儿、原话怎么说，之前只能一个个点开来源看。
//
// 口径：多词按 AND（同一行里都要出现），大小写不敏感；命中行可截前后文；
// 没有原文的老来源如实计为"未参与检索"，不假装搜过。
import { listProjects, readProject, readSourceText } from './project.mjs';

export function searchCorpus(query, options) {
  const opts = options || {};
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 20));
  const only = opts.projects && opts.projects.length ? opts.projects : null;
  const context = Math.max(0, Math.min(120, Number(opts.context) || 0));
  const mode = opts.mode === 'any' ? 'any' : 'all';
  const rows = listProjects().filter(function (row) { return !only || only.indexOf(row.name) > -1; });
  const hits = [];
  const perProject = [];
  let scannedSources = 0;
  let scannedChars = 0;
  let withoutText = 0;
  const perProjectCap = limit * 4;

  rows.forEach(function (row) {
    const meta = readProject(row.name);
    if (!meta) return;
    const hitsBefore = hits.length;
    (meta.sources || []).forEach(function (source, index) {
      if (hits.length - hitsBefore >= perProjectCap) return;
      if (!source.textFile) { withoutText += 1; return; }
      const back = readSourceText(row.name, index + 1);
      if (!back.ok || !back.text) { withoutText += 1; return; }
      scannedSources += 1;
      scannedChars += back.text.length;
      const lines = back.text.split(/\r?\n/);
      lines.forEach(function (line, lineNo) {
        if (!terms.length) return;
        if (hits.length - hitsBefore >= perProjectCap) return;
        const lower = line.toLowerCase();
        // 默认 AND（同一行都要出现，准）；--any 时按 OR（宽，用于先捞候选）
        const matched = mode === 'any'
          ? terms.some(function (term) { return lower.indexOf(term) > -1; })
          : terms.every(function (term) { return lower.indexOf(term) > -1; });
        if (!matched) return;
        let snippet = line.trim();
        if (context && snippet.length > context * 2) {
          const at = terms.map(function (term) { return lower.indexOf(term); }).filter(function (pos) { return pos > -1; })[0] || 0;
          const start = Math.max(0, at - context);
          snippet = (start > 0 ? '…' : '') + snippet.slice(start, start + context * 2) + (start + context * 2 < snippet.length ? '…' : '');
        }
        hits.push({
          project: row.name,
          displayName: row.displayName || row.name,
          sourceIndex: index + 1,
          source: source.source || ('来源 ' + (index + 1)),
          lineNo: lineNo + 1,
          line: snippet,
          terms: terms.filter(function (term) { return lower.indexOf(term) > -1; })
        });
      });
    });
    if (hits.length > hitsBefore) perProject.push({ name: row.name, displayName: row.displayName || row.name, hits: hits.length - hitsBefore });
  });

  perProject.sort(function (a, b) { return b.hits - a.hits; });
  const top = hits.slice(0, limit);
  const result = {
    query: String(query || ''),
    mode: mode,
    terms: terms,
    total: hits.length,
    shown: top.length,
    projects: perProject,
    hits: top,
    scanned: { projects: rows.length, sources: scannedSources, chars: scannedChars, withoutText: withoutText }
  };
  result.markdown = renderCorpusSearch(result);
  return result;
}

export function renderCorpusSearch(result) {
  const out = [];
  out.push('# 语料检索：' + (result.query || '（空）'));
  out.push('');
  out.push('- 命中 ' + result.total + ' 行，列出前 ' + result.shown + ' 行；检索了 ' + result.scanned.sources + ' 份来源约 ' + result.scanned.chars + ' 字');
  if (result.scanned.withoutText) out.push('- 注意：有 ' + result.scanned.withoutText + ' 份来源没有原文（旧数据），未参与检索——可跑 project backfill 补上');
  out.push('- 多词按' + (result.mode === 'any' ? '"出现任一个"（--any）' : '"同一行都要出现"') + '匹配，大小写不敏感');
  out.push('');
  if (!result.total) {
    out.push('没有命中。可以换个词，或先确认这些项目里收了带原文的来源。');
    return out.join('\n') + '\n';
  }
  out.push('## 命中分布');
  out.push('');
  result.projects.forEach(function (row) { out.push('- ' + row.displayName + '：' + row.hits + ' 行'); });
  out.push('');
  out.push('## 命中行');
  out.push('');
  out.push('| 项目 | 来源 | 行号 | 原话 |');
  out.push('| --- | --- | --- | --- |');
  result.hits.forEach(function (row) {
    out.push('| ' + row.displayName + ' | ' + row.source + ' | ' + row.lineNo + ' | ' + row.line.replace(/\|/g, '\\|') + ' |');
  });
  out.push('');
  const first = result.projects[0];
  if (first) {
    out.push('## 下一步');
    out.push('');
    out.push('- 看这个项目的全部来源：项目页 → 来源与原文（' + first.name + '）');
    out.push('- 让它出练习清单：node src/cli.mjs project jdplan ' + first.name);
  }
  return out.join('\n') + '\n';
}
