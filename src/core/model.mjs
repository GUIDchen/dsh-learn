// 可选模型接入：插件式 HTTP 端点 + 自带 key + 规则引擎回退。
//
// 三条硬规矩：
//   1. **默认关闭**：只有显式配置了端点（DSH_LEARN_MODEL_ENDPOINT）才会调用任何外部服务；
//      没配就是纯本地规则引擎（core/understand.mjs）——这是本项目的离线主张，不能因为"接了模型"就变。
//   2. **key 不进仓库**：只从环境变量读（DSH_LEARN_MODEL_KEY），任何文档与日志都不回显它。
//   3. **一定回退**：超时、非 200、JSON 不合法、字段缺失，任何一步出错都退回规则引擎，并把原因带回调用方。
//
// 端点是 OpenAI 兼容的 /chat/completions（自己搭的、或任何兼容服务都行）。
import { understandText as ruleUnderstand } from './understand.mjs';

export function modelConfig(env) {
  const e = env || process.env;
  const endpoint = String(e.DSH_LEARN_MODEL_ENDPOINT || '').trim();
  return {
    endpoint: endpoint,
    model: String(e.DSH_LEARN_MODEL_NAME || 'local-model').trim(),
    apiKey: String(e.DSH_LEARN_MODEL_KEY || '').trim(),
    timeoutMs: Math.max(1000, Number(e.DSH_LEARN_MODEL_TIMEOUT_MS) || 20000),
    enabled: Boolean(endpoint)
  };
}

export function modelStatus(env) {
  const cfg = modelConfig(env);
  return {
    enabled: cfg.enabled,
    endpoint: cfg.endpoint || null,
    model: cfg.enabled ? cfg.model : null,
    hasKey: Boolean(cfg.apiKey),
    timeoutMs: cfg.timeoutMs,
    mode: cfg.enabled ? 'model+rules 回退' : '仅规则引擎（离线）',
    hint: cfg.enabled ? '已配置外部模型；失败会自动回退规则引擎' : '设置 DSH_LEARN_MODEL_ENDPOINT / _NAME / _KEY 可启用可选模型，未配置则全部本地规则'
  };
}

const PROMPT_HEAD = '你是岗位描述结构化抽取器。只输出 JSON 对象，不要解释。字段与规则引擎同名：title(岗位名)、company、location(城市)、salary、education、stack(技术栈字符串数组，最多 12 个)、points(知识点数组，最多 12 个)。文本：';

export function buildModelRequest(text, cfg) {
  return {
    url: cfg.endpoint.replace(/\/$/, '') + (cfg.endpoint.indexOf('/chat/completions') > -1 ? '' : '/chat/completions'),
    body: {
      model: cfg.model,
      temperature: 0,
      messages: [
        { role: 'system', content: '只输出 JSON。' },
        { role: 'user', content: PROMPT_HEAD + String(text || '').slice(0, 4000) }
      ]
    }
  };
}

// 把模型返回的 JSON 转成与规则引擎同形状的结构（缺字段就用规则结果补，绝不返回半个对象）
export function mergeModelResult(raw, fallback) {
  const base = fallback || {};
  const pick = function (key) {
    const value = raw && raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length) return value.map(function (x) { return String(x); });
    return base[key];
  };
  return {
    title: pick('title'),
    company: pick('company'),
    location: pick('location'),
    salary: pick('salary'),
    education: pick('education'),
    stack: pick('stack') || [],
    points: pick('points') || []
  };
}

function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (err) { return null; }
}

// 主入口：模型可用就用模型，任何问题都回退规则引擎；返回值里如实带 source 与原因
export async function understandWithModel(text, options) {
  const opts = options || {};
  const cfg = modelConfig(opts.env);
  const started = Date.now();
  const ruleResult = ruleUnderstand(text);
  if (!cfg.enabled || opts.model === false) {
    return { understood: ruleResult, source: 'rules', model: null, ms: Date.now() - started, reason: cfg.enabled ? '调用方选择只用规则' : '未配置模型端点' };
  }
  const req = buildModelRequest(text, cfg);
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, cfg.timeoutMs);
  try {
    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey;
    const res = await fetch(req.url, { method: 'POST', headers: headers, body: JSON.stringify(req.body), signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const payload = await res.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
    const raw = extractJson(content);
    if (!raw) throw new Error('返回内容里没有可解析的 JSON');
    const merged = mergeModelResult(raw, ruleResult);
    return { understood: merged, source: 'model', model: cfg.model, ms: Date.now() - started, reason: null };
  } catch (err) {
    return { understood: ruleResult, source: 'rules', model: cfg.model, ms: Date.now() - started, reason: '模型不可用（' + (err.message || err) + '），已回退规则引擎' };
  } finally {
    clearTimeout(timer);
  }
}
