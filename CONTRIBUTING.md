# 贡献指南

欢迎 issue 与 PR。这个项目的核心约定是：**每个改动都要有可复现的证据**。

## 环境

- Node ≥ 22（在 24.19.0 上完整验证），**零运行时依赖**，不需要 `npm install`。
- macOS 才能跑原生端构建与自检（`swiftc`，来自 Xcode / Command Line Tools）；Linux 上核心与三端中的 CLI/网页可正常跑。
- 运行数据默认写 `~/.dsh-learn`，测试一律用临时目录，不要动真实 home。

## 常用命令

```bash
node --test                          # 589 条用例
node --test test/store.test.mjs      # 单个文件
node scripts/lint-unresolved.mjs     # 静态检查：用了但没声明的名字（含只再导出）
node --test test/size-budget.test.mjs test/api-contract.test.mjs \
  test/capability-matrix.test.mjs test/consistency.test.mjs   # 结构守卫
node scripts/e2e-web.mjs             # 浏览器层 e2e（29 步，临时环境，自动清理）
bash scripts/verify.sh               # 完整验收（78 项，约 4 分钟，含原生自检）
```

## 提交前自检（与 CI 一致）

1. 改完先跑**相关**用例；
2. 跑 `node scripts/lint-unresolved.mjs`（跨文件搬代码时它比全量用例快一个数量级）；
3. 跑全量 `node --test`；
4. 动过网页/路由就再跑 `node scripts/e2e-web.mjs`；
5. 动过文档数字/接口/模块表，跑对应守卫（契约、能力对照、架构模块表、题库数字）。

## 代码约定

- **分层**：`src/core` 是纯逻辑，不依赖存储与界面；存储只经 `src/store.mjs`（内部拆成 home/atomic/progress/jobs/settings）；三个客户端共享核心，不各写一份。
- **体量预算**：大文件有明确上限（见 `test/size-budget.test.mjs`）。加到线就**拆**，不要抬预算。
- **分发用表**：路由/动作是表驱动（`ACTIONS` / `ROUTES`）。加接口 = 加一行 + 一个小函数。
- **再导出要 import**：`export { x } from './y'` 不建立本地绑定；文件内部还要用就 `import` 再 `export`（守卫会拦）。
- **文档与代码对账**：接口契约、能力对照、架构模块表、题库数字都入用例，改了代码要同步文档。

## 加题 / 加包

题库是纯 JSON：`node src/cli.mjs pack new <id>` 生成骨架，`pack validate --deep` 校验（schema + 难度口径 + 样例自查满分），
写包指南见 [docs/WRITING-PACKS.md](docs/WRITING-PACKS.md)。

## 提交信息

用约定式提交，一句话说清改了什么：`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:`。
PR 请附带：改了什么、为什么、怎么验证的（贴命令与关键输出）。涉及界面的改动请附截图或 e2e 结果。
