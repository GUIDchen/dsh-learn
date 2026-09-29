# 性能实测

> 这里的数字都是**本机实测**（macOS 26.5.1 arm64 / Node v24.19.0），不是估算。每条都给出可复现的命令。

## 知识点分析（analyzeText）

167 个知识点、957 条匹配规则；来源原文 115 份 / 约 9.5 万字。

| 场景 | 优化前 | 优化后 | 说明 |
| --- | --- | --- | --- |
| analyzeText 全部来源（首次） | 77ms | **53ms** | 首次要编译 957 条正则 |
| analyzeText 全部来源（再次） | 77ms | **35ms** | 编译缓存命中，只剩匹配 |
| doctor 冷启动 | 133ms | **86ms** | 项目体检会重算所有来源 |
| doctor 第二次 | 74ms | **53ms** | 进程内缓存复用 |

做法：matcher() 增加**编译缓存**（同一条 pattern 只 new RegExp 一次）。

实测中我还试过「先 indexOf 再 exec」的前置过滤，结果**更慢**（55ms vs 37ms）——逐条扫长文本并不比 V8 优化过的字面量正则便宜，已回退。

复现（把下面的命令原样粘到终端）：

~~~bash
node --input-type=module -e "import { runDoctor } from './src/core/doctor.mjs'; const t0=Date.now(); runDoctor({}); const t1=Date.now(); runDoctor({}); console.log('cold '+(t1-t0)+'ms warm '+(Date.now()-t1)+'ms');"
~~~

正确性：与**发布版实现**逐份比对 115 份来源的分析结果，**0 份不一致**；全库体检仍 0 提醒。

## 其他已优化的热点

| 场景 | 优化前 | 优化后 | 手段 |
| --- | --- | --- | --- |
| 语料全文检索（跨项目） | 44ms | **9ms** | 原文按文件指纹缓存（core/cache.mjs） |
| 岗位描述 → 练习清单（226 份语料） | 188ms | **33ms** | 同上 + 计划缓存 |
| 项目列表（11 个项目） | 11ms | 11ms | 已是纯目录读 |

## 怎么自己量

~~~bash
node src/cli.mjs doctor            # 体检耗时可以用 time 包起来
node scripts/coverage.mjs --record # 覆盖率趋势见 docs/coverage.md
~~~
