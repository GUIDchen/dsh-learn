# 可选模型接入 · 评测对比（docs/BENCHMARK.md）

这份表格由 scripts/benchmark.mjs 生成，用例固定在 docs/benchmark-cases.json（6 条），两条链路跑同一套用例：**规则引擎**（永远可用、离线）与**可选模型**（配了端点才跑，失败自动回退规则）。

## 运行环境

| 项 | 值 |
| --- | --- |
| 平台 | darwin arm64 |
| Node | v24.19.0 |
| 模型配置 | **未配置**（本机不做任何外部调用） |
| 评测时间 | 2026-09-28T16:33:59.499Z |

## 汇总

| 链路 | 字段命中 | 准确率 | 中位耗时 |
| --- | --- | --- | --- |
| 规则引擎（本地） | 13 / 22 | 59.1% | 1ms |
| 可选模型 | —— | —— | —— |

> 本机**没有配置模型端点**，所以模型那一列是空的——这是如实记录，不是"跑过但数字不好看"。要出这一列：

>     export DSH_LEARN_MODEL_ENDPOINT=https://your-host/v1   # OpenAI 兼容的 /chat/completions
>     export DSH_LEARN_MODEL_NAME=your-model
>     export DSH_LEARN_MODEL_KEY=sk-…                        # 只从环境变量读，不写进任何文件
>     node scripts/benchmark.mjs

## 逐条明细（规则引擎）

| 用例 | 字段命中 | 耗时 | 来源 | 备注 |
| --- | --- | --- | --- | --- |
| go-ops | 2 / 4 | 9ms | rules | 未配置模型端点 |
| k8s-sre | 2 / 4 | 8ms | rules | 未配置模型端点 |
| python-data | 2 / 4 | 1ms | rules | 未配置模型端点 |
| linux-ops | 3 / 4 | 0ms | rules | 未配置模型端点 |
| net-eng | 3 / 4 | 0ms | rules | 未配置模型端点 |
| db-pg | 1 / 2 | 1ms | rules | 未配置模型端点 |

## 逐条明细（可选模型）

（未配置模型端点，跳过。配置方式见上。）

## 设计取舍

1. **默认离线**：没配端点时不产生任何外部请求；模型只是"可选增强"，不是依赖。
2. **一定回退**：超时 / 非 200 / 返回不是 JSON / 字段缺失，全部回退规则引擎，并把原因带回来（表格里的"来源"列就是它）。
3. **key 不进仓库**：只读环境变量；落盘文本里不出现 key（这份表里只写"带 key / 无 key"）。
4. **同字段名**：模型提示词要求与规则引擎同名（title/company/location/salary/education/stack/points），否则对比没有意义。
