# dsh-learn 架构

## 1. 分层

    ┌────────────────────────── 客户端层 ──────────────────────────────┐
    │  CLI (src/cli.mjs)   Web/PWA (src/web + web/)                      │
    │  Agent (src/agent.mjs)   macOS App (app/macos，原生 SwiftUI 客户端)  │
    └───────┬──────────────────────┬───────────────────────┬───────────┘
            │                      │                       │
    ┌───────▼──────────────────────▼───────────────────────▼──────────┐
    │                        服务层（Node 专属）                        │
    │  packs.mjs 包加载   runners.mjs 执行后端   store.mjs 进度落盘      │
    │  exec.mjs 只读白名单执行器                                        │
    └───────┬──────────────────────────────────────────────┬──────────┘
            │                                              │
    ┌───────▼──────────────── 纯内核（无系统 API） ─────────▼──────────┐
    │  schema.mjs 包校验   judge.mjs 判定   platform.mjs 平台档案        │
    │  plan.mjs 计划生成   progress.mjs 进度聚合   args.mjs 参数解析     │
    └──────────────────────────────┬──────────────────────────────────┘
                                   │
                            ┌──────▼──────┐
                            │ packs/*.json │  题库数据（可外部加载）
                            └─────────────┘

分层规则：
- **纯内核**只做数据变换，不 import node: 前缀，浏览器可直接复用（判定逻辑现在就是被 Web 服务端调用的同一份）。
- **服务层**才允许碰文件系统、进程与网络。
- **客户端层**只负责交互与展示，不重复实现判定。

## 2. 模块职责

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| core/schema.mjs | 校验 pack 与 task 的形状：id 唯一、要素非空、正则可编译、验证命令在白名单内 | 无 |
| core/judge.mjs | 平台变体解析 + 要素匹配 + 禁止项扣分 + 档位判定 | platform.mjs |
| core/platform.mjs | 平台档案：工具链、shell、Docker 运行时、诊断动作、注意事项 | 无 |
| core/plan.mjs | 把题库编排成分天学习计划（按轨道、平台、每日时长） | 无 |
| store/home.mjs | **存储位置与取值域的唯一来源**：HOME 解析、progress/jobs/goals/notes/preferences 的文件名、主题与语言取值域。拆出来是因为 6 个域都要用它，放最底层避免互相依赖 |
| store/atomic.mjs | **原子写与写锁**：readJsonFile / writeJsonAtomic（临时文件 + rename）/ quarantine（坏文件留档）/ parseRecords / withCompactLock。三个域共用，所以在 home 之上、业务之下 |
| store/progress.mjs | **进度域**：progress.json 快照（原子替换 + .bak 回退 + 坏文件留档）、progress.ndjson 追加日志、200 条阈值归档、storageHealth、board |
| store/settings.mjs | **偏好 / 目标 / 笔记**：preferences.json、goals.json、notes.json 三份小存储，同一套原子写 |
| store/jobs.mjs | **投递域存储**：jobs.json 快照 + jobs.ndjson 操作日志（upsert 幂等、500 条阈值归档、与进度同一套写锁）；名字在 store.mjs 再导出 |
| store.mjs | **存储对外的唯一入口**：组合层（导出/导入/迁移/reset）+ barrel。五个子模块（home/atomic/progress/jobs/settings）的名字在这里 import 并原样再导出，24 个调用方零改动 |
| core/progress.mjs | 进度聚合：完成度、薄弱题、多客户端排行榜 | 无 |
| core/args.mjs | 统一的 --key value / --key=value / --flag 解析 | 无 |
| core/packs.mjs | 读取 packs/*.json，校验并合并为任务表 | fs + schema |
| core/exec.mjs | 只读白名单执行器：dry-run 默认、白名单校验（条目带 id/归属/示例）、失败诊断、白名单与题库对账 auditWhitelist | child_process |
| core/runners.mjs | 执行后端注册表：local / docker / remote，统一结果结构 | exec + agent 协议 |
| store.mjs | 进度存储：快照原子写 + 追加日志 + 备份回退、排行榜、导入导出 | fs |
| agent.mjs | 把一台机器变成只读 runner，供远程调度（需 token） | http + exec |
| app/macos/main.swift | 客户端外壳：窗口、菜单、App Nap 抑制与生命周期 | AppKit |
| app/macos/Engine.swift | 引擎侧：找 node/项目目录、自己挑空闲端口拉起服务、bootstrap/check/history/progress 的 HTTP 客户端 | Foundation |
| app/macos/NativeUI.swift | 原生三栏界面（题单 / 作答 / 判定结果），状态集中在 Store | SwiftUI |
| app/macos/selftest.swift | 客户端接口自检：跑一遍真实链路，verify.sh 每次执行 | Foundation |
| cli/context.mjs | CLI 参数解析与公共工具（out / requireTask / usage），命令实现不互相 import | args + platform |
| cli/commands/*.mjs | 命令实现按主题分文件：tasks / verify / learn / store / packs，统一签名 (ctx) → 退出码 | 各 core 模块 |
| web/static.mjs | 静态资源：网页外壳、PWA 资源、判定内核模块 | fs |
| web/api.mjs | 所有 /api/* 实现，与 HTTP 外壳解耦 | core + store |
| web/routes/project.mjs | **项目域分发器（42 行）**：GET 交给 handleProjectGet、POST 查 ACTIONS 表；动作实现搬到 project-actions.mjs |
| web/routes/project-actions.mjs | **项目域动作实现**（从 336 行的 if 链接出来）：delete/tasks/index/refresh/jdplan/drill/backfill/rename/import/init + 默认 add（收来源）+ GET 分支；加接口只改这里一行 |
| web/routes/jobs.mjs | **投递域路由**（/api/jobs 增改删查 + /api/analyze JD 分析）：与 project 路由同一套「整域移交 + 返回是否已响应」约定 |
| web/routes/flow.mjs | **流程域路由**（七步闭环：状态/简历/推荐/搜集/投递/题包/建计划）+ 只被它使用的三个装载函数（进度 + 项目 + 岗位三份数据） |
| web/routes/research.mjs | **调研/理解域路由**（survey / describe / ocr / understand / search / research）：搜到 → 抓回 → 抽知识点与草案，OCR 走系统 Vision |
| web/routes/learn.mjs | **学习核心域路由**（bootstrap / drill / history / board / progress / daily / report / plan / import / export / check / verify / runners）：判定与验证走 core/judge.mjs 与 core/exec.mjs，离线判分靠下发 bootstrap 规则 |
| web/routes/ops.mjs | **运维域路由**（存储 schema 状态与迁移、整机备份与恢复、运行指标 /api/metrics、首次运行引导 /api/onboarding）：api.mjs 超预算后按域拆出的第五块 |
| core/trust.mjs | 外部题库包的信任模型：HMAC 签名、哈希锁定（TOFU）、加载门禁 | crypto + fs |
| core/selftest.mjs | 平台自检：把题库里的 BSD/GNU 假设拿到当前主机逐条实测 | child_process |
| core/tasks.mjs | 题库门面：对外只暴露任务表与查询（数据来自 packs/*.json），外部包目录可用 DSH_LEARN_PACKS 覆盖同 id 内置题 | packs + schema |
| core/catalog-audit.mjs | 题库质量体检：参考答案必须在自己平台满分、变体要有区分度、难度标注与口径一致、每道题挂在知识点上；另给"薄轨道"扩充建议 | judge + knowledge |
| core/knowledge.mjs | 知识点字典与分析器：把 JD / 文档 / 截图文字映射到知识点，再映射到题；命中带依据词，纯本地零依赖 | 无 |
| core/flow.mjs | 求职学习闭环：七步状态（学习 / 项目 / 简历 / 搜集 / 补知识点 / 推荐 / 投递）全部由真实数据推出；岗位匹配度 = 这道 JD 能练的题里已通过多少，差的题就是补课清单 | resume + jobs + progress |
| core/stack.mjs | **含只调研不出题白名单**（ANNOTATE_ONLY：硬件与电路 / 国产 AI 芯片 / 云控制台 / AI 编程助手，每条写明原因与替代建议）。技术栈抽取：15 个类别的词库（语言/容器编排/CI-CD/监控/IaC/数据库/中间件/网关/网络排障/安全/云/数据 AI…），每项带原文依据、命中知识点、可练题数、是否覆盖；并用 OCR 归一化（GitLab Cl → CI 之类）补截图路线的识别误差 | knowledge |
| core/survey.mjs | 多岗位调研：把 N 份岗位要求聚合成热度排行（出现岗位数）、跨岗位通用技能（≥50%）、缺口（字典未覆盖）与行动建议（补词库/补题/优先练） | stack + knowledge |
| core/jdplan.mjs | **岗位描述 → 练习清单**：JD 里没有可执行命令，所以把 JD 命中的知识点映射到题库**已有的**题，并附上原文依据，产出"计划草案"（kind: plan）——项目页里它与题目草案区分开（不给"加入总题库"按钮，而是一键开练）|
| core/corpus.mjs | **语料全文检索**：跨项目在来源原文里搜关键词（多词默认"同一行都要出现"，可切 OR），命中带项目/来源/行号，没有原文的旧来源如实计为未参与检索。CLI corpus、GET /api/corpus、网页与原生共用 |
| core/cache.mjs | **进程内缓存**（按文件指纹：大小 + mtime）：原文读取与 JD 分析结果缓存，实测语料检索 44→9ms、JD 练习清单 188→33ms（boss-ai 226→4ms）；指纹变了立即失效，拿不到指纹就不缓存 |
| core/text.mjs | **共用小工具**：难度标签 / 排序序号 / slug（一份实现 + 显式选项；三个原实现行为不同，迁移时按原行为固定选项）。评审时量到 levelLabel 有 3 份、slug 有 3 份 |
| core/mastery.mjs | **知识点掌握度**：覆盖度×0.6 + 覆盖度×近期保持×0.4（半衰期 30 天）；排序为「练过但没拿下 → 没练过（先啃小的）→ 熟练」，并给出「今天先练这 N 道」 |
| core/feedback.mjs | **判定反馈定位**：把「缺哪些要素」推进到「该补在哪一行」——按整行累加片段匹配长度，相似度 <0.5 就如实说「答案里没有相关片段」 |
| core/packfile.mjs | **题包脚手架与深度校验**：pack new 生成开箱即过校验的模板（难度按口径算、要素从参考答案推导）；deepValidate = 结构 + 难度口径 + 参考答案必须自测满分（复用 catalog-audit），把 CI 才查的两条口径下沉到本地 |
| core/harvest.mjs | **招聘抓取的纯逻辑**：来源文件头统一组装（页面选择器 → 解析器 → 卡片三层兜底，并写「详情页」与「抓取原因」）、未取到原因的判定（登录墙/还在加载/正文过短/选择器没命中）。抽出来是为了能单测——抓取脚本本身要在浏览器里跑 |
| core/storage-schema.mjs | **存储 schema 版本化**：progress v2 / jobs v2（裸数组 → {version, jobs}）/ goals v1 的检测与迁移值生成（纯函数）；读侧兼容旧形状，写侧只写新形状 |
| core/backup.mjs | **整机备份/恢复**：把 home 里的用户资产（progress/jobs/goals/notes/projects/trust）打成可逐文件校验的 JSON 包；dry-run 出计划、恢复前给会被覆盖的文件留 pre-restore 副本 |
| core/log.mjs | **结构化日志与指标**：NDJSON 一行一事件（HTTP 请求/判定/迁移/备份），轮转保留一代、坏行容忍；summarizeEvents 聚合请求量/延迟 p50-p95/错误率 |
| core/onboarding.mjs | **首次运行引导**：把「从零到第一题」拆成六步（平台/首题/项目/练习清单/目标/备份），判定只读本地事实（离线可用），输出每步命令与下一步——CLI、接口、网页、原生共用同一份 |
| core/commands.mjs | **命令面板的单一事实源**：id/标题/分组/快捷键/CLI 等价命令/界面动作；网页版 ⌘K、原生端菜单、CLI commands 都读它 |
| core/model.mjs | **可选模型接入**：OpenAI 兼容端点（env 配置，key 只读环境变量）；默认离线、任何失败都回退 core/understand.mjs 的规则引擎并带回原因 |
| core/i18n.mjs | **UI 文案表**：zh-CN / en 成对存在（缺一条就被用例拦下），网页版从 /api/i18n 取；语言偏好与外观偏好同存 preferences.json |
| core/trend.mjs | **进度趋势与成绩单**：按天聚合（不补假数据）、连练天数（今天没练不算断）、ASCII 趋势、分轨道、Markdown/CSV 导出 |
| core/day.mjs | **日期口径唯一实现**：dayKey 用本地时区（UTC 分日会把 UTC+8 凌晨的练习算到前一天）、streakDays 今天没练不算断；progress 与 trend 都从这里取 |
| core/reminder.mjs | **目标提醒**：今天通过的题数（同题一次）对比每日目标；三档 none/info/warn，给出下一步命令；分钟目标只作展示 |
| core/doctor.mjs | **数据体检**：项目元数据 / 索引 / 原文 / 草案 / 练习记录是否自洽；默认只读，--fix 只做能重算的事（重建索引、重算知识点），删除类只报告 |
| core/describe.mjs | 「描述与提取」报告：基本信息 → 内容结构 → 技术栈（分类含覆盖）→ 知识点与可练题 → **字典未覆盖清单**；输入可以是文本/文件/截图 OCR/链接 | understand + stack + knowledge |
| core/scaffold.mjs | 按岗位生成可交付的项目：硬要求 → 知识点 → 命令（取自题库参考答案首行）→ 练习题 → 完成标准，产出 `项目书.md` / `checklist.md` / `notes/命令清单.md`；不替用户写代码 | flow + knowledge + progress |
| core/resume.mjs | 按练习记录生成简历要点：技能（按通过题数排序）、亮点（每条带依据）、项目经历、待补方向、Markdown 导出；**只写真实做过的事，不编经历** | progress + judge |
| core/understand.mjs | 文字描述理解：自由文本 → 结构化（分类 / 公司 / 岗位 / 级别 / 硬要求 / 加分项 / 技术栈 / 知识点 / 可练题），每条判断带证据；流程的"岗位与项目理解"从这里开始 | knowledge + tasks |
| core/search.mjs | 搜索与资料收集：多引擎（Bing / DuckDuckGo / 自建端点）依次回退 → 结果页解析（含跳转链还原）→ 逐页抓取解析成知识点与草案题；三端共用同一份 | knowledge + ingest + site-learn |
| core/jobs.mjs | 简历投递记录：校验 / 归一（公司、岗位、状态五档、投递日期、JD）、排序与统计、JD 分析挂载；**三端共用同一份口径**（CLI `jobs`、网页版「简历投递」页、原生端同页） | knowledge |
| core/ingest.mjs | 输入摄取：链接 / 文件 / 剪贴板文字统一成纯文本（含 htmlToText 与 cookie 读取），不引 HTML 解析依赖 | fs + fetch |
| core/ocr.mjs | 截图 OCR：macOS 自带 Vision，首次用 swiftc 编译助手到 ~/.dsh-learn/bin；其它平台走 tesseract 或 DSH_LEARN_OCR；`ocrCapabilities()` 输出能力矩阵（可用性 / 开启方式 / 上限） | child_process |
| core/project.mjs | 项目目录：来源记账（截图/文字/链接/仓库）、知识点与草案落盘、开练清单映射；含 withinDir/safeBaseName 路径边界工具 | fs + knowledge |
| core/site-learn.mjs | 从网页/文档抽命令行示例生成草案任务（供人工复核，不自动入库） | ingest |
| core/repo-learn.mjs | 仓库解析：有界扫描 → 技术信号 → 知识点 → 命令草案；含地址归一化、镜像候选链与复用克隆（resolveRepoDir） | fs + knowledge |
| core/version.mjs | 语义化版本解析与自增（release 脚本与测试共用同一份实现） | 无 |
| web/server.mjs | Web 外壳：解析请求 → 静态资源 → API → 404；带 MAX_BODY/大请求体两档上限与 parent-pid 看门狗 | node:http |
| web/compress.mjs | 响应压缩协商：优先 brotli（同一份 JSON 比 gzip 再小两成），退回 gzip，小响应不压 | zlib |

## 3. 数据模型

- pack：{ id, name, track, version, tasks[] }
- task：{ id, track, title, goal, hint?, sample?, require[], forbid[]?, verify?, variants? }
- rule：{ p: 正则, tip: 缺失说明, severity?: warn|block }（block 用于会丢数据的写法）
- verify：{ cmd: 只读命令, expect: 输出正则, note? }
- record：{ client, taskId, score, verdict, platform, answer, at }
- project：`~/.dsh-learn/projects/<名字>/`，{ project.json 来源台账, tasks.json 项目索引, notes/, drafts/, promoted/ }
- job（简历投递记录）：`~/.dsh-learn/jobs.json`，数组；校验 / 排序 / 统计在 core/jobs.mjs，随备份一起导出
- 界面信息架构：网页版分四页（项目/仓库 / 学习 / 简历投递 / 流程）；「项目、仓库」模块在学习页左侧单独成页，「项目管理」（项目列表 + 索引 + 草案并入）已并入该页（旧 #page=projects 兜底到 repo），页面状态在地址 hash 的 `page` 键；原生端顶部同样三页切换（`Store.page`）；学习页保留全部既有功能
- 题库两个目录：`<仓库>/packs/` 是随工具发布的题库（`BUILTIN_PACKS` 名单；文档数字、知识点对账、判定强度基线都以它为准），
  `~/.dsh-learn/packs/` 是用户题库（`project promote` 的默认去处）。`loadAll` 先加载内置名单再加载用户目录，
  两边合成同一份运行时题库（`TASKS`）；护栏另有一份 `BUILTIN_TASKS`，只含随工具发布的那部分。

判定公式：得分 = round(命中要素 / 要素总数 * 100)；命中任一禁止项再扣 30 分（下限 0）。档位由 judge.mjs 的 PASS_SCORE / PARTIAL_SCORE 决定：进度聚合（core/progress.mjs）从这里取值，服务端再把 passScore/partialScore 下发给页面，避免多处写死 100 后悄悄漂移。命中 severity 为 block 的禁止项（删数据、丢改动一类）时分数封顶 59，直接判未通过 —— 这类写法不该出现"部分通过"。

匹配细节：命令行里的合并短选项（-Eo、-dit、-rh）会先展开成影子文本再匹配（-Eo -> 追加 "-E -o"），否则"缺少 -o"这类误判会常态化；纯数字（-3）与长选项（--name）不参与展开。
大小写：规则里出现大写字母则按大小写敏感匹配（git branch -D 不会被 -d 规则误命中），否则忽略大小写（Docker run 仍能匹配 docker run）。
离线：浏览器直接加载服务端的 core/judge.mjs（同一份纯函数），断网时本地判分，记录先入 localStorage 队列，恢复网络后用 /api/import 合并。

## 3.5 模块边界（重构后）

- CLI 入口 src/cli.mjs 只做三件事：建上下文、查命令表、按返回值决定退出码；命令表与 usage 有测试保证同步，新增命令只改命令表。
- Web 服务端 server.mjs 只做 HTTP 外壳：解析请求 → static.mjs → api.mjs → 404；两边都用 res.headersSent 判断"是否已处理"，内部实现保持裸 return 的写法。桌面壳通过 DSH_LEARN_PARENT_PID 把父进程 pid 交给它，watchParent 每 2 秒确认一次父进程存活，App 被 kill -9 时服务自杀，避免孤儿进程占端口（只在环境变量存在时启用，守护式运行不受影响）。
- 拆分过程中修掉两个真实缺陷：repl/drill 的非 TTY 退出码没有传出去（会"静默成功"），以及静态模块漏了 PAGE/sendJson 依赖（会退化成 400）。

## 4. 执行后端

| 后端 | 用途 | 边界 |
| --- | --- | --- |
| local | 本机只读命令，最快 | 必须命中白名单；dry-run 默认；异步 + 独立进程组执行，超时按进程组 SIGKILL，输出上限 64 KB |
| docker | 在一次性容器里跑验证，避免污染本机 | 仍然只跑白名单命令；镜像默认 alpine:3.20，可用 DSH_LEARN_DOCKER_IMAGE 或 --image 覆盖；执行前先 docker image inspect，缺镜像时拉一次，拉不动就带中文说明与 docker 原始报错降级（不卡满超时） |
| remote | 调度另一台机器（例如 Linux 主机）的 Agent | 需要 token；Agent 侧独立再校验一次白名单 |

## 5. 客户端拓扑

    mac（CLI 客户端）──┐
    mac 浏览器 ────────┼──► 同一份 progress.json ──► 统一排行榜
    Linux 主机 Agent ──┘

- 单机模式：CLI 或 Web 自己就是全部。
- 多机模式：服务端在任意一台机器上跑，其他机器的 Agent 注册为远程 runner；进度仍以文件为准。

## 6. 安全模型

1. 默认零执行：任何命令只有显式开启才运行。
2. 白名单是唯一入口，且静态可审计（uname/sw_vers/node -v/date/docker 只读子命令）。
3. 元字符拦截：; & | > < $ 与反引号直接拒绝，杜绝拼接注入。
4. 网络面最小：Web 与 Agent 默认绑定 127.0.0.1；跨机必须显式指定 host 并携带 token。
5. 外部题库包可选开信任门禁：DSH_LEARN_REQUIRE_TRUST=1 时未信任的包拒绝加载，签名用本地 HMAC 密钥（0600）。
6. 平台自检是唯一绕过只读白名单的执行路径，因为它的探针是源码常量、不接受任何外部输入。
7. 无原生依赖、无数据库、无后台常驻进程，攻击面仅剩 Node 运行时本身。

## 7. 关键决策记录

| 决策 | 理由 | 代价 |
| --- | --- | --- |
| 题库用 JSON 而非 YAML | 零依赖即可解析，校验代码 < 100 行 | 写多行命令要转义，题库可读性略低 |
| 内核保持同步纯函数 | 浏览器与 CLI 共用同一份判定，测试无需 mock | 无法直接做异步 IO，IO 全在服务层 |
| 进度用快照 JSON + 追加日志 | 够用、可读、可手改、可 merge；追加写让并发提交不互相覆盖 | 日志需要定期归档；多机共享目录仍需远端存储 |
| 只读白名单手写 | 安全边界必须人能一眼审计 | 题目变多后需从任务定义生成并人工复核 |
| 不引入测试框架 | node:test 已够用 | 生态工具（快照、覆盖率报告）缺失 |

## 8. 扩展点

- 新系统：在 core/platform.mjs 加 profile，在 pack 里加 variants。
- 新题型：pack 里加任务；需要新判定语义时在 judge.mjs 增加匹配器。
- 新运行环境：runners.mjs 里注册后端，只要实现 execute(task, spec) → 统一结果结构。
- 新客户端：复用 core/ + 一个 API 适配层即可（macOS 原生客户端、移动端、IDE 插件同理）。
