// 固定评测集跑分：规则引擎（永远跑）与可选模型（配置了才跑）用同一套用例，
// 结果写成 docs/BENCHMARK.md。key 只从环境变量读，落盘与打印都不回显。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { modelConfig, modelStatus, understandWithModel } from '../src/core/model.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const suite = JSON.parse(readFileSync(join(ROOT, 'docs/benchmark-cases.json'), 'utf8'));

function norm(value) { return String(value === undefined || value === null ? '' : value).trim().toLowerCase(); }

function scoreCase(result, expect) {
  const hits = [];
  Object.keys(expect || {}).forEach(function (field) {
    if (field === 'stack') {
      const wanted = expect.stack.map(norm);
      const got = (result.stack || []).map(norm);
      const hit = wanted.filter(function (w) { return got.some(function (g) { return g.indexOf(w) > -1 || w.indexOf(g) > -1; }); }).length;
      hits.push({ field: 'stack', ok: hit === wanted.length, detail: hit + '/' + wanted.length });
      return;
    }
    const ok = norm(result[field]) === norm(expect[field]) && norm(expect[field]) !== '';
    hits.push({ field: field, ok: ok, detail: norm(result[field]) || '（空）' });
  });
  const passed = hits.filter(function (row) { return row.ok; }).length;
  return { hits: hits, passed: passed, total: hits.length, rate: hits.length ? passed / hits.length : 0 };
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort(function (a, b) { return a - b; });
  return sorted[Math.floor(sorted.length / 2)];
}

async function runEngine(label, options) {
  const rows = [];
  const latencies = [];
  for (const item of suite.cases) {
    const started = Date.now();
    const out = await understandWithModel(item.text, options);
    const ms = Date.now() - started;
    latencies.push(ms);
    const score = scoreCase(out.understood || {}, item.expect || {});
    rows.push({ id: item.id, source: out.source, reason: out.reason, ms: ms, score: score });
  }
  const totalPassed = rows.reduce(function (sum, row) { return sum + row.score.passed; }, 0);
  const totalFields = rows.reduce(function (sum, row) { return sum + row.score.total; }, 0);
  return {
    label: label,
    rows: rows,
    passed: totalPassed,
    fields: totalFields,
    accuracy: totalFields ? Number((totalPassed / totalFields).toFixed(3)) : 0,
    p50ms: median(latencies)
  };
}

const cfg = modelConfig();
const rules = await runEngine('规则引擎（本地）', { model: false });
const model = cfg.enabled ? await runEngine('可选模型（' + cfg.model + '）', {}) : null;
const status = modelStatus();

const out = [];
out.push('# 可选模型接入 · 评测对比（docs/BENCHMARK.md）');
out.push('');
out.push('这份表格由 scripts/benchmark.mjs 生成，用例固定在 docs/benchmark-cases.json（' + suite.cases.length + ' 条），两条链路跑同一套用例：**规则引擎**（永远可用、离线）与**可选模型**（配了端点才跑，失败自动回退规则）。');
out.push('');
out.push('## 运行环境');
out.push('');
out.push('| 项 | 值 |');
out.push('| --- | --- |');
out.push('| 平台 | ' + process.platform + ' ' + process.arch + ' |');
out.push('| Node | ' + process.version + ' |');
out.push('| 模型配置 | ' + (status.enabled ? ('已配置：' + status.endpoint + '（模型 ' + status.model + '，' + (status.hasKey ? '带 key' : '无 key') + '）') : '**未配置**（本机不做任何外部调用）') + ' |');
out.push('| 评测时间 | ' + new Date().toISOString() + ' |');
out.push('');
out.push('## 汇总');
out.push('');
out.push('| 链路 | 字段命中 | 准确率 | 中位耗时 |');
out.push('| --- | --- | --- | --- |');
out.push('| ' + rules.label + ' | ' + rules.passed + ' / ' + rules.fields + ' | ' + (rules.accuracy * 100).toFixed(1) + '% | ' + rules.p50ms + 'ms |');
if (model) {
  out.push('| ' + model.label + ' | ' + model.passed + ' / ' + model.fields + ' | ' + (model.accuracy * 100).toFixed(1) + '% | ' + model.p50ms + 'ms |');
} else {
  out.push('| 可选模型 | —— | —— | —— |');
  out.push('');
  out.push('> 本机**没有配置模型端点**，所以模型那一列是空的——这是如实记录，不是"跑过但数字不好看"。要出这一列：');
  out.push('');
  out.push('>     export DSH_LEARN_MODEL_ENDPOINT=https://your-host/v1   # OpenAI 兼容的 /chat/completions');
  out.push('>     export DSH_LEARN_MODEL_NAME=your-model');
  out.push('>     export DSH_LEARN_MODEL_KEY=sk-…                        # 只从环境变量读，不写进任何文件');
  out.push('>     node scripts/benchmark.mjs');
}
out.push('');
out.push('## 逐条明细（规则引擎）');
out.push('');
out.push('| 用例 | 字段命中 | 耗时 | 来源 | 备注 |');
out.push('| --- | --- | --- | --- | --- |');
rules.rows.forEach(function (row) {
  out.push('| ' + row.id + ' | ' + row.score.passed + ' / ' + row.score.total + ' | ' + row.ms + 'ms | ' + row.source + ' | ' + (row.reason || '') + ' |');
});
out.push('');
out.push('## 逐条明细（可选模型）');
out.push('');
if (model) {
  out.push('| 用例 | 字段命中 | 耗时 | 来源 | 备注 |');
  out.push('| --- | --- | --- | --- | --- |');
  model.rows.forEach(function (row) {
    out.push('| ' + row.id + ' | ' + row.score.passed + ' / ' + row.score.total + ' | ' + row.ms + 'ms | ' + row.source + ' | ' + (row.reason || '') + ' |');
  });
} else {
  out.push('（未配置模型端点，跳过。配置方式见上。）');
}
out.push('');
out.push('## 设计取舍');
out.push('');
out.push('1. **默认离线**：没配端点时不产生任何外部请求；模型只是"可选增强"，不是依赖。');
out.push('2. **一定回退**：超时 / 非 200 / 返回不是 JSON / 字段缺失，全部回退规则引擎，并把原因带回来（表格里的"来源"列就是它）。');
out.push('3. **key 不进仓库**：只读环境变量；落盘文本里不出现 key（这份表里只写"带 key / 无 key"）。');
out.push('4. **同字段名**：模型提示词要求与规则引擎同名（title/company/location/salary/education/stack/points），否则对比没有意义。');
out.push('');
writeFileSync(join(ROOT, 'docs/BENCHMARK.md'), out.join(String.fromCharCode(10)));

if (process.argv.indexOf('--json') > -1) {
  console.log(JSON.stringify({ rules: { accuracy: rules.accuracy, p50ms: rules.p50ms }, model: model ? { accuracy: model.accuracy, p50ms: model.p50ms } : null, status: status }, null, 2));
} else {
  console.log('规则引擎：' + rules.passed + '/' + rules.fields + '（' + (rules.accuracy * 100).toFixed(1) + '%），中位 ' + rules.p50ms + 'ms');
  console.log('可选模型：' + (model ? (model.passed + '/' + model.fields + '（' + (model.accuracy * 100).toFixed(1) + '%）') : '未配置，跳过'));
  console.log('已写入 docs/BENCHMARK.md');
}
