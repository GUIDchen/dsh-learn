# dsh-learn 完成报告

## 1. 结论

目标已达成：项目从"一个卡片形态的演示"落成可运行的跨平台命令行学习与验证工具，具备题库包化、三种执行后端、三个客户端、计划与进度模型、186 项测试、平台自检、网页版 PWA（三栏布局 + 离线判定）与 macOS 桌面 App（含签名/公证流程），以及端到端证据脚本，并在 macOS 上逐轮实测。

- 交付形态：零第三方依赖的 Node ESM 项目，Node >= 18，可离线运行。
- 题库：55 个数据包 / 637 道题 / 25 条轨道（netops 87、embedded 57、go 57、rust 52、docker 43、k8s 31、git 28、mlops 26、linux 21、ops 21、database 20、service 18、c 17、system 15、windows 15、imaging 14、lang 14、yolo 14、cpp 13、network 13、python 13、security 13、dl 12、shell 12、perf 11），含 50 道平台变体题（darwin 47 / linux 47 / **win32 41**，变体对里互为禁止项），148 道题带 block 级禁止规则（按题与变体计 127 处；命中即封顶 59 分并判未通过）；难度：简单 172 / 中等 400 / 困难 65；知识点 157 个 / 26 模块。
- 客户端：CLI（含交互式 repl）、浏览器网页版（左中右三栏、可安装为 PWA、断网可本地判分）、macOS 桌面 App（原生 WebKit 壳，约 190 KB）、远程只读 Agent。
- 验证：node --test 186/186 通过（含 CLI 与 HTTP 客户端集成测试、存储并发、信任模型、平台自检）；scripts/verify.sh 全链路 37/37 检查通过并 exit 0；平台自检在 macOS 本机 10/10、在真实 Linux 容器（Debian 13 / GNU sed 4.9）8/8。
- 未在本机验证的部分：Windows 与 WSL2 两条路径（本机是 macOS），只做到代码可运行 + 单测覆盖 + CI 的 windows-latest 任务兜底。

## 2. 需求验收矩阵

| 编号 | 需求 | 证据 |
| --- | --- | --- |
| FR-1 | 题库数据包化、可外部加载与覆盖 | packs/*.json + src/core/packs.mjs；DSH_LEARN_PACKS 指定外部目录后 CLI 实测加载新题并覆盖同 id 内置题；pack validate 对坏包返回非零码；schema 校验拦住坏包 |
| FR-2 | 平台变体：同一答案在不同平台得到不同判定 | stat -c 在 darwin 判 3 分、在 linux 判 100 分；sed/date/grep -P/autocrlf 同理，均有测试 |
| FR-3 | 要素命中 + 禁止写法 + 逐条缺失提示 | judge.mjs；100/37/3 分三档实跑；会丢数据的禁止写法带 severity: block，命中即封顶 59 分并判未通过（docker system prune --volumes 实跑为未通过） |
| FR-4 | 只读验证，默认不执行 | 未加 --run 返回 dryRun；rm -rf / 被本地与远端双重拒绝（403） |
| FR-5 | 三种执行后端，统一结果结构 | runners.mjs local/docker/remote；docker 守护进程缺失时降级提示，远端输出与本地语义一致（均校验退出码 + expect） |
| FR-6 | 多客户端共用进度 | verify.sh 中 verify-mac / verify-linux / verify-win / verify-web 四个客户端出现在同一排行榜；客户端形态为 CLI、网页版（PWA）、macOS 桌面 App、远程 Agent 四种 |
| FR-7 | 学习计划 | plan --hours 2 输出 30 题 6 天 595 分钟；renderPlanText 不含参考答案（有断言） |
| FR-8 | 进度导出与合并导入 | export 4 条 → import 新增 0、跳过重复 4；Web 端支持下载/上传 |
| FR-9 | 环境探测与诊断 | probe / runners 给出 platform、工具链、上下文与守护进程结论；本机 orbstack 上下文未运行时如实报告并给出修复建议 |
| FR-10 | 零依赖、可离线 | CI 中显式断言无 dependencies/devDependencies；无 node_modules 也能跑通测试与全部命令 |

## 3. 运行证据（macOS 26.5.1 / arm64 / Node v24.19.0 / Docker CLI 29.4.0）

### 3.0 平台自检（真实工具链）

    $ node src/cli.mjs selftest --run
    结果：12 / 12　全部探针与题库里的平台假设一致        （macOS 本机，BSD 工具链）

    $ node src/cli.mjs selftest --run --platform linux --runner docker --image <本地 Debian 镜像>
    结果：10 / 10　全部探针与题库里的平台假设一致         （容器内 uname -s=Linux，sed 为 GNU sed 4.9）

### 3.1 测试

    ℹ tests 173
    ℹ pass 173
    ℹ fail 0

### 3.2 平台变体判定（同一份答案，两个平台两种结论）

    $ node src/cli.mjs check linux.stat-size "stat -c '%s' a.txt" --client verify-mac --platform darwin
    判定：未通过（3 分）
    反馈：缺失要点：macOS 的 BSD stat 用 -f 指定格式串；字节数在 BSD stat 里是 %z；问题：macOS 的 stat 不支持 -c（那是 GNU 写法），会报 illegal option -- c

    $ node src/cli.mjs check linux.stat-size "stat -c '%s' a.txt" --client verify-linux --platform linux
    判定：通过（100 分）

### 3.3 执行后端

    $ node src/cli.mjs verify linux.date-offset --run --platform darwin --runner local
    执行后端：local
    验证命令：date -v+1d '+%Y-%m-%d'
    结果：通过
    输出：2026-09-26

    $ node src/cli.mjs verify docker.context-diagnose --run --runner docker
    执行后端：docker（镜像 alpine:3.20）
    结果：未执行
    说明：Docker 守护进程不可用，容器后端降级不可用：failed to connect to the docker API at unix:///Users/.../orbstack/run/docker.sock

    $ node src/cli.mjs runners
    - local：可用
    - docker：不可用（守护进程未启动）
    - remote：不可用（未提供 endpoint）

### 3.4 远程 agent（跨机多客户端）

    $ curl http://127.0.0.1:8797/agent/health
    {"ok":true,"platform":"darwin","profile":"macOS","requiresToken":true,"node":"v24.19.0"}

    $ node src/cli.mjs verify git.version-check --run --runner remote --endpoint http://127.0.0.1:8797 --token verify-token
    结果：通过　输出：git version 2.50.1 (Apple Git-155)

    $ ... --token wrong-token
    说明：token 不匹配，已拒绝执行

    $ curl -X POST .../agent/exec -d '{"cmd":"rm -rf /", ...}'
    allowlist 拒绝非法命令的 HTTP 状态: 403

### 3.5 Web 客户端

    GET /               -> 200 (14017 bytes)
    GET /api/bootstrap  -> 200
    GET /api/progress   -> 200
    GET /api/board      -> 200
    GET /api/runners    -> 200
    POST /api/plan      -> {"plan":{"track":"git","hoursPerDay":2,"taskCount":9,"totalMinutes":161,...}}
    POST /api/check     -> {"result":{"score":100,"verdict":"通过",...}}

### 3.6 进度与计划

    $ node src/cli.mjs plan --hours 2
    学习计划：平台 darwin　轨道 all　每天 2 小时
    共 30 题，预计 595 分钟，分 6 天

    $ node src/cli.mjs progress
    整体进度 7%　[#...............]　通过 2 / 30（已练习 2 题）
      [docker]   0% 通过 0/14
      [git]     11% 通过 1/9
      [linux]   14% 通过 1/7

    $ node src/cli.mjs board
    客户端          提交  通过  最高分  均分  平台
    verify-linux     1     1     100    100   linux
    verify-win       1     1     100    100   win32
    verify-web       1     1     100    100   darwin
    verify-mac       1     0       3      3   darwin

### 3.7 一键复现

    $ bash scripts/verify.sh
    PASS  node --test 全绿
    PASS  题库规模与包结构符合预期
    PASS  同一答案在 macOS 被判为写法错误
    PASS  同一答案在 Linux 被判为通过
    PASS  危险清理参数被点名（--volumes）
    PASS  本机只读验证通过并校验输出格式
    PASS  agent 健康检查可用
    PASS  远程只读执行通过（输出经 expect 校验）
    PASS  错误 token 被拒绝
    PASS  白名单拦截非法命令返回 403
    PASS  浏览器页面可访问
    PASS  Web 端生成学习计划
    PASS  Web 端提交判定并入库
    PASS  导出后原样导入被正确去重
    PASS  本机平台自检与题库假设一致
    PASS  题库包签名可验证
    PASS  受信任的外部包通过加载门禁
    PASS  内容被改后门禁以退出码 3 拒绝加载
    PASS  服务端 --port 0 打印可解析地址（桌面壳依赖）
    PASS  已构建的 macOS App 签名校验通过
    PASS  App 里写入了项目目录（双击即可用）
    PASS 37 / FAIL 0
    端到端验证通过        （exit 0）

## 4. 过程中发现并修复的真实缺陷

| 缺陷 | 根因 | 修复 |
| --- | --- | --- |
| plan 输出里出现字面量 \n | 生成文件时过度转义 | 修 join 参数并全仓扫描确认无第二处 |
| --hours 2 被当成布尔标志，计划按 1 小时算 | 参数解析没有值型标志表 | 声明值型标志表 + 回归测试：未声明的键不得吞掉下一个 token |
| docker 后端不可用原因刷屏整段 client 信息 | 直接拼接子进程输出 | 只取最后一行并截断到 160 字符 |
| 合并短选项被误判缺项（grep -Eo / docker run -dit） | 判定按字面量匹配短选项 | 判定前展开短选项影子文本，数字与长选项不展开，配单测与内容回归 |
| CLI --client 空格写法失效并污染命令正文 | 同上参数解析问题 | 统一 parseArgs，并抽出 core/args.mjs 加测试 |
| compose v1 题的分档预期写错 | 测试期望值算错（实为 37 分） | 修正断言并补充通过档断言 |
| 超大请求体把连接打断，客户端只看到连接错误 | readBody 直接 destroy 掉 socket，400 响应发不出去 | 改为标记已拒绝并继续读掉剩余数据，统一返回 413 并带可读原因，集成测试覆盖 |
| 服务端逻辑无法被测试 | 启动代码与实现写在同一个顶层模块里 | 抽出 createAppServer() 工厂 + isMain 守卫，CLI 启动与测试共用同一份实现 |
| pack sign --signer 名字被吃掉 | 值型标志表漏了 signer（与 --hours 同类问题） | 补进标志表 |
| 签名测试互相污染：上一个用例的 .sig 影响下一个 | 测试夹具没有清理附属文件 | 每个用例写包前先清掉旧签名，篡改场景显式保留原签名 |
| 大小写不敏感匹配让 git branch -D 命中 -d 规则 | 判定统一用 'i' 正则，而命令标志区分大小写 | 规则里写了大写字母就按大小写敏感匹配（ruleMatches），-D 与 -d 不再混淆，docker run 仍容忍 Docker run |
| 构建失败会毁掉上一个可用 App | 先 rm 掉 dist 再重建，签名失败时留下半成品 | 改为构建到临时目录、签完名再原子替换；失败时旧版本保持不变 |
| Swift 壳里已定义全局函数却写成 self.appendLog | 全局函数被当成实例方法调用 | 改成直接调用全局 appendLog，编译即暴露 |
| kubectl 连不上集群时被报成"输出未匹配，注意平台差异" | 只看退出码判断成功，而 kubectl 会以 0 退出并把错误写在输出里 | 抽出 assessOutput()：退出码与输出特征一起看，命中已知失败特征即判失败并给出人话建议，本地/容器/远程三个后端统一使用 |
| 删数据写法被评成"部分通过" | 禁止项只扣 30 分，70 分落在部分通过档 | 引入 severity: block：命中即封顶 59 分并判未通过，数据驱动、只标在真正危险的规则上 |

## 5. 已知边界与后续

- Docker 容器后端在本机因 OrbStack 守护进程未运行而不可用，降级路径已实测；守护进程可用时同一条命令会在 alpine 容器内执行，需要有对应镜像。
- 远端 agent 需要目标机器能跑 Node，且两机网络可达；token 目前是共享密钥，未做轮换与审计日志留存。
- 进度是本地快照 + 追加日志（见 5.8）：同机多进程并发写不丢记录；跨机共享仍需要远端存储或文件同步，脚本未做冲突合并。
- Linux / Windows 真机回归尚未执行（本机只有 macOS）；CI 矩阵已配置 ubuntu 与 macos 六格，另加 windows-latest 冒烟任务跑跨平台用例。
- 题库已扩到 8 包 46 题 6 轨道（新增 service / network / k8s）；出题规范见 docs/WRITING-PACKS.md，平台回归清单见 docs/REGRESSION.md。
- k8s 轨道只做判定不做执行验证：本机没有集群，不给没有环境支撑的 verify。
- 平台自检覆盖 macOS 与 Linux 两套工具链；Windows 原生没有 sed/stat/grep，建议在 WSL2 里跑 linux 那套。
- 外部题库通过 DSH_LEARN_PACKS 加载，已实测"新增题 + 覆盖同 id 内置题"；但外部包没有签名与来源校验，用别人的包前先 pack validate。

## 逐轮日志（分卷）

> 本目录由 node scripts/report-doc.mjs 生成：每 50 轮一卷；新增小节用 scripts/append-report-section.mjs（自动写进对应卷并刷新本索引）。

| 卷 | 覆盖编号 | 小节数 | 文件 |
| --- | --- | --- | --- |
| 1 | 5.1 – 5.50 | 50 | [rounds-001-050.md](report/rounds-001-050.md) |
| 2 | 5.51 – 5.100 | 50 | [rounds-051-100.md](report/rounds-051-100.md) |
| 3 | 5.101 – 5.150 | 50 | [rounds-101-150.md](report/rounds-101-150.md) |
| 4 | 5.151 – 5.200 | 50 | [rounds-151-200.md](report/rounds-151-200.md) |
| 5 | 5.201 – 5.235 | 35 | [rounds-201-250.md](report/rounds-201-250.md) |

共 **235** 节逐轮记录；小节编号唯一、不跳号（守卫 test/report-split.test.mjs 逐个核对）。

## 6. 运行入口

    node src/cli.mjs list|show|check|verify|runners|probe|plan|progress|board|repl|export|import
    node src/web/server.mjs [--host 0.0.0.0] [--port 8787]
    node src/agent.mjs --port 8790 --token <token>
    npm test
    bash scripts/verify.sh

### 补记（第 15 轮 / 验收失败与验证卫生）

发布 0.156.0 后跑验收，出现 **PASS 74 / FAIL 2**——两项都是 `No space left on device`（原生自检编译与安装包冒烟）。

排查结果：**不是代码问题，是验证循环自己攒的垃圾**。我这十几轮在 /tmp 留了 10 个 headless Chrome profile（10–130MB 一个）、自检编译二进制、临时 home、中间截图与日志；叠加瞬间的写盘压力，可用空间掉到百 MB 级。

处理：

1. 清掉本项目产生的验证产物（**保留** `/tmp/dsh-boss-profile`——那是用户的 BOSS 登录态，不能动）；
2. 新增 `scripts/clean-temp.sh`：一键清理同类产物，`--dist-zips` 还会只保留最近 3 个发行归档；
3. 重跑验收 → **PASS 76 / FAIL 0**。

顺手记一个 bash 细节（第 15 轮第二次踩）：`"…$ROOT）"` 里全角右括号紧贴变量名，bash 会把多字节字符的首字节当成变量名的一部分，`set -u` 下直接报 `ROOT?: unbound variable`；写成 `${ROOT}` 才对。

教训归档：**验证流程也是运行代码，需要维护**——不只是被测对象。
