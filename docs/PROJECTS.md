# 从项目 / 仓库里出题（project 与 learn-repo）

把「一个实际项目涉及哪些知识点」变成可复核的记录与题库草案。两条入口：

1. **截图 / 文字 / 链接**：`project add`（截图走 macOS 自带 Vision OCR，本地识别不联网）；
2. **代码仓库**：`learn-repo`（本地目录直接扫，git 链接先浅克隆）。

产物一律落在项目目录里，**不会自动进题库**——草案必须人工改写题面、过 `pack validate` 与 `audit`。

三种输入都能出两类产物：**知识点摘要**（notes/，与 JD 分析同一套字典）与**草案题**（drafts/，从文本里的命令行示例抽取）。
所以「截图里是一段终端记录」「链接页面里有命令块」时，两类产物都会自动生成；纯散文只有知识点，属于预期。
链接来源拿到的整页 HTML 会**先统一转成纯文本**（`htmlToText`：去 script/style、块级标签转换行、实体解码），
知识点与命令抽取用的是同一份文本——这曾经是两套（知识点剥了标签、命令没剥），于是"从网页抽命令"对任何网页都静默失效。

## 项目目录结构

    ~/.dsh-learn/projects/<名字>/
      project.json          来源清单：什么时候加了什么、解析出多少知识点、产出了哪些文件
      notes/               每次输入的摘要（知识点 + 字典没覆盖到的行）
      drafts/              草案包 JSON 与复核清单 Markdown
      tasks.json           项目索引：知识点 → 可练题 + 草案包清单（含「是否已入总题库」）
      promoted/            确认过的正式包（可选，用 project promote --project-only 生成）
      repo/<名字>-<时间>/   git 链接浅克隆下来的仓库（本地目录不会被复制）

`DSH_LEARN_HOME` 可以换根目录；`project.json` 与 `tasks.json` 是纯文本，可以入库进自己的笔记仓库。

`tasks.json` 是**可加载的项目索引**：收完每次来源后自动刷新，任何客户端打开项目都能直接列出
「这个项目能练什么」（知识点 → 可练题）和「有哪些草案还没入库」，不用重新分析一遍。
`project show <名字>` 会把它打印出来，`project show --json` 会在 `index` 字段里给出整份索引。

## 加入总题库

草案是草案，**永远不会自动进题库**。确认要练之后有两条路，区别只在去处：

| 去处 | 命令 | 表现 |
| --- | --- | --- |
| 总题库（用户题库目录） | `node src/cli.mjs project promote <项目> drafts/<草案>.json` | 写进 `~/.dsh-learn/packs/`，所有客户端下次启动就能练到这些题 |
| 项目暂存区 | `node src/cli.mjs project promote <项目> drafts/<草案>.json --project-only` | 只写进 `~/.dsh-learn/projects/<项目>/promoted/`，攒着以后再入库 |

网页版同一件事：「项目 / 仓库」面板 →「列出草案」→「加入总题库…」（先预览）→「确认无误，加入总题库」；
已经在总题库里的草案会标出「已在总题库」，不再重复给按钮。
原生端（macOS App）：「项目 / 仓库」面板展开就列出草案，每行「预览 / 加入总题库 / 暂存到项目」，点「加入总题库」弹二次确认。

**为什么要有两个题库目录**：`<仓库>/packs/` 是随工具发布的那份题库，文档里的数字、知识点对账、
判定强度基线这些护栏都以它为准；用户自己加的题放在 `~/.dsh-learn/packs/`，升级工具不会覆盖，也不会把
那份题库的数字搞乱（实测：用户包直接混进 `packs/` 会让 6 条护栏变红——那不是用户的题有问题，是口径用错了）。
两组题在客户端里是同一份可练题库：能判、能记进度、能进计划。

不适用的包直接删掉文件即可，题库立刻恢复：`rm ~/.dsh-learn/packs/<包 id>.json`。

### 入库前的复核提醒

`--dry-run`（网页版就是先点预览）会打印目标路径与提醒，常见几条：

- 标题还带「草案」字样；提示还是生成时的占位话；
- 只有 1–2 个判定要素（学员随便敲一下就满分）；
- 没有只读验证项（可选，有的话能真跑一次）。

## 岗位站点（BOSS / 拉勾等）抓不到正文时的处理

这类站点对非浏览器请求返回的是**验证页 / JS 壳**（实测 BOSS 返回的正文只有 71 字：「请稍候 - BOSS直聘 … 正在加载中…」）。
过去这种页面会被当成正常正文分析，给出「识别出 1 个知识点」这种看似成功、实则糊弄的结果；现在会被明确拦下：

```
$ node src/cli.mjs project add pay-gw --url https://www.zhipin.com/job_detail/xxx.html
抓取失败：页面是验证页 / JS 壳，不是正文（命中：请稍候、正在加载中、正在加载）——这类站点对非浏览器请求做了反爬；
可行路径：① 截图（本机 OCR，离线）② 把正文复制成文字粘进来 ③ 登录后带 Cookie 再试（--cookie / --cookie-file）。
```

三条路都实测过：截图走 `--file`（macOS Vision OCR，不联网）、文字走 `--text`、Cookie 走 `--cookie`/`--cookie-file`。
判定规则是「命中反爬特征词 **且** 正文很短」——一篇几千字、正文里恰好提到验证码的技术文档不会被误伤。

## 命令

    # 建项目（重名会拒绝，不会覆盖已有项目）
    node src/cli.mjs project init payment-service

    # 收输入：截图 / 文字 / 链接（三种都能重复加，每次都会记账）
    node src/cli.mjs project add payment-service --file 架构讨论截图.png
    node src/cli.mjs project add payment-service --text "熟悉 Docker Compose；会用 kubectl 排查 Pod；了解 tcpdump"
    node src/cli.mjs project add payment-service --url https://example.com/deploy-guide

    # 解析仓库：本地目录直接扫，git 链接先浅克隆（--depth 1）
    node src/cli.mjs learn-repo ./payment-service --project=payment-service
    node src/cli.mjs learn-repo https://github.com/owner/repo --project=payment-service
    node src/cli.mjs learn-repo owner/repo --project=payment-service        # GitHub 简写
    node src/cli.mjs learn-repo owner/repo --branch=release/1.x             # 指定分支
    node src/cli.mjs learn-repo owner/repo --refresh                        # 强制重拉（默认复用上次克隆）

    # 网页版同一套能力：中栏「项目 / 仓库 → 知识点 → 题目草案」
    #   填项目名 → 建立项目；截图（本地 OCR）/ 文字 / 链接 / 仓库本地路径 / 仓库地址 五个入口都能用
    #   结果区会列出技术信号、命中的知识点与写入的项目文件；对应接口 POST /api/project

    # 看这个项目收了什么
    node src/cli.mjs project show payment-service
    node src/cli.mjs project list

## 拉不到 GitHub 时怎么办（克隆路线）

国内网络直连 github.com 经常握手就断，所以 `learn-repo` 不是"一次不成就算了"：

1. **候选链**：先直达 GitHub，再依次试 `ghfast.top` / `gh-proxy.com` / `ghproxy.net`；每一条都打印实际访问的地址，失败原因逐条列出（超时 / 403 / repository not found 分开写）；
2. **本机 git 改写**：很多人配了 `url.<镜像>.insteadOf`。这时"直连"其实也走了镜像，工具会先读这份配置并**明说**，"直连失败"后面跟着镜像域名就不会再让人猜；
3. **固定走某个镜像**：`DSH_LEARN_GIT_MIRROR=https://ghproxy.net node src/cli.mjs learn-repo …`（设了就只用它，失败时会提示取消这个变量回到默认链）；
4. **复用上次克隆**：同一仓库第二次解析直接用 `repo/<名字>-*/<时间戳>` 里那份，不重复下载（网络断了也能继续看上次的结果）；要重拉加 `--refresh`；
5. **兜底**：真的拉不到就先自己 `git clone`，把本地目录交给 `learn-repo`——本地目录一步都不走网络。

每次解析都会在笔记里写一行**来源方式**（本地目录 / 复用上次克隆 / 直连 GitHub 克隆 / 镜像克隆），复核时能看出这份结论是怎么来的。
`--json` 输出里的 `via`、`source` 也是同一份信息，方便脚本判断。

这套克隆路线（归一化地址 → 候选链 → 复用 → 失败明细）在 `src/core/repo-learn.mjs` 的 `resolveRepoDir()` 里只有**一份实现**：
命令行 `learn-repo` 与网页版 `POST /api/project` 都调它，所以"命令行能拉、网页拉不动"这类分叉不会出现。
网页版的结果区同样会显示来源方式（`via`），而不是让用户猜这次到底是新拉的还是复用的。

## 仓库解析做了什么

1. **有界扫描**：默认最多 4000 个文件、6 层目录，跳过 `.git` / `node_modules` / `target` / `dist` / `vendor` 等；
2. **技术信号**：Dockerfile、Compose、k8s 清单（按 kind 嗅探）、CI 配置、Makefile、Shell 脚本、go.mod、Cargo.toml、requirements.txt、package.json、Terraform、Ansible、systemd 单元、数据库脚本、嵌入式产物……
3. **知识点匹配**：把「文件清单 + 技术信号 + 清单文件内容」拼成仓库画像，喂给**与 JD 分析同一套知识点字典**，于是「这个仓库涉及什么」和「这个岗位要求什么」能对得上；
4. **命令抽取**：从 README / Makefile / 脚本 / CI 配置里抽命令示例，生成草案任务（含要素与相关禁止项），并给出复核清单。

## 把项目当工作台用

- 网页版「列出项目」现在显示每个项目**累计的知识点数与草案题数**；点项目名打开详情：来源清单（时间/类型/来源/知识点/草案题）与全部产物文件路径；
- 项目可以**深链**：地址里带 `#project=名字` 直接打开该项目（可收藏/发给同事）；不带 hash 时会把你上次看的项目填进输入框，不自动拉数据；
- 详情里有**「用这些知识点开练」**：把项目里命中的知识点映射成可练的题目（与 JD 分析同一套映射：知识点挂了哪些题就练哪些），
  直接刷新建议面板并把清单存到本机（刷新后还能接着练）；旧记录没有知识点 id 时会提示"重新收一次来源"；
- 「删除这个项目」会删掉整个项目目录（notes / drafts / promoted 一起），**需要输入项目名确认**才执行，防误点；
- 页头会显示**版本号**（接口 /api/bootstrap 的 appVersion）：老页面配新服务端时一眼可见，报 bug 也能说清版本。

## 从项目直接开练（project tasks）

项目里命中的知识点都挂着题，所以「这个项目能练什么」是可以算出来的：

    # 列出项目覆盖的题目（表格，带轨道与难度）
    node src/cli.mjs project tasks payment-service

    # 换机器可读的格式
    node src/cli.mjs project tasks payment-service --json
    node src/cli.mjs project tasks payment-service --csv

    # --csv 的输出可以直接喂给 drill：一个项目一条命令开练
    node src/cli.mjs drill --tasks=$(node src/cli.mjs project tasks payment-service --csv)

- 命令行 `learn-repo` 现在会把命中的知识点 id 一起写进 `project.json`，网页版与命令行记录同一套 id，行为一致；
- 老项目（只有知识点标题、没有 id）会提示重新收一次来源，不会静默给出空清单。

## 草案转正式包（网页与命令行都行）

    # 命令行：先预览会写什么，再真转
    node src/cli.mjs pack promote <草案.json> --dry-run
    node src/cli.mjs pack promote <草案.json>            # 写到 packs/<包名>.json

    # 网页版：中栏「项目 / 仓库」里点「列出草案」→「预览」→「确认无误，转成正式包」
    #   网页版只写到项目的 promoted/ 目录并给出下载链接，不动仓库里的 packs/

promote 会做两件机器能确定的事：**校验 schema**（不过就中止）与**按难度口径自动补 level**；
题面改写仍然交给人，可改可不改的点会列成复核提醒（标题还带草案字样、提示是占位话、要素太少、没有只读验证项）。

## 出题前后的边界

- **草案 = 提案**：`drafts/*.json` 不会被自动加载，`audit` 也不看 drafts 目录；
- **入库三步**：改写题面与提示 → `node src/cli.mjs pack validate <草案>` → `node src/cli.mjs audit`；
- 外部包还想再放心一点，可以用 `pack sign` / `pack trust` 加一道信任门禁（见 docs/WRITING-PACKS.md）；
- 工具名识别表在 `src/core/site-learn.mjs` 的 `TOOL_TRACK`：认不出来的工具**宁缺毋滥**，不会硬凑成题；
- 带环境变量的命令（`CGO_ENABLED=0 GOOS=linux go build …`）会先剥掉前导 `VAR=value` 再认工具名。

## 已知边界

- 截图 OCR 依赖 macOS Vision（`--ocr` / `--file *.png`）；Linux/Windows 需要外部 OCR（见 README）；
- 私有仓库需要先配好 ssh key 或 token，工具只做 `git clone --depth 1`，不做鉴权交互；
- 仓库画像只读「清单类文件 + README」，不会深读业务代码；想补充就用 `project add --text` 贴关键片段。
- `project.json` 坏掉时**不会覆盖**：`project add` / `project init`（命令行）与 `POST /api/project`（网页版）都会拒绝并说明原因，
  原文件原样留着——先备份或修好那个 JSON，或者换个项目名再试。
