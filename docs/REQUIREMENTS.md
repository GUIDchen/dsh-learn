# dsh-learn 需求说明

## 1. 目标与使用者

给"要动手练命令行的人"（后端/运维/测试/学生）一个**闭环练习器**：写命令 → 机器判定 → 指出缺什么 → 记录进度 → 换平台重练。

三个硬约束决定了整个设计：

1. 命令学习必须**分平台**：macOS 是 BSD 工具链 + 虚拟机里的 Docker，Linux 是 GNU 工具链 + 原生 dockerd，同一条命令写法不同、报错不同。
2. 验证必须**可执行但不危险**：学习者想看到真实输出，但工具绝不能变成一台任意命令执行器。
3. 一个学习者往往有**多台机器/多个窗口**：mac 上练、Linux 上验、浏览器里刷题，进度要合在一起。

## 2. 功能需求

| 编号 | 需求 | 验收方式 |
| --- | --- | --- |
| FR-1 | 题库以数据包（pack）形式存在，可独立增删、可外部加载 | 新增一个 pack 文件即可出现在 list 中，无需改代码 |
| FR-2 | 每道题支持平台变体（darwin/linux/win32），同一答案在不同平台得到不同判定 | 同一份 sed 命令在 darwin 通过、在 linux 判为写法错误 |
| FR-3 | 判定引擎支持要素命中与禁止写法，输出分数、档位、逐条缺失提示 | 100 分通过 / >=60 部分通过 / 其他未通过，缺失项逐条列出 |
| FR-4 | 只读验证：题目可绑定可执行验证项，默认不执行，显式开启且命中白名单才运行 | 未加 --run 时返回"未执行"；rm -rf / 被拒绝 |
| FR-5 | 多执行后端：本机只读执行、一次性 Docker 容器执行、远程 agent 代理执行 | 三种后端返回同一结构的结果对象 |
| FR-6 | 多客户端：CLI、浏览器 Web、远程 Agent 共用同一内核与同一份进度 | 三个客户端提交的记录出现在同一排行榜 |
| FR-7 | 学习计划：按轨道、平台、每日时长生成分天计划 | plan 命令输出分天安排，包含命令与验收点 |
| FR-8 | 进度可导出/导入，便于跨机迁移 | export 生成 JSON，import 合并且不丢记录 |
| FR-9 | 环境探测与诊断：平台档案、shell、Docker 上下文与守护进程状态 | probe 指出守护进程未启动并给出该平台的修复动作 |
| FR-10 | 零第三方依赖，Node >= 18 直接运行，可完全离线 | node_modules 为空也能跑通测试与全部命令 |

## 3. 非功能需求

- **安全**：默认不执行任何命令；执行必须命中只读白名单；含 ; & | > < $ 与反引号的命令一律拒绝；Web 与 Agent 默认只监听回环地址，远程调用需要 token。
- **可移植**：纯 ESM，无原生模块，macOS/Linux 同一套代码；Windows 通过 WSL2 走 Linux 路径。
- **可测试**：内核为纯函数，可脱离系统单测；有测试覆盖平台变体、判定档位、白名单拒绝、包校验。
- **可解释**：任何判定都能回答"为什么扣分"，任何探测都能回答"下一步做什么"。
- **可扩展**：加系统 = 加 profile 数据；加题型 = 加 pack 文件；加执行环境 = 加 runner。

## 4. 需求追溯（每条需求：实现 → 证据）

| 编号 | 实现 | 证据（测试文件 / 命令） |
| --- | --- | --- |
| FR-1 | core/tasks.mjs、core/packs.mjs | test/packs.test.mjs（内置包全量校验、外部包加载与覆盖） |
| FR-2 | core/judge.mjs、core/platform.mjs | test/variant-platform.test.mjs（本平台满分、跨平台判不过）、test/content.test.mjs |
| FR-3 | core/judge.mjs | test/content.test.mjs（100 / 60 / 未通过三档）、test/core.test.mjs |
| FR-4 | core/exec.mjs、core/runners.mjs | test/whitelist.test.mjs（锚定与对账）、test/runners-edge.test.mjs（危险命令拒绝） |
| FR-5 | core/runners.mjs | test/runners.test.mjs（三后端同结构）、test/runners-edge.test.mjs（超时/降级） |
| FR-6 | src/store.mjs、src/web/api.mjs、app/macos | test/consistency.test.mjs（CLI 与 Web 同数字）、app/macos/selftest.swift（原生 87 条断言） |
| FR-7 | core/plan.mjs | test/plan.test.mjs、node src/cli.mjs plan --hours=2 |
| FR-8 | src/store.mjs | test/store.test.mjs（记录 + 笔记 + 目标整份往返）、test/cli.test.mjs |
| FR-9 | core/platform.mjs、src/cli/commands/verify.mjs | test/cli-commands.test.mjs、node src/cli.mjs probe --run |
| FR-10 | 全仓 | test/coverage.test.mjs（依赖与覆盖率门槛）、bash scripts/verify.sh（72 步端到端） |

上表由 test/consistency.test.mjs 的守卫看着：表里提到的每个测试文件都必须真实存在，写错就红。

## 5. 当前验收状态（实测数字，随每轮发布更新）

- 测试：**node --test 303 项全绿**（2026-09-27 / 0.66.0 实测）
- 端到端：**bash scripts/verify.sh PASS 72 / FAIL 0**
- 题库：**637 题 / 55 个包 / 25 条轨道**，难度 简单 172 / 中等 400 / 困难 65；平台变体 50 道 / 135 份变体样本（darwin 47 / linux 47 / win32 41）；平台缺口 0（另有 9 道题显式声明 platforms，只在自己成立的平台上参与体检）
- 知识点字典：146 个知识点 / 25 个模块；audit 双向对账 **0 提醒**
- 多客户端：CLI / 网页版（可离线）/ 原生 macOS App / 远程 agent 共用一份进度，跨客户端一致性由测试钉住
- macOS 实测：BSD 工具链探针全通过；原生自检 87 条断言（真跑本地引擎 HTTP）
- Linux 容器回归：**未完成**（镜像仓库拉不动，本地无 Node 镜像）；Windows 真机回归：**未完成**（探针已就绪）

## 6. 范围外（明确不做）

- 不做任意命令执行沙箱，不提供交互式 shell 接管。
- 不做账号体系与云端同步；进度以本地文件为准。
- 不做题库的在线商店；包以文件分发。
