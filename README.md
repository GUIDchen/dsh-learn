# dsh-learn · 跨平台命令行学习与验证

写命令 → 机器判定 → 逐条指出缺什么 → 记录进度 → 换平台重练。
覆盖 Linux / 系统信息 / Docker / Git / Shell 脚本 / 服务管理 / 网络排障 / Kubernetes / Windows 运维 25 条轨道、637 道题，**同一份内核跑在 CLI、网页版、macOS 桌面 App 与远程 agent 四个客户端上**，macOS 优先交付，Linux 可直接运行。
进度与成绩写在 docs/PROGRESS.md（脚本从仓库生成），逐轮记录与阶段小结见 docs/COMPLETION-REPORT.md 第 5 章（最新：5.85 阶段小结）。

网页版是**左中右三栏**：左栏选轨道、搜题（按题号/标题/目标）、按状态筛选（未练习 / 未通过 / 已满分）并带掌握状态；
中栏是「每日一题」+「今日建议」+ 做题与判定；右栏是历史 / 计划 / 排行榜 / 进度与报告导出。
中栏还有「今日复习」（间隔重复排期，一键"复习这道"），右栏有「我的笔记」（当前题的心得）与「学习目标」（每天几题/几分钟 + 今日达成）。
提交历史按当前题过滤，带「通过 / 未通过」条数统计，**点某行命令就能把它填回输入框**——复盘时最常见的动作是"那次写法差在哪，我改一下再判一次"。
键盘：Ctrl/Cmd+Enter 判定、h 提示、a 参考答案、r 刷新、↑↓ 或 j/k 切题、/ 聚焦搜索、1-4 切难度、0 清掉所有筛选、Esc 退出输入（在搜索框里顺手清空）。顶部徽标显示连续学习天数与今日目标达成。
**无障碍**：跳转主内容链接、全站 :focus-visible 焦点圈、筛选按钮带 aria-pressed、当前题带 aria-current、命令与笔记输入框都有可访问名；
可点区域按 WCAG 2.2 AA 的 24×24 下限实测过（折叠按钮 24px、带复选框的 label 撑成 inline-flex 24px 高），
两块侧栏（题库与进度 / 记录与设置）是有名字的地标；**判定完成把焦点交给结果区**，键盘用户 Tab 1 次就能到「下一题」（此前焦点掉回正文，要按 143 次）；
判定结果用一句独立的实时区域播报（"判定：通过，100 分，本次为历史最好，要素齐全"），结果面板本身改成有名字的区域，避免屏幕阅读器念完整个缺失项列表。
判定结果会给出**与历史最好的对比**（上次最好多少分、本次 ±多少、累计第几次），刷新记录时网页版与 macOS 原生客户端都会亮出「本次为历史最好」徽标——不用自己拿两个数字比大小。
断网时**排队的判定看得见**：顶部徽标显示待同步条数，提交历史上方列出排队记录（时间/题目/判定/分数），还有一个「立即同步」按钮——
点一下真的去试，成功后并入进度，失败会明确说是"还是离线"还是"服务端没收"（见 docs/evidence/web-offline-queue-2026.png）。
**不用一直盯着**：队列非空时每 12 秒自己重试一次（浏览器的 online 事件只在系统网络状态变化时触发，服务端重启不会有事件），同步成功自动停表。实测：服务端停掉→离线判定排队→服务端恢复，页面零操作 16 秒内徽标回到「在线」、队列清零、历史里看得到那条记录（修前 22 秒毫无反应）。
断网也能练：判定内核就是服务端同一份 judge.mjs，Service Worker 把它和页面一起缓存；题库（含完整判定规则）与知识点字典也缓存在浏览器里，所以**离线重开页面照样有题可练、也能粘贴 JD 出知识点**，判定在本机完成，记录排队，恢复网络后自动同步到同一份进度里。
> 改前端代码后要看效果，得先在该站点注销 Service Worker（或清掉 `dsh-learn-shell-<版本>` 这个缓存桶）：外壳是缓存优先的，而缓存名带版本号——**没发新版时浏览器给你的还是上一版页面**（实测踩过两次：页面 DOM 里少一个元素、文案还是旧的）。

**从"要学什么"到"练哪几题"**：把岗位 JD 粘进网页版（或截图上传，或丢一个链接），分析器会列出命中的知识点（按模块分组、标难度）、每个知识点对应的题目、字典没覆盖到的要求行，并给出一条可直接开练的清单：

    node src/cli.mjs analyze --text "熟悉 Python 虚拟环境；会用 tcpdump 抓包；了解 YOLO 训练"
    node src/cli.mjs drill --tasks=$(node src/cli.mjs analyze --file jd.md --tasks | paste -sd, -)

分析是纯本地的词条匹配 + 知识图谱，不需要联网、不需要模型 API，命中依据会指回原文片段；字典在 src/core/knowledge.mjs，改字典不用改代码。

**截图 OCR**：macOS 用系统自带的 Vision 框架（首次自动 swiftc 编译一个小助手到 ~/.dsh-learn/bin），图片不出本机；Linux/Windows 接外部 OCR——装了 tesseract 就自动用（中文需 tesseract-ocr-chi-sim），或用 DSH_LEARN_OCR 指定自己的可执行文件，都没有时会明确告诉你装哪个。

**登录墙站点**：链接抓取支持带 cookie：--cookie "name=value; ..." 或用 --cookie-file（Netscape cookies.txt 也行）。浏览器登录后从开发者工具复制 Cookie 头即可；仍然抓不到（页面靠 JS 渲染）时，直接把 JD 文字粘进文本框最稳。

**界面分四页**（网页版导航与原生端顶部切换是同一套划分，「项目/仓库」排在最左）：「项目/仓库」（建项目、收截图 / 文字 / 链接 / 仓库，列出题目草案，项目列表与索引、草案一键并入总题库——原「项目管理」页已并入此页）、「学习」（题库、每日一题、判定、分析、计划、笔记）、「简历投递」（投递记录：公司 / 岗位 / 状态 / 投递日期 / JD，一键分析 JD → 开练清单，或直接建项目收这份 JD）、「流程」（求职学习闭环七步）。页面写进地址 hash（形如 #page=repo），可收藏可分享，且不影响 #task= / #project=。

**从项目和仓库出题**（网页版中栏「项目 / 仓库」与命令行同一套能力）：`project init` 建一个项目目录（默认 ~/.dsh-learn/projects/<名字>/），
截图（macOS Vision 本地 OCR）、文字描述、链接三种输入都能 `project add` 收进来；`learn-repo` 则会浅克隆或直接扫描一个代码仓库，
识别技术信号（Dockerfile / compose / k8s / CI / Makefile / go.mod / Cargo.toml …），用**与 JD 分析同一套知识点字典**匹配出「这个仓库涉及什么」，
再从 README、Makefile、脚本里抽命令示例生成草案。每一步都记账在 project.json 里，草案永远只进 drafts/ —— 入库前必须人工改写并跑 audit。

**项目索引与「加入总题库」**：每次收完来源都会刷新项目目录里的 tasks.json（知识点 → 可练题 + 草案包清单），
`project show` 直接打印、`project show --json` 给出整份索引，任何客户端打开项目都能看到「这个项目能练什么」；
确认要练的草案用 `project promote <项目> drafts/<草案>.json` 一键并入总题库（写进 `~/.dsh-learn/packs/`，所有客户端下次启动即可练，
删掉文件就恢复），网页版对应「列出草案 → 加入总题库… → 确认无误，加入总题库」，已入库的会标出「已在总题库」。

**识图与文字理解**：`ocr <图片>` 把截图识别成文字（macOS 走系统 Vision，离线；其它平台走 tesseract 或 `DSH_LEARN_OCR`），`ocr --capabilities` 自查「这台机器能不能识图、走哪个引擎、缺什么怎么开」；`understand` 把一段自由文本读成结构化信息（分类 / 公司 / 岗位 / 级别 / 硬要求 / 加分项 / 技术栈 / 知识点 / 可练题），**每条判断都给出依据**（命中的是「熟悉」还是「了解」）。网页版分析面板的「理解这段文本」与原生端项目面板的「文字理解」是同一件事。

**软件自己会搜**：`search <关键词>`（默认 Bing，失败自动换 DuckDuckGo，也支持 `DSH_LEARN_SEARCH_ENDPOINT` 指向自建搜索）与 `research <关键词>`（搜 → 逐页抓 → 抽知识点与命令草案，`--project=名字` 直接收进项目）；网页版分析面板与原生端项目面板各有同一组按钮（搜一下 / 搜索并解析 / 解析并收进项目）。每个页面失败都如实记原因（403 / 验证页 / 超时），不静默丢。

**岗位站点（BOSS / 拉勾等）抓不到正文时会明确拦下**：这类站点对非浏览器请求返回验证页 / JS 壳（实测 BOSS 只有 71 字「请稍候…正在加载中…」），
不再给出「识别出 1 个知识点」这种看似成功的结果，而是提示三条可行路径——截图走本机 OCR / 复制正文成文字 / 登录后带 Cookie 再试。
草案抽取按实测调过三轮（真克隆 kubernetes/examples、gin、ripgrep）：YAML 的 `key: value`（kind 恰好是个真工具名）、
以工具名开头的英文句子、反斜杠续行的半截命令都被挡在外面；判定规则锚在命令里**真实出现的词**上（`minikube start` 的规则是 `minikube`，
不是分组标签 k8s——用标签拼出来的规则永远匹配不上，学员写对了也判缺要素）；同一写法只留一条（`go build -tags=a/-tags=b/-tags=c` 出三条同样的题），
合并了多少条会写在复核清单里。
草案的要素覆盖**工具 + 子命令 + 目标对象 + 选项**：实测三个真仓库（kubernetes/examples、gin、ripgrep），要素数从 1–2 涨到 2–4，
`minikube start` 不再是一个要素就能满分的题；已经被别的要素覆盖的词不会重复计数。
GitHub 地址可以直接写 `owner/repo`；直连不通会依次试镜像（也能用 `DSH_LEARN_GIT_MIRROR` 固定走某个），同一仓库第二次默认复用上次克隆、不重复下载。详见 docs/PROJECTS.md。

**从文档站点出题**：node src/cli.mjs learn-site <链接|文件> 会把页面代码块里的命令示例抽出来，生成"题库草案"（含要素、禁止项与复核清单），刻意不自动入库——草案必须人工改写题面并跑一次 node src/cli.mjs audit 才成为正式的题。
只读验证在离线时不会静默失败：会显示该题要跑的命令、上次验证的结果与时间，并说明"白名单执行器不在浏览器里"，让学员自己到终端跑。

零第三方依赖，Node.js >= 18 即可，可完全离线。

## 快速开始

~~~bash
node src/cli.mjs list                     # 查看题库（637 题 / 55 个包 / 25 条轨道）
node src/cli.mjs probe --run              # 环境探测 + Docker 守护进程诊断
node src/cli.mjs check docker.run-web "docker run -d -p 8080:80 --name web nginx:1.25" --client mac-air
node src/cli.mjs repl                     # 交互式刷题
node src/cli.mjs daily                    # 每日一题（优先"该复习的题"，其次薄弱题，再是新题）
node src/cli.mjs review                   # 复习队列（间隔重复：未通过 1 天、一次通过 7 天、连续通过 7n 天，上限 30 天）
node src/cli.mjs goal set --tasks=3 --minutes=20   # 学习目标
node src/cli.mjs note docker.run-web "-d 是后台运行" # 题目笔记
node src/cli.mjs drill --limit 5          # 定向重练"练过但没满分"的题
node src/cli.mjs report --out report.md   # 导出 Markdown 学习报告
node src/cli.mjs selftest --run           # 平台自检：本机工具链是否与题库假设一致
node src/cli.mjs plan --hours 2           # 生成分天学习计划
node src/cli.mjs progress                 # 我的完成度与需要重练的题
node src/cli.mjs board                    # 多客户端排行榜
npm test                                  # 278 项测试（内核 + 命令 + 存储 + 白名单 + 后端边界 + 跨客户端一致性 + 页面 + 平台变体不变式 + 覆盖率门槛）
bash scripts/check-syntax.sh              # 全仓语法体检（含网页版模块脚本）
node scripts/coverage.mjs                 # 覆盖率门槛（低于基线 −2% 即失败）
node scripts/coverage.mjs --record        # 追加一行到 docs/coverage.md 趋势表
npm run verify                            # 端到端证据脚本（内核 + CLI + Web + Agent）
~~~

网页版（浏览器即客户端，可"添加到主屏幕"独立运行）：

~~~bash
node src/web/server.mjs                              # http://127.0.0.1:8787
node src/web/server.mjs --port 0                     # 由内核挑空闲端口，并打印 DSH_LEARN_URL
node src/web/server.mjs --host 0.0.0.0 --port 8787   # 局域网其他设备也能连，共用同一份进度
~~~

地址栏里的 hash 是**可分享的状态**：`#task=题号` 打开就是这一题（题被当前筛选挡住时会先回到全部筛选，不会打开一个看不见的题），
`#project=项目名` 打开某个项目；两者互不干扰，点题会把题号写进去，开项目不会把题号抹掉。

macOS 桌面 App（原生 SwiftUI 客户端，不嵌网页、无 Electron、无第三方依赖）：
三栏界面——左栏筛选题单、中栏题目与作答、右栏判定结果；判定引擎仍是同一份 Node 服务（构建时打进 App 的 Resources/engine），
客户端只说 HTTP，所以题、判定与进度与 CLI / 网页版共用一套。装在 ~/Applications 后完全不依赖项目目录，双击即用。
项目面板里也能直接列出草案并「加入总题库」（每行 预览 / 加入总题库 / 暂存到项目，入库前弹二次确认），与命令行、网页版是同一份数据。

左栏顶部还有**项目 / 仓库**：可以选截图（原生 NSOpenPanel，本机 Vision OCR）、贴一段文字、填仓库本地路径或 Git 地址（支持 owner/repo 简写），
解析出技术信号、命中的知识点与草案题，
并一键「用这些知识点开练」——与命令行 / 网页版走同一份 core 与同一套接口（镜像候选链、复用克隆也都在服务端）；
左栏顶部是**每日一题**（"该复习了 / 上次没满分 / 还没练过"写得明明白白，一键跳过去；被当前筛选挡住时会先回到全部），
中栏的作答区带**只读验证**按钮（跑题库里绑定的只读命令，验证这台机器与题目假设对不对，不执行你写的答案）；
右栏还能**设学习目标**（每天几题/几分钟，与网页版/命令行同一份 goals.json）并看**按轨道完成度**（低分轨道排前面：告诉你接下来练哪块），
另有**我的笔记**（跟题走的心得，与网页版/命令行共用一份存储，切题自动切换、空内容保存即删除）与**备份导出/导入**
（整份搬走记录 + 笔记 + 学习目标，换机器/重装不丢手写内容）；
无障碍与「原生」两条都做了实测：装饰性图标对读屏隐藏、进度条带可访问名与当前值、判定完成后用 `NSAccessibility` **主动播报一次**
（与网页版的 `aria-live` 同一套口径，读屏用户按完 ⌘↩ 不用自己 Tab 到右栏去找）；
`test/native-parity.test.mjs` 检查 5 个 Swift 文件里没有 `WKWebView / WebKit`，并用 `otool -L` 实测安装包里 App 的链接框架——
实测只链接 Cocoa / SwiftUI / AppKit / CFNetwork / Combine / Foundation，**没有 WebKit**。

右栏在还没判定时显示**复习队列**（间隔重复到期列表：上次分数、逾期天数、一键"复习"），
下面才是轨道 / 难度 / 搜索，以及**评测平台**下拉（跟随服务端 / macOS / Linux / Windows）：题库里有 **50 道平台变体题 / 135 份变体样本**
（darwin 47 / linux 47 / **win32 41**——同一件事在 Mac、Linux、Windows 上写法不同，Windows 侧用 PowerShell 原生命令而不是过时的 wmic：查端口占用 `Get-NetTCPConnection`、看接口地址 `Get-NetIPAddress`、路由 `Get-NetRoute`、无线链路 `netsh wlan show interfaces`、时间同步 `w32tm /query /status`、串口 `mode COM3: BAUD=115200`），选定平台后判定才按那个平台的口径来——选 "Linux" 就能用 Linux 写法练同一道题。
第 25 条轨道 **Windows 运维**（15 道：服务自启状态、事件日志、防火墙规则、共享与目录权限、补丁与重启判定、以及 5 道「写操作先 -WhatIf 预演」）整轨都声明了只在 Windows 上成立——在 macOS/Linux 下这些题会带「仅限 win32」标记、不判分、不记进度，在平台下拉里切到 Windows 即可正常练与判分。
另有 5 道题显式声明了 `platforms`（launchctl、pkgutil/dpkg、bash 3.2 与 4 的写法差异等）——它们只在自己成立的平台上参与体检，不会被算成「欠了 Windows 参考答案」；
在不适用的平台上这几道题**只展示、不判分**：题头直接说明原因（CLI 退出码 2、`POST /api/check` 返回 400、网页版与原生端给出同一句话），也不写进进度——否则 Windows 学员敲 `launchctl list` 会被判满分，而这条命令在 Windows 上并不存在。
这个选择会记在本机，重开 App 继续用同一套筛选与平台。

![macOS 原生客户端三栏界面](docs/evidence/native-macos-0.13.0.png)

~~~bash
bash app/macos/build.sh              # 构建 dist/dsh-learn.app
open dist/dsh-learn.app              # 双击或命令行启动
bash app/macos/install.sh            # 装到 ~/Applications（自带引擎，不再读项目目录）
bash app/macos/install.sh --launchagent   # 顺带设置登录自启
bash app/macos/build.sh --identity-list  # 看本机有哪些签名证书
bash app/macos/build.sh --sign --notarize --profile dsh-learn   # 正式签名 + 公证（给别人用）
bash scripts/release-mac.sh --ad-hoc     # 一键打包：dist/dsh-learn-<版本>.zip + .sha256
bash scripts/release-mac.sh              # 正式发布：签名 + 公证 + stapling + 打包
~~~

对外分发需要 Developer ID 证书与公证凭据，完整步骤见 docs/RELEASE-MAC.md。

远程验证节点（把另一台机器变成只读 runner）：

~~~bash
# 在 Linux 主机上
node src/agent.mjs --host 0.0.0.0 --port 8790 --token <你的令牌>
# 在 macOS 上调度它
node src/cli.mjs verify git.version-check --run --runner remote --endpoint http://linux-box:8790 --token <你的令牌>
~~~

两个服务型入口都支持 `--help` 打印用法（agent 还会列出接口与约束：请求体 16 KB 上限、只读白名单、token 只在请求体里读）。
agent 的安全边界实测：token 缺失或错误 → 401，命令不在白名单 → 403，请求体超限 → 413，默认 `run` 为假只返回 dry-run。

## 架构

    ┌──────────────── 客户端层（四个客户端共用同一内核） ─────────────────┐
    │  CLI  src/cli.mjs      Web(PWA)  src/web + web/                     │
    │  Agent  src/agent.mjs  macOS App  app/macos（原生 SwiftUI 客户端）    │
    └───────┬──────────────────────┬───────────────────────┬────────────┘
            │                      │                       │
    ┌───────▼──────────────────────▼───────────────────────▼───────────┐
    │                      服务层（Node 专属）                          │
    │  packs.mjs 包加载   runners.mjs 执行后端   store.mjs 进度落盘      │
    │  exec.mjs 只读白名单执行器                                        │
    └───────┬──────────────────────────────────────────────┬──────────┘
            │                                              │
    ┌───────▼──────────────── 纯内核（无系统 API） ─────────▼──────────┐
    │  schema.mjs 包校验   judge.mjs 判定   platform.mjs 平台档案        │
    │  plan.mjs 计划生成   progress.mjs 进度聚合   args.mjs 参数解析     │
    └──────────────────────────────┬──────────────────────────────────┘
                                   │
                            ┌──────▼───────┐
                            │ packs/*.json │  题库数据（可外部加载/覆盖）
                            └──────────────┘

设计要点：

- **平台差异是数据，不是分支**：BSD 与 GNU 的写法差异写在 platform.mjs 的 profile 与题目里的 variants，加一个系统只需加一份数据。
- **内核不碰系统 API**：judge / platform / plan / progress / args 是纯函数，浏览器与 CLI 直接共用；只有 packs / exec / runners / store 允许碰 fs、进程与网络。
- **多客户端天然成立**：进度按 clientId 记录，CLI、多个浏览器、多个 agent 共用一份 progress.json，排行榜自动汇总。
- **判定可解释**：任何扣分都能回答"为什么"，任何探测都能回答"下一步做什么"。

## 命令

| 命令 | 作用 |
| --- | --- |
| list [--track=docker/linux/git] [--level=easy/medium/hard] | 列出题目与要素数量，可按轨道与难度（简单/中等/困难）过滤 |
| show <id> [--platform=...] | 查看某题在该平台的要素、参考答案、提示 |
| check <id> "<命令>" [--client=名字] [--platform=...] | 评测并记录到该客户端名下 |
| verify <id> [--run] [--runner=local/docker/remote] [--endpoint=] [--token=] [--image=] | 执行题目绑定的只读验证 |
| runners | 列出三个执行后端的可用性 |
| probe [--run] | 平台探测 + Docker 守护进程诊断 |
| plan [--hours=2] [--track=] [--status] | 生成分天学习计划（不含参考答案）；--status 打印**计划完成情况**：与真实记录对齐，给出整体完成度、整天完成数与剩余天数 |
| progress | 完成度、分轨道进度、需要重练的题 |
| board | 多客户端排行榜 |
| repl | 交互式练习（:hint / :answer / :skip / :quit） |
| daily [--track=] | 每日一题：同一天结果稳定，优先"该复习的题"，其次薄弱题，再是没练过的题 |
| review [--limit=10] [--track=] | 复习队列：到期该复习的题 + 之后到期的排期 |
| goal [show] / goal set [--tasks=N] [--minutes=N] | 学习目标与今日达成情况：题数按「今天通过」算，时长按「今天碰过」算（含没通过的练习，同一题只折一次） |
| note [<taskId> ["内容"] [--delete]] | 题目笔记：不带参数列出全部笔记 |
| drill [--all] [--limit=5] [--track=] [--tasks=a,b,c] | 定向重练：默认挑"练过但没满分"的题，按权重排序（权重 = 100 − 最高分 + **还没满分**时的练习次数 × 5；已满分的题权重回到 0，同权重时练得少的排前面）；--tasks 按指定清单练 |
| analyze --text "JD" / --file jd.md / --url 链接 / --ocr 截图.png | **岗位/文档分析**：列出命中的知识点、对应题目与建议训练顺序；--tasks 只吐题号，可直接接 drill |
| knowledge [--json] | 知识点字典：23 个模块、100 个知识点，含难度、命中词与对应题目，也标出还没有题的知识点 |
| learn-site <链接\|文件> [--limit=20] [--out=drafts/x.json] [--apply] | **从文档站点学题库**：抓页面代码块里的命令示例，生成草案包 + 复核清单（不自动入库，入库前必须人工改写并跑 audit） |
| describe [--file\|--text\|--ocr\|--url] [--out=报告.md] | **描述与提取**：把岗位要求/文档/截图/链接描述清楚（基本信息 + 职责 + 硬要求/加分项），再抽全技术栈（15 类词库，每项带原文依据、命中知识点、可练题数、是否覆盖）与知识点，并列出**字典未覆盖清单** |
| survey --dir=岗位目录 \| --files=a.txt,b.txt [--min-jobs=2] \| --out=调研.md | **多岗位调研**：热度排行（出现在多少个岗位）+ 跨岗位通用技能（≥50%）+ 缺口与行动建议 |
| survey --dir=语料根目录 --by-category [--only=imaging,yolo] [--out=分方向.md] | **分方向调研**：每个子目录算一个方向，输出「技术栈 × 方向」矩阵 + 跨方向共性（≈入场券）+ 方向专有（≈方向标识）+ 逐方向画像 |
| project jdplan <名字> [--source=N] [--max=10] [--json] | **岗位描述 → 练习清单**：JD 里通常没有可执行命令，所以把 JD 命中的知识点映射到题库已有的题（附原文依据），产出计划草案 drafts/jd-plan-<项目>.json 与 notes/JD-练习清单.md；项目页里显示为「计划清单」，可一键按清单开练 |
| corpus <关键词…> [--project=名字] [--any] [--limit=20] [--out=结果.md] | **语料全文检索**：跨项目在来源原文里搜关键词（多词默认"同一行都要出现"，--any 切 OR），命中带项目 / 来源 / 行号，可直接打开原文；没有原文的旧来源如实提示 |

**性能实测**：docs/PERFORMANCE.md（冷热耗时与复现命令；每条都是本机实测而非估算）

**HTTP 接口清单**：docs/API.md（由 docs/api-contract.json 生成，31 条路由 / 17 个 action）。
清单与 src/web/api.mjs **双向绑定**——代码里出现的路由/action 必须登记，登记了也必须存在；
「同一份数据两种包装」这类形状漂移（init 的 project/meta、recommend 的 jobs/matches）也写进契约说明里。

**完成报告**：docs/COMPLETION-REPORT.md 是**索引**（1–5 章 + 分卷目录 + 第 6 章）；逐轮日志按每 50 轮一卷放在 docs/report/，新增小节用 scripts/append-report-section.mjs（自动落卷并刷新索引）。

**三端能力对照表**：docs/CAPABILITIES.md（由 docs/capabilities.json 生成）逐项列出每个能力在 CLI / 接口 / 网页版 / 原生端 四处是否存在、用哪条用例守、实测证据在哪；声称缺失的必须写清原因，并由守卫逐个去源码里核对——避免「网页有、原生没接」这类缺口再靠人工发现。
| jobs follow [--stale-days=5] [--now=YYYY-MM-DD] [--out=跟进.md] | **投递跟进**：谁在等消息、多久没动静、先跟哪几家（只催已投 / 面试中；改状态或写备注都会进状态时间线）|
| project refresh <名字> \| --prefix=boss- [--json] | **刷新项目知识点**：知识字典补了新题包后，重读原文重算知识点并重建索引（没有原文的老来源如实跳过）|
| doctor [--fix] [--json] | **数据体检**：项目元数据 / 索引 / 原文 / 草案 / 练习记录是否自洽；--fix 只做能从现有数据重算的修复 |
| bash scripts/clean-temp.sh [--dist-zips] | **清理验证产物**：headless Chrome 的临时 profile、自检二进制、临时 home、中间截图与日志（不动 /tmp/dsh-boss-profile）；--dist-zips 额外只留最近 3 个发行归档 |
| node scripts/e2e-flow.mjs | **端到端闭环回归**：收岗位 → 分析 JD → 建项目收 JD → 开练清单 → 练 → 简历 → 投递 → 跟进 → 检索/调研/体检，17 步逐步断言；临时环境运行，失败时保留现场 |
| node scripts/e2e-api.mjs | **接口层闭环回归**：同样的 18 步经 HTTP 跑（起真实服务 + 随机端口 + 临时 home），网页版与原生端用的就是这层 |
- node scripts/e2e-web.mjs：浏览器层端到端（headless Chrome 走学习/项目/投递三页，自带进程与临时目录清理；没有 Chrome 会跳过）。

**该补题 vs 只标注**：survey 与 describe 把"未覆盖"分成两类——"该补题"是真缺口（会进行动建议），"只标注"是白名单里**故意不出题**的方向（硬件与电路要开发板/示波器、云控制台要真账号、国产 AI 芯片要昇腾环境、AI 编程助手无法稳定判定），每条都写明原因与替代建议，不再让这些方向年年挂在缺口清单里。
| project import --dir=目录 [--prefix=] | **按目录批量导入语料**：每个子目录建一个项目（可加前缀），每份文件收成一条来源并抽知识点；与网页版「按目录导入」、API action=import 同一份实现 |
| flow status\|next / resume / collect / recommend / build / apply | **求职学习闭环七步**：学习 → 项目解析学习 → 生成简历 → 搜集招聘信息 → 按岗位补知识点 → 岗位推荐 → 投递。`status` 打印每一步的真实进度与下一步；`resume` 按练习记录生成简历要点（`--out=resume.md` 导出，只写真实做过的事）；`collect` 批量搜岗位或 `--file/--text` 粘 JD 入库；`recommend` 按**加权匹配度**排序（覆盖 55% + 硬要求 30% + 方向广度 15%，逐项给依据；同级里新发布的靠前），可按 `--location` / `--salary-min` / `--salary-max` / `--remote-only` 过滤（薪资按区间重叠算）；`collect` 还支持 `--url` 按链接抓 JD（登录站点用 `DSH_LEARN_COOKIE` / `DSH_LEARN_COOKIE_FILE` 配一次 Cookie，三端共用）；`pack <id>` **生成投递材料**（逐条对硬要求：对得上打勾、对不上写明待补 + 可粘贴要点 + 差异自陈）；`build <id>` **按岗位建项目**：写 `项目书.md`（每条硬要求 → 要跑的命令 → 完成标准）、`checklist.md`（可勾选验收清单）、`notes/命令清单.md`、`notes/岗位学习计划.md`（硬要求 → 知识点 → 待练题 → 开练命令）；`collect` 还支持 `--ocr` 截图识图入库；`apply <id>` 记投递并打印可粘贴要点（`--open` 打开链接） |
| ocr <图片> [--json] \| ocr --capabilities | **识图**：截图 → 文字；`--capabilities` 打印能力矩阵（可用引擎 / 开启方式 / 格式与大小上限） |
| understand --text 「…」 \| --file jd.md \| --ocr 截图.png | **文字理解**：自由文本 → 结构化（公司 / 岗位 / 级别 / 硬要求 / 加分项 / 技术栈 / 知识点 / 可练题），每条判断带依据 |
| search <关键词> [--engine=bing\|duckduckgo\|custom] [--limit=8] | **搜一下**：默认 Bing，失败自动换 DuckDuckGo；`--engine=custom` 配合 `DSH_LEARN_SEARCH_ENDPOINT` 走自建/内网搜索 |
| research <关键词> [--limit=5] [--project=名字] | **搜索并解析**：把命中页面抓回来抽知识点与命令草案；`--project` 顺手收进项目（notes/ + drafts/，草案不自动进题库） |
| jobs list\|add\|update\|analyze\|drill\|delete | **简历投递**（与网页版「简历投递」页、原生端同一份数据）：记录公司/岗位/状态/投递日期/JD；`analyze` 把知识点与可练题存回记录，`drill` 打印可直接复制的开练命令，`--jd-file` 读长 JD |
| project promote <名字> <草案文件> [--project-only] [--force] [--dry-run] | **草案 → 总题库**：默认写进 `~/.dsh-learn/packs/`（所有客户端下次启动就能练到），`--project-only` 只写项目的 `promoted/` 暂存区，`--dry-run` 先看目标与提醒 |
| project init\|list\|show\|add <名字> [--file 截图/文本] [--text "…"] [--url 链接] | **项目目录**：截图 OCR / 文字描述 / 链接三种输入都能收进来，知识点摘要进 notes/，命令草案进 drafts/（产物名带上来源名：网页版/原生端上传时会带原文件名，不再留 OCR 临时文件名） |
| project tasks <名字> [--json\|--csv] | **项目能练什么**：把项目命中知识点覆盖的题目列出来；--csv 可直接喂给 drill --tasks=…，一个项目一条命令开练 |
| learn-repo <本地目录\|owner/repo\|git 链接> [--project=名字] [--limit=20] [--branch=分支] [--refresh] | **解析代码仓库**：浅克隆或直接扫描 → 识别技术信号 → 匹配知识点 → 从 README/Makefile/脚本抽命令出草案。拉不到 GitHub 会依次试镜像，同一仓库第二次默认复用上次克隆 |
| modules [--json] | 模块总览：每个模块的题库题数、通过率、知识点数量；岗位里常见但题库还没覆盖的模块会如实标注「暂无题库」 |
| report [--out=report.md] | 导出 Markdown 学习报告（分轨道进度、需要重练、最近提交、客户端排行、连续天数） |
| selftest [--run] [--platform=darwin/linux/win32] [--runner=docker] [--image=] | 平台自检：逐条实测工具链差异是否如题库所写（Windows 那组断言 POSIX 工具的缺席，并检测 WSL2） |
| security whitelist [--json] | 白名单与题库对账：题库声明的验证命令是否都能跑、有没有闲置条目、危险命令是否仍被拒绝 |
| export [file] / import <file> | 进度导出与去重合并 |
| pack list / pack validate <file> | 查看已加载的题库包 / 校验自己写的包 |
| pack keygen / sign / verify / trust / trusted | 外部题库包的签名、验签与信任库（DSH_LEARN_REQUIRE_TRUST=1 打开加载门禁） |
| lab up \| status \| down | 本地实验室：起压测靶机（http://127.0.0.1:8899）与 kind 集群，给需要真环境才能验的题用 |
| --json | 所有命令都支持结构化输出 |

## 题库

五十五个数据包，637 道题，二十五条轨道（linux / shell / system / docker / compose / k8s / git / network / netops / database / ops / security / perf / go / rust / lang / mlops / service / windows / python / c / cpp / embedded / dl / yolo / imaging）。自己写包只需 JSON，加载即校验：见 docs/WRITING-PACKS.md；用 DSH_LEARN_PACKS=/path/to/packs 可加载外部包并覆盖同 id 内置题。每题的判定要素、禁止写法与参考答案都在 JSON 里，改题库不需要改代码。

**难度分档**：每题带 level 标注（简单 172 / 中等 400 / 困难 65），口径是可复算的——按要素条数，加上是否含禁止项与平台变体推导，见 docs/WRITING-PACKS.md 第 2.1 节；命令行 `list --level=hard` 与网页版左栏难度筛选走同一份数据。

| 包 | 轨道 | 内容 |
| --- | --- | --- |
| linux-core | linux | 系统类型判定、sed 原地替换（BSD/GNU 变体）、date 日期偏移（BSD/GNU 变体） |
| linux-advanced | linux | stat 取文件大小（BSD/GNU 变体）、grep -P 与 -E（BSD/GNU 变体）、find 统计、du 排行榜、一级子目录占用深度（BSD 用 -d 1 / GNU 用 --max-depth 变体）、最大的 5 个文件（BSD find 无 -printf 变体） |
| docker-core | docker | version 格式化、上下文与守护进程排查、Compose v2 vs v1、run 四要素、logs -f、命名卷持久化 |
| docker-advanced | docker | build --build-arg、exec -u 0 提权、stats --no-stream 快照、volume ls --format、network inspect 网关、compose logs --tail、安全清理（禁 -a/--volumes）、inspect 健康状态 |
| git-core | git | 版本确认、status -sb、log --graph、diff --staged、switch -c、restore --staged（禁 --hard）、stash 往返、commit --amend --no-edit、换行符跨平台配置（win32 变体） |
| service-core | service | 服务状态/启动/改配置后重启：darwin 用 brew services，linux 用 systemctl（互为变体） |
| network-core | network | 监听端口（darwin lsof / linux ss）、DNS 解析（darwin dscacheutil / linux getent）、nc 端口探测、curl 只取状态码 |
| linux-shell | linux | tar 打包排除、find -exec 批量改权限、xargs 并行压缩、rsync 增量同步、SSH 私钥权限、sed 删行（BSD/GNU 变体） |
| docker-ops | docker | 多阶段构建、.dockerignore、HEALTHCHECK、restart 策略、logs --since、悬空镜像清理、inspect 资源限制 |
| git-rescue | git | reflog 找回丢失提交、cherry-pick、bisect 二分定位、worktree 并行修复、rebase -i 压缩、删已合并分支、force-with-lease |
| shell-basics | shell | 严格模式（set -euo pipefail）、变量小写转换、词频统计、逐行读数组（后三道是 macOS bash 3.2 与 Linux bash 5.x 的平台变体）、trap 清理、参数校验、here-doc 防展开 |
| compose-ops | docker | profiles 按需启动、depends_on 健康依赖、--scale 扩副本、config 校验、ps --format json、down 保留数据卷、env_file 注入 |
| k8s-core | k8s | get pods -o wide、logs -f --tail、exec --、describe、port-forward、rollout status、apply --dry-run、context 切换、安全删单个 Pod（--all 与删命名空间为 block） |
| k8s-ops | k8s | get events --sort-by=.lastTimestamp、scale --replicas、set image + rollout status（删 Deployment 为 block） |
| docker-runtime | docker | --cpus/--memory/--memory-swap 限额、--read-only 配 --tmpfs、docker cp 从容器里取文件 |

评分：得分 = 命中要素 / 要素总数 × 100；命中任一禁止项再扣 30 分（下限 0）。100 分通过，>= 60 部分通过，其余未通过，缺什么、踩了什么坑逐条列出。
会丢数据的禁止写法（docker system prune --volumes、git reset --hard、删除文件）标了 severity: block：命中后分数封顶 59 并直接判未通过，不会停在"部分通过"。

判定细节：合并短选项（-Eo、-dit、-rh）会先展开成影子文本再匹配，避免把 "docker run -dit" 误判为 "缺少 -d"；纯数字（-3）与长选项（--name）不参与展开。
大小写规则：规则里写了大写字母就按大小写敏感匹配，否则忽略大小写 —— 这样 "git branch -D"（强删）不会误命中 "-d"，而 "docker run" 仍能容忍用户写成 "Docker run"。

## 平台适配

| 平台 | 工具链 | Docker 运行时 | 关键差异 |
| --- | --- | --- | --- |
| macOS（已实测交付） | BSD 工具链，zsh | Docker Desktop / OrbStack（容器跑在 Linux 虚拟机里） | sed -i 需空后缀、stat 用 -f %z、grep 无 -P、date 用 -v；docker CLI 与守护进程分离，多套运行时各有 context |
| Linux（可直接运行） | GNU 工具链，bash | 原生 dockerd（systemd 托管） | sed -i 不接后缀、stat 用 -c %s、grep 支持 -P、date -d 支持自然语言 |
| Windows（架构就绪，待真机回归） | PowerShell / Git Bash | Docker Desktop（WSL2） | 原生没有 sed/stat/grep，建议在 WSL2 内运行（走 linux 那套探针）；已备 7 道 win32 变体（git 换行符、端口监听、服务列表、命令来源、磁盘用量、内存概览、DNS 解析），每道都把 POSIX 写法列进警告级禁止项 |

本仓在 macOS 26.5.1（arm64，Node v24.19.0，Docker CLI 29.4.0）上的**实测证据**：

- sed -i 's/a/A/' f → sed: 1: "...": invalid command code _ ；sed -i '' 's/a/A/' f → 生效
- date -d '+1 day' → date: illegal option -- d ；date -v+1d '+%Y-%m-%d' → 2026-09-26
- stat -c '%s' a.txt → stat: illegal option -- c ；stat -f '%z' a.txt → 5
- grep -P 'h.l' a.txt → grep: invalid option -- P
- docker --version 正常，但当前 orbstack 上下文的守护进程未运行 → failed to connect to the docker API at unix:///Users/.../orbstack/run/docker.sock
- 实测排除的"伪差异"：readlink -f、xargs -r、sort -V 在本机 macOS 上均可正常使用，因此没有把它们写成题

## 安全边界

- 默认不执行任何命令；check 只做静态判定。
- 白名单是唯一的安全边界，且**可对账**：node src/cli.mjs security whitelist 会检查"题库声明的验证命令是否都在白名单内""有没有已经没人用的条目""危险命令是否仍被拒绝"，对账失败即退出码 1（CI 与端到端脚本都跑它）。每条白名单都带 id/归属/示例，并且必须首尾锚定。
- verify 只在显式 --run 时执行，且命令必须命中 exec.mjs 的只读白名单（uname / sw_vers / node -v / git --version / date / docker version|context ls|info|ps|volume ls|network ls / kubectl version|config|get）。
- 失败路径也给明确说明：命令超时报"超时（超过 Nms）"而不是 exit null；守护进程/集群不可用时给降级原因与修复建议；远端 agent 连不上、返回 5xx 或非 JSON 都有可读结论（见 test/runners-edge.test.mjs）。
- 含 ; & | > < $ 与反引号的命令直接拒绝；白名单外的命令（如 rm -rf /、docker volume rm）由测试覆盖，返回"已拒绝执行"而不是崩溃。
- 只读执行器异步执行并给命令单独开一个进程组：超时按进程组 SIGKILL（只杀 shell 会留下握着输出管道的孙进程，同步等待就再也回不来），输出超过 64 KB 直接截断并终止。守护进程卡死时最坏 5 秒给出中文说明，而不是把整个 CLI 挂住。
- 桌面 App 退出时会结束它拉起的引擎；App 被 kill -9 或崩溃时，服务端的父进程看门狗（DSH_LEARN_PARENT_PID + 2 秒轮询）会让服务自己退出，不留孤儿进程占端口。
- 容器后端用 docker run --rm --network none 跑一次性容器，不污染本机；守护进程不可用、镜像不在本地且拉不动时都在几秒内给出中文降级说明（附 docker 原始报错与 docker pull 建议），不抛异常、不卡满超时。默认镜像可用 DSH_LEARN_DOCKER_IMAGE 换成本地已有的基础镜像或国内镜像源。
- agent 默认只监听回环，绑定非回环时没有 token 直接拒绝启动；每次请求独立复核白名单，token 用 timingSafeEqual 比对；请求体超过 16 KB 返回 413（不断连接、不留半截请求）。
- Web 默认只监听 127.0.0.1，跨机访问必须显式 --host；请求体超过 64 KB 直接返回 413（截图分析走单独一档 8MB），不读进内存。
- 响应按 Accept-Encoding 协商 brotli → gzip：题库 bootstrap 490KB 原始正文压到 121KB，首页 / app.mjs / core/*.mjs 同样处理；小于 1KB 的响应与二进制不压，content-length 与 vary 头按规范写。
- **压缩质量与缓存都按实测定**：brotli 用 q6（490KB JSON 实测 16 ms / 121KB），不用 zlib 默认的 q11（1055 ms / 110KB）——同步压缩会卡住整个事件循环，页面同时打的七个接口都得排队；同一份正文只压一次（SHA-1 做键、只留最近 12 份），实测 /api/bootstrap 的 br 响应从 1130 ms 降到 20 ms，页面 `window.__dshPerf.bootstrapMs` 从 936 ms 变成 17 ms。
- **覆盖率门槛有人守**：`node scripts/coverage.mjs` 按文件与整体比对 `coverage-baseline.json`，掉下来就退 1（verify.sh 里也有一步，趋势记在 docs/coverage.md）。
  实测：最近十几轮加代码后它红了（整体 88.8% < 90%），这轮补了入口分支、`pack promote`、静态 404、`show --json` 形状等测试，回到 **90.3% 行 / 78% 分支**。
  如实说明：内置的 `--experimental-test-coverage` 只插桩测试进程，入口脚本里「只在子进程跑」的分支（`isMain()`、`process.exit`、拒绝启动）统计不到——这些分支由 spawn 的集成用例覆盖行为，基线按实测刷新并在报告里写明原因。
- **完成度不虚报 0%**：题库近 600 道题时，通过 1–5 道取整会显示 0%。学习报告、`progress` 命令与网页版进度面板统一用「不足 1% 给一位小数」（1/602 → 0.2%），真的没有进度才写 0%；
  报告的分轨道表只列**有进度**的轨道（24 条里 22 条是 0% 时整张表只是刷屏），其余用一行说明——同一份内容从 57 行降到 34 行。
- **字号全部走令牌，最小 12px**：实测页面上曾有 64 处 11px 的中文小字（`.tag` 难度标签与 `.badge` 徽标硬编码了 11px，而令牌 `--fs-xs` 是 12px）。现在 `font-size:` 后面不再出现字面量 px，`test/page.test.mjs` 同时盯着字面量与令牌两条路。
- **选项与取值都校验**：用法文本同时是选项白名单，不认识的 `--xxx` 报错并给最近似建议；轨道/平台/难度取内置值、数字型选项必须是数字（退出码 2）。
  实测过的静默失败：`--track=dokcer` 会列出整个题库、`--platform=linx` 会按 generic 判定变体题、`--hours=abc` 退成默认 2 小时——都曾是退出码 0。
  之前 `--platfrom=linux` 会被静默忽略——按 darwin 判定、退出码还是 0；守卫测试扫源码里所有 `args.x`，
  断言每个选项都写在用法里（这条守卫上线当天就抓出 `--endpoint/--token/--cookie-file` 三处漂移）。
- **往完成报告里加一节**用 `node scripts/append-report-section.mjs <section.md>`：只认整行等于锚点的那一行（正文里引用锚点文字不再误伤）、
  已存在同编号直接拒绝、数组拼接而非字符串替换——这三条都是踩过坑才加的（第 108、118 轮各出过一次拼接事故，第二次被结构护栏当场抓住）。
- **困难题分布**：637 道题里困难 65 道，**25 条轨道全部至少有一道困难题**（第 126–127 轮补的：自动化 bisect、bundle 离线搬运、ASan+UBSan 复现、dig 分段定位、有限重试退避、promtool 规则单测、端口占用取证、服务重启循环诊断、梯度累积+混合精度的有效 batch、YOLO 续训基线守卫、Maven 依赖冲突定位）。
- **判定强度体检**：`node scripts/judge-sweep.mjs` 拿「偷懒答案」过一遍全部题目，看有没有题能被一行工具名骗过。
  实测 576 道题里 0 道「要素≥2 却只写工具名就满分」，2 道单要素题（`system.memory-snapshot` 的 `vm_stat`、`netops.time-sync-check` 的 `timedatectl`）——
  它们的正确答案本身就是裸命令，硬加要素会把正确写法判错，所以记在基线里只许减不许增；`test/judge-strength.test.mjs` 把这条钉住（含 linux / win32 变体）。
  顺手修掉的一道真放水题：`netops.arp-scan-subnet` 原先只判「用了 arp-scan」，写 `arp-scan` 就 100 分，现在要求写清扫描范围（`--localnet` 或 CIDR）。
- **安装包冒烟**：`bash scripts/smoke-app.sh` 用全新的临时 HOME 启动 `~/Applications` 里的 App，
  验证它**自带的**引擎能读题库（版本与 package.json 一致）并跑通截图 OCR，另外两条盯着退出行为：
  正常退出后引擎跟着退出、App 被 `kill -9` 后引擎靠看门狗在几秒内自己退出（实测 2 秒，都不留占端口的孤儿）；verify.sh 里也接了这一步（没装 App 就跳过）。
  为什么要单开：原生自检编译的是仓库里的源码与仓库引擎，测不到「打包」这一步——实测漏打 `tools/` 时仓库全绿、装出来的 App 截图直接 400。
  脚本会核对引擎子进程的命令行确实在 App 包里（第一版忘了这点，App 走「开发模式」用了仓库引擎，白测）。
- **题库基线**：`docs/catalog-baseline.json` 独立记录每道题的题号与按轨道/难度/数据包的计数，测试断言「题号不许消失、每项计数不许缩水」。
  为什么需要它：`test/expected.mjs` 的期望值是从运行时题库推导的，所以「题库只该变大不该变小」原先**没人执行**——包文件被误删几道题，断言照样通过。
  有意删题/改名时跑 `node scripts/catalog-baseline.mjs --update` 明确更新；只看差异用不带参数的模式，CI 里用 `--check`。
- 外部题库包默认直接加载，可选加一道信任门禁：DSH_LEARN_REQUIRE_TRUST=1 时未信任的包拒绝加载（退出码 3），DSH_LEARN_REQUIRE_SIGNATURE=1 时连只有哈希锁定的包也不放行。签名用本地密钥做 HMAC-SHA256，密钥权限 0600。
- **知识点对账只管内置题**：随工具发布的字典覆盖内置的 576 道题（内置题没挂知识点，audit 直接判错）；外部包是用户自己的内容，audit 只统计不判错（实测：从真仓库推广 7 道题后，原先 audit 会报 7 个「请把 draft.* 加进 src/core/knowledge.mjs」——那是要求用户改工具源码）。外部题照常可练、可判、可记进度，只是不出现在「岗位/文档分析」的推荐里。

## 测试与验证

- npm test：278 项测试。内核层覆盖包校验、平台变体、判定档位、block 级安全拦截、短选项展开、白名单拒绝、失败诊断、训练权重、三个执行后端、计划装箱、进度聚合、内容回归（每条断言对应一次真实探测结果）；客户端层用子进程拉起真实 CLI、在被测进程内启动真实 HTTP 服务端，覆盖判定/计划/进度/历史/今日建议/导出导入/404/非法 JSON/413 超限；另有平台自检与信任模型（签名、哈希锁定、加载门禁）的独立测试。
- 文档与代码的一致性由 test/consistency.test.mjs 钉住：题数、数据包数、轨道分布、平台变体数必须与运行时题库一致（改题库忘了改文档会直接测试失败）。
- 平台变体的不变式由 test/variant-platform.test.mjs 钉住：每个变体的要素必须与基础答案不同，且必须**本平台满分、跨平台判不过**（对全部变体题两两组合实跑判定）。
- 网页版的无障碍基线由 test/page.test.mjs 钉住：跳到主内容链接、:focus-visible 焦点环、判定结果与在线状态的 aria-live 播报、输入框可访问名、筛选按钮的 aria-pressed、表格列头 scope="col"，以及次要文字色的对比度（12px 文字不低于 4.5:1）、可点区域 ≥24px、栏位可访问名、判定后焦点落在结果区。
- npm run verify：等同于 bash scripts/verify.sh。
- 发布：npm run release -- --ad-hoc（或 bash scripts/release-mac.sh --bump minor）。脚本负责把版本号写进 package.json 与 app/macos/Info.plist.template（CFBundleShortVersionString + CFBundleVersion）、构建签名、产出 dist/dsh-learn-<版本>.zip + .sha256，并在 docs/RELEASES.md 追加一条发布记录；--dry-run 只看版本会变成什么。
- bash scripts/verify.sh：端到端证据脚本，串起内核测试 → 题库校验 → 平台变体判定 → 三后端验证 → 计划与进度 → 远程 agent（含 token 拒绝与 403 白名单拦截）→ Web 接口 → 导出导入 → 平台自检 → 定向练习与题库信任门禁，最后打印 PASS/FAIL 汇总，非零退出即失败。
- .github/workflows/ci.yml：ubuntu 与 macos 双系统 × Node 18/20/22 六格矩阵（含零依赖校验、平台自检、CLI 冒烟与端到端脚本），外加 windows-latest 冒烟任务跑跨平台用例。
- 覆盖率门槛：scripts/coverage.mjs 跑一遍测试拿 lcov，按 coverage-baseline.json 的每文件下限（基线 − 2%）比对，低于门槛退出码 1；门槛只管 src/** 与 web/**（产品代码），开发脚本单独列出不参与判定。趋势记录在 docs/coverage.md。
- 平台回归：node src/cli.mjs selftest --run 会把题库里的 BSD/GNU 差异在本机逐条实测；没有 Linux 主机时可用 --runner docker 在容器里跑同一组 GNU 探针。清单与实测结果见 docs/REGRESSION.md。

## 目录

    src/core/     内核：题库校验、判定、平台档案、计划、进度、参数解析、只读执行器、执行后端
    src/cli/      CLI：context.mjs（参数与公共工具）+ commands/（按主题分文件的命令实现）
    src/web/      Web 服务端：server.mjs（HTTP 外壳）、static.mjs（静态资源）、api.mjs（接口）
    src/cli.mjs   CLI 入口与命令表
    src/agent.mjs 远程只读 agent
    packs/        题库数据包（JSON，可外部加载与覆盖）
    scripts/      端到端验证脚本
    app/macos/    macOS 原生客户端（AppKit + SwiftUI，零第三方依赖）
    web/          浏览器客户端：index.html（markup+样式）、app.mjs（逻辑）、sw.js（离线外壳）、manifest
    docs/         文档索引见下
    test/         内核与内容回归测试（node:test，零依赖）

## 文档索引

| 文档 | 内容 |
| --- | --- |
| docs/REQUIREMENTS.md | 需求与验收标准：写给谁、要解决什么、判定口径 |
| docs/ARCHITECTURE.md | 分层与模块边界、执行后端、客户端拓扑、存储模型 |
| docs/PROJECTS.md | 从项目 / 仓库出题：项目目录结构、截图/文字/链接三种输入、仓库解析做了什么、入库前的边界 |
| docs/WRITING-PACKS.md | 自己写题库包的 JSON 格式、平台变体写法与校验规则 |
| docs/PROGRESS.md | **进度与计划完成情况**（脚本生成：题库规模、难度分布、知识点、50/250 轮里程碑、最近一次实测、发布记录） |
| docs/UI-RESEARCH.md | 界面布局与排版调研：三栏骨架、模块放置、字体阶梯、间距密度，以及本项目现状的实测对照与改造清单 |
| docs/REGRESSION.md | 平台回归清单：探针清单、三环境怎么跑、探针失败怎么办 |
| docs/RELEASE-MAC.md | macOS 发布：构建、签名、公证、分发与常见报错 |
| docs/coverage.md | 覆盖率趋势（每次 --record 追加一行）与门槛来源 |
| docs/COMPLETION-REPORT.md | 完成报告：交付物、证据、已知边界与后续计划 |
| docs/evidence/ | 界面与运行证据（截图等） |

## 扩展点与已知边界

- 新系统：core/platform.mjs 加 profile，题目里加 variants。
- 新题型：packs/*.json 加任务（写法见 docs/WRITING-PACKS.md）；需要新判定语义时在 judge.mjs 加匹配器。
- 新运行环境：runners.mjs 注册后端，实现 execute(spec, options) 返回统一结构即可。
- 新客户端：复用 core/ 加一层 API 适配（macOS 原生客户端、移动端、IDE 插件同理）。
- ponytail: 只读白名单目前手写，题目变多后应从 task.verify 自动生成并人工复核。
- 进度存储：快照 progress.json 用"临时文件 + rename"原子替换并自动留 .bak；新记录先追加到 progress.ndjson（O_APPEND 单行写），攒够 200 条再归档进快照 —— 多进程并发提交不会互相覆盖，断电也不会读到半截 JSON。快照损坏会自动回退 .bak，坏文件改名留档；日志里的半行会被忽略并在 progress 里提示。
- Linux/Windows 真机回归：代码路径已就绪（--platform 与 detectPlatform），需在对应主机跑一遍 probe 与 verify。
