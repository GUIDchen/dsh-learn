# macOS 原生客户端

AppKit + SwiftUI 写的原生客户端（**不依赖 Electron、不嵌 WebView、没有任何第三方依赖**）。
界面是系统控件：三栏（筛选题单 / 题目与作答 / 判定结果），判定引擎仍然是项目目录里的同一份
Node 服务——客户端只说 HTTP，所以题、判定与进度三端共用一套。

## 构建与运行

~~~bash
bash app/macos/build.sh          # 产物：dist/dsh-learn.app
open dist/dsh-learn.app          # 双击也可以
bash app/macos/install.sh        # 装到 ~/Applications
bash app/macos/install.sh --launchagent   # 顺带设置登录自启
bash app/macos/install.sh --uninstall     # 卸载（含自启配置）

# 接口自检（编译 App 里那份 Engine.swift，跑一遍客户端真正走的链路）
swiftc -O -swift-version 5 app/macos/selftest.swift app/macos/Engine.swift -o /tmp/dsh-native-selftest -framework Cocoa
DSH_LEARN_ROOT=$PWD DSH_LEARN_HOME=$(mktemp -d) /tmp/dsh-native-selftest
~~~

构建需要 Xcode 或 Command Line Tools（提供 swiftc / iconutil / sips）。图标由 scripts/gen-icons.py 用纯 Python 生成 PNG，
再用 sips + iconutil 打成 .icns，全程无第三方库。源码三个文件：main.swift（窗口与菜单）、Engine.swift（引擎进程与 HTTP）、
NativeUI.swift（SwiftUI 三栏界面）。

## 界面

| 区域 | 内容 |
| --- | --- |
| 左栏 | 搜索、难度分段（全部/简单/中等/困难，带题数）、轨道下拉、题单（难度圆点、历史最好分）、底部今日目标与连续天数 |
| 中栏 | 题号/轨道/难度、目标、判定要素数、命令输入框（TextEditor）、判定（⌘↩）与清空 |
| 右栏 | 分数、判定、要素进度条、与历史最好对比、已命中片段、缺失项、提示与参考答案、这道题的最近记录 |

## 筛选记忆

轨道、难度、搜索词与选中的题会写进 UserDefaults（键 dsh-learn.native.prefs），重开窗口回到上次的位置；
写坏的取值在读取时会被丢弃（不会把界面卡在空列表）。这一层与界面无关，能被 app/macos/selftest.swift 直接测。

## 它是怎么跑起来的

1. 找 node：环境变量 DSH_LEARN_NODE → /opt/homebrew/bin/node → /usr/local/bin/node → nvm 里最新的一个 → 最后问一次 zsh 登录环境（command -v node）。
2. 找项目：环境变量 DSH_LEARN_ROOT → 构建时写进 Info.plist 的 DSHLearnProjectRoot。
3. **自己挑端口**：客户端 bind 一个空闲端口，再用 node src/web/server.mjs --host 127.0.0.1 --port <端口> 拉起引擎。
   早先版本靠解析子进程 stdout 里的 DSH_LEARN_URL 拿地址，实测在 GUI 进程里管道读端会被系统压后二十多秒，
   启动会随机失败——地址改成客户端自己已知，就只剩"轮询接口"，不再依赖管道时序。
4. 轮询 /api/bootstrap（最多 60 秒）直到 200；等待期间窗口里显示"正在启动本地引擎…"，失败时给出原因与"重试 / 打开日志"。
5. 退出（⌘Q 或关窗）时给子进程 SIGTERM，最多等 3 秒再 SIGKILL。

## 快捷键与菜单

| 操作 | 快捷键 |
| --- | --- |
| 判定当前答案 | ⌘↩ |
| 点命中片段 | 把它从输入里移除（再判定看分数怎么变，与网页版同一个动作） |
| 切换难度（全部/简单/中等/困难） | ⌘1 / ⌘2 / ⌘3 / ⌘4 |
| 聚焦搜索框 | ⌘F |
| 清空搜索 | Esc（在搜索框内） |
| 刷新题库与进度 | ⌘R |
| 在浏览器中打开网页版（同一地址） | ⌘O |
| 打开日志文件 | ⌘L |
| 退出 | ⌘Q |

## 排查

- **窗口显示"找不到 node"**：装 Node >= 18，或设置 DSH_LEARN_NODE 指向 node 可执行文件。
- **一直停在"正在启动本地引擎…"**：项目放在 ~/Documents（或桌面/下载）里时，macOS 的「文稿文件夹」权限会拦住
  从 App 派生的引擎进程——它调 `getcwd()`、`open()` 会卡在系统裁决上，命令一模一样从终端跑却秒过。三个解法，按推荐顺序：
  1. 装到非受保护目录：`bash app/macos/install.sh`（装到 ~/Applications），App 自带引擎，完全不碰项目目录；
  2. 在「系统设置 → 隐私与安全性 → 文件与文件夹」里给 dsh-learn 打开文稿访问；
  3. 把项目移到 ~/Documents 之外，或用 `DSH_LEARN_ROOT` 指向那个位置。
- **日志**：~/Library/Logs/dsh-learn/app.log，里面有引擎输出的每一行（含实际端口）。
- **启动慢或超时**：窗口不在前台时系统会 App Nap 降频，客户端已经用 beginActivity 顶住；仍失败请把日志里的最后一次失败原因贴出来。
- **端口冲突**：客户端挑空端口后立刻关掉再交给引擎，理论上存在被抢走的窗口，重试一次即可。

## 已验证

- 产物体积约 1.6 MB（含内置引擎），codesign 临时签名校验通过。
- 装到 ~/Applications 后实测：App 用内置引擎启动（日志里项目根目录即 `…/dsh-learn.app/Contents/Resources/engine`），
  三栏界面渲染 320 题、难度分段 简单 26 / 中等 273 / 困难 21、题单历史最好分，右栏"这道题的最近记录"读到两条真实判定
  （见 docs/evidence/native-macos-0.13.0.png）。
- app/macos/selftest.swift 覆盖客户端真正走的链路：bootstrap（题库/轨道/难度标签）→ check（半对拿部分分、满分刷新记录、再交一次持平不算记录）→ history（按题过滤、认得出客户端）→ progress（聚合），共 16 条断言。
  scripts/verify.sh 每次都会编译并运行它（进度写临时 HOME，不碰真实进度）。
- 退出后子进程被回收，不留孤儿 node 进程。
