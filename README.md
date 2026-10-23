# dsh-learn

> 把「我看过这个命令」变成「机器判定过我会用这个命令」。
> 跨平台运维 / 后端 / 基础设施的**练习与判定**工具：25 条轨道、637 道题，同一份判定内核跑在 **CLI、网页版、macOS 桌面 App、远程 agent** 四个客户端上。

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![node](https://img.shields.io/badge/node-%E2%89%A522-339933.svg)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)
![tests](https://img.shields.io/badge/tests-589%20passing-brightgreen.svg)

---

## 30 秒了解

面试准备常见的三个动作——背题、看视频、收藏文档——都不能回答一个问题：**这道命令你到底会不会敲，而且敲得对不对？**

dsh-learn 把每道题拆成五件事：**目标**、**判定要素**（必须出现的函数 / 参数 / 顺序）、**禁止写法**、**参考答案**、**可选的只读验证命令**。你写命令，它逐条告诉你缺什么；分数与历史最好成绩都留在本地。

    $ node src/cli.mjs list --track=docker --level=easy
    $ node src/cli.mjs check docker.prune-system "docker system prune -af"
    $ node src/cli.mjs progress

没有账号、没有服务端、没有模型调用——判定是纯本地的规则引擎。

## 为什么不是又一个题库

| 常见题库 | dsh-learn |
| --- | --- |
| 选择题、看答案 | **写命令**，逐要素判定，指出缺了哪个参数 |
| 只有一套标准答案 | 同一题可有**平台变体**：macOS / Linux / Windows 写法不同，按选定平台判 |
| 答完就结束 | 记录 attempts、历史最好、掌握度、间隔重复复习、每日目标与趋势 |
| 只能用网页 | CLI / 网页 / macOS App / 远程 agent 共用一份进度 |
| 要联网 | 判定、题库、知识点、OCR（macOS）全部本地；网页版离线可练、恢复后自动同步 |

## 特性

- **判定内核可离线复现**：判定规则随题库一起下发，网页版断网也能判；判定结果给出与历史最好的对比。
- **平台变体**：47 条 darwin、47 条 linux、41 条 win32 变体样本；不适用的题（如 launchctl 之于 Windows）只展示不判分。
- **从岗位描述出题**：粘贴 JD / 截图 OCR（macOS 走系统 Vision）/ 链接，得到命中知识点、对应题目与一条可开练的清单。
- **从项目与仓库出题**：\`project init/add\`、\`learn-repo\` 识别 Dockerfile / compose / k8s / CI / Makefile 等技术信号，抽出命令草案（人工复核后才进题库）。
- **求职闭环**：学习 → 项目解析 → 简历 → 搜集招聘 → 按岗位补知识点 → 岗位推荐 → 投递记录与跟进（七步，状态从真实数据推出）。
- **可选模型接入**：OpenAI 兼容端点 + 自带 key；**默认关闭**，任何失败都回退本地规则引擎（见 [docs/BENCHMARK.md](docs/BENCHMARK.md)）。
- **零依赖**：package.json 里没有 dependencies，只有 Node 标准库。

## 快速开始

> 需要 Node ≥ 22（在 24.19.0 上完整验证）。不需要 npm install。

```bash
git clone https://github.com/GUIDchen/dsh-learn.git && cd dsh-learn

# 1) 看看题库（25 条轨道 / 637 道题）
node src/cli.mjs list --track=docker

# 2) 练一道：写命令 → 逐要素判定
node src/cli.mjs check docker.prune-system "docker system prune -af"

# 3) 看进度、连续天数与今日目标
node src/cli.mjs progress
node src/cli.mjs scorecard --days=14
```

**网页版**（默认只监听回环，三栏界面 + PWA + 离线判定）：

```bash
node src/web/server.mjs            # http://127.0.0.1:8787
```

**macOS 桌面 App**（原生 SwiftUI + 本地引擎，不嵌 WebView）：

```bash
bash app/macos/build.sh && open dist/dsh-learn.app
```

**完整验收**（用例 + 题库体检 + 三端冒烟 + 原生自检，约 4 分钟）：

```bash
bash scripts/verify.sh
```

## 它怎么工作

```
src/core/     纯逻辑：判定、题库、知识点、平台变体、检索、计划、成绩单、可选模型…
src/store/    本地存储：进度快照+日志、投递、偏好、笔记（原子写 + 写锁 + 损坏留档）
src/cli/      命令行客户端（26 个子命令）
src/web/      网页版服务端（保序路由表 + 按域拆分的路由模块）
web/          浏览器端模块（面板 / 命令面板 / 深浅色 / i18n / 趋势 / 提醒）
app/macos/    原生客户端（SwiftUI，显式文件清单编译）
scripts/      发布、验收、题库审计、浏览器 e2e、基准…
test/         589 条用例
```

分层规则：\`core\` 不依赖存储与界面；存储是唯一读写入口；三个客户端只通过核心模块与 HTTP 共享逻辑。
细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（每个模块一句职责）。

## 质量保障

这个项目的每一轮改动都必须留下**可复现的证据**：

- **589 条用例**：\`node --test\`，覆盖判定、平台变体、存储并发（20→400 写入者零丢失）、故障注入（只读目录 / 坏 JSON / 陈旧锁 / 目录占位）、API 契约、能力对照、体量预算。
- **78 项验收**：\`bash scripts/verify.sh\`，含语法体检、题库审计、三端冒烟、浏览器层 e2e（29 步）、原生客户端自检。
- **静态守卫**：漏 import、体量预算、文档与代码对账（API 契约 / 三端能力对照 / 架构模块表 / 题库数字）。
- **可复现基准**：[docs/BENCHMARK.md](docs/BENCHMARK.md) 用固定评测集对比规则引擎与可选模型。
- **工程日志**：[docs/COMPLETION-REPORT.md](docs/COMPLETION-REPORT.md) 逐轮记录做了什么、踩了什么坑、怎么验证的（分卷在 [docs/report/](docs/report/)）。

## 题库规模

25 条轨道、637 道题（简单 172 / 中等 400 / 困难 65），55 个数据包，另有 126 道平台变体题（darwin 47 / linux 47 / win32 41）。
题库是纯 JSON，加载即校验；自己写包见 [docs/WRITING-PACKS.md](docs/WRITING-PACKS.md)，用 \`DSH_LEARN_PACKS=/path/to/packs\` 加载外部包。

## 数据与隐私

- **不随仓库发布**：\`docs/evidence/\`（界面截图，含本机数据）与 \`docs/samples/boss/\`（真实抓取的岗位原文，第三方站点内容）。它们只用于本地验收记录。
- **运行数据只在本机**：默认写入 \`~/.dsh-learn\`；可用 \`DSH_LEARN_HOME\` 改到别处。整机备份/恢复与存储迁移都有 \`--dry-run\`。
- **可选模型默认关闭**：不配置端点就不会有任何外部请求；key 只从环境变量读，不落盘。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/GUIDE.md](docs/GUIDE.md) | 完整使用手册（命令、网页版、原生端、题库写作、故障排查） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层与模块职责表 |
| [docs/API.md](docs/API.md) | HTTP 接口（42 路由 / 23 action，由脚本生成） |
| [docs/CAPABILITIES.md](docs/CAPABILITIES.md) | 三端能力对照（CLI / 网页 / 原生） |
| [docs/PROGRESS.md](docs/PROGRESS.md) | 当前进度与阶段计划（脚本生成） |
| [docs/COMPLETION-REPORT.md](docs/COMPLETION-REPORT.md) | 逐轮工程日志（分卷索引） |
| [docs/BENCHMARK.md](docs/BENCHMARK.md) | 可选模型 vs 规则引擎的固定评测集对比 |
| [docs/WRITING-PACKS.md](docs/WRITING-PACKS.md) | 自己写题库包（含 \`pack new\` / 深校验） |

## 贡献

欢迎 issue 与 PR。开发约定、测试与守卫命令、提交风格见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © 2026 GUIDchen

---

## English summary

**dsh-learn** is a cross-platform, offline-first practice-and-verify tool for command-line skills in infrastructure, ops and backend interviews.

Each exercise is a *task* with a goal, graded elements (functions/flags/ordering that must appear), forbidden patterns, a reference answer and an optional read-only verification command. You type a command; the local rule engine tells you exactly what is missing, keeps your attempts and best score, schedules spaced repetition and tracks daily goals.

**Highlights**: 637 tasks across 25 tracks (172 easy / 400 medium / 65 hard) with platform variants (darwin 47 / linux 47 / win32 41); one core shared by a CLI, a web client (three-column UI, PWA, offline grading) and a native macOS SwiftUI app; zero runtime dependencies; everything local (judge, catalog, knowledge base, OCR via Apple Vision); optional OpenAI-compatible model integration that is **off by default** and always falls back to the rule engine.

**Verify it**: \`node --test\` (589 tests) and \`bash scripts/verify.sh\` (78 checks, incl. browser e2e and native self-test). Engineering log: [docs/COMPLETION-REPORT.md](docs/COMPLETION-REPORT.md).

MIT licensed.
