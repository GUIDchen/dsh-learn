// 可选模型：看配置状态（默认离线；配了端点就是"模型 + 规则回退"）。
import { modelStatus } from '../../core/model.mjs';

export async function model(ctx) {
  const { asJson, out } = ctx;
  const status = modelStatus();
  if (asJson) { out({ ok: true, model: status }); return 0; }
  console.log('模式：' + status.mode);
  if (status.enabled) {
    console.log('端点：' + status.endpoint);
    console.log('模型：' + status.model);
    console.log('Key：' + (status.hasKey ? '已提供（不回显）' : '未提供'));
    console.log('超时：' + status.timeoutMs + 'ms');
  }
  console.log(status.hint);
  console.log('');
  console.log('跑对比：node scripts/benchmark.mjs（固定评测集 → docs/BENCHMARK.md）');
  return 0;
}
