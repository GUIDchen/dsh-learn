# 平台回归

题库里写死的每条平台差异，都必须能在真实机器上复现。这个仓库把"复现"做成了一条命令，而不是一段说明文档。

## 一条命令

~~~bash
node src/cli.mjs selftest          # 先看探针清单（默认不执行）
node src/cli.mjs selftest --run    # 真的在当前机器上跑一遍，逐条比对
~~~

通过时退出码 0，任何一条与题库假设不符时退出码 1，并打印该条的"为什么这么判定"。
探针是源码里的常量（src/core/selftest.mjs），不接受任何外部输入，因此它是唯一不经过只读白名单的执行路径；
用户输入的命令依然只能走 exec.mjs 的白名单。

## 三个环境怎么跑

| 环境 | 怎么跑 | 说明 |
| --- | --- | --- |
| macOS 本机 | node src/cli.mjs selftest --run | 跑 darwin 的 12 条探针（BSD 工具链） |
| Linux 主机 | node src/cli.mjs selftest --run | 自动识别为 linux，跑 10 条 GNU 探针 |
| 没有 Linux 主机 | node src/cli.mjs selftest --run --platform linux --runner docker --image <本地镜像> | 在一次性容器里跑同一组 GNU 探针，拿到真实的 GNU 证据 |
| Windows | 在 WSL2 里跑 linux 那套 | Windows 原生没有 sed/stat/grep，建议直接进 WSL2；Git Bash 也可用 |

## 探针清单

| id | 命令 | macOS 期望 | Linux 期望 | 为什么 |
| --- | --- | --- | --- | --- |
| sed-plain | sed -i 's/h/H/' f | fail | ok | BSD sed 的 -i 必须带后缀 |
| sed-empty-suffix | sed -i '' 's/h/H/' f | ok | fail | GNU sed 把 '' 当成文件名 |
| stat-gnu | stat -c '%s' f | fail | ok | BSD stat 没有 -c |
| stat-bsd | stat -f '%z' f | ok | fail | GNU stat 的 -f 是文件系统信息 |
| grep-pcre | grep -P 'h.l' f | fail | ok | BSD grep 没有 -P |
| grep-ere | grep -E 'h.l' f | ok | — | macOS 上用 -E 替代 -P |
| date-gnu | date -d '+1 day' | fail | ok | BSD date 没有 -d |
| date-bsd | date -v+1d | ok | fail | GNU date 没有 -v |
| ss | ss -ltn | fail | — | macOS 没有 ss，端口排查用 lsof |
| find-printf | find . -printf '%s\n' | fail | ok | BSD find 没有 -printf（unknown primary），列大小要配合 stat -f %z |
| du-max-depth | du --max-depth=1 . | fail | ok | BSD du 不认 --max-depth，深度限制写 -d 1 |
| uname | uname -s | ok | ok | 平台标识 |

## 本轮实测结果

macOS 26.5.1 / arm64：

    平台自检：macOS / BSD 工具链　执行方式：local
    PASS  sed-plain / sed-empty-suffix / stat-gnu / stat-bsd / grep-pcre / grep-ere
    PASS  date-gnu / date-bsd / ss / find-printf / du-max-depth / uname
    结果：12 / 12　全部探针与题库里的平台假设一致

真实 Linux 容器（Debian GNU/Linux 13，GNU sed 4.9）：

    平台自检：Linux / GNU 工具链　执行方式：docker（镜像 docker.m.daocloud.io/library/python:3.12-slim）
    PASS  sed-plain / sed-empty-suffix / stat-gnu / stat-bsd
    PASS  grep-pcre / date-gnu / date-bsd / find-printf / du-max-depth / uname
    结果：10 / 10　全部探针与题库里的平台假设一致

容器里同样验证过：uname -s 输出 Linux，sed --version 输出 GNU sed 4.9，date -d 可用而 date -v 报 invalid option。

## Windows 与 WSL2

原生 Windows 没有 sed / stat / grep，题库里的 Linux 题在那边没法练，所以 win32 那组探针断言的是**这些工具的缺席**：

| id | 命令 | 期望 | 说明 |
| --- | --- | --- | --- |
| where-sed | where sed | fail | 原生 Windows 没有 sed |
| where-stat | where stat | fail | 原生 Windows 没有 stat |
| where-systemctl | where systemctl | fail | Windows 没有 systemd，服务管理是另一套 |
| where-wsl | where wsl | ok | Win10/11 自带 wsl.exe |
| node-version | node -v | ok | 工具本身要求 Node >= 18 |
| ver | ver | ok | 确认是原生 Windows，不是 MSYS/Git Bash |

Windows 上探针用 cmd /c 执行（POSIX 平台用 sh -c），这一步由 PLATFORM_SHELL 决定。

推荐路径：在 WSL2 里跑 linux 那一套。

~~~powershell
wsl --install          # 首次安装
wsl                    # 进入 Linux
node --version         # 确认 WSL 里也有 Node >= 18
node src/cli.mjs selftest --run     # 走的 linux 探针，应当 10/10 通过
~~~

在 WSL 里执行时，自检会额外打印一行"检测到 WSL2 环境"（依据是 /proc/version 里带 Microsoft/WSL）。

**诚实说明**：本次交付的机器是 macOS，Windows 与 WSL2 这两条路径我没有条件真机执行，只做到了三件事——
代码路径可运行（win32 探针 + shell 选择 + WSL 检测都有单测）、文档写清预期、CI 的 windows-latest 任务会跑
node src/cli.mjs selftest --run 来兜住。真机回归需要你在 Windows 上跑一次并把结果反馈回来。

## CI 门禁

.github/workflows/ci.yml 在 ubuntu 与 macos 的每一格都会执行 node src/cli.mjs selftest --run：
ubuntu 上验证 GNU 假设，macos 上验证 BSD 假设。任何一边的题库假设写错，CI 立刻变红。

## 探针失败了怎么办

1. 先确认这台机器是不是你以为的那种工具链：which sed stat grep date ss lsof。
2. 如果这台机器确实不同（例如 Alpine 的 busybox、Git Bash 的 MSYS），说明题库里的差异描述对这类环境不成立——要么改题库，要么把这类环境明确排除（写成平台说明）。
3. 如果是某条命令"其实也能用"（我们实测排除了 readlink -f、xargs -r、sort -V 三个"文档里的伪差异"），那么题库里对应的 forbid 规则就应该删掉，而不是留着吓人。
## 网页版无障碍巡检（浏览器里可复跑）

自动化测试能钉住 markup 与脚本里的属性，但**对比度与可访问名要在真页面里量**。这段脚本贴进浏览器控制台就能跑
（不引任何依赖，直接读计算样式算 WCAG 对比度）：

```js
// 1) 对比度：只算真正的文字节点；背景沿父链找到第一个不透明色
const parse = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null;
  const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
const lum = c => { const f = v => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const bgOf = el => { for (let n = el; n; n = n.parentElement) { const bg = parse(getComputedStyle(n).backgroundColor);
  if (bg && bg.a > 0.5) return bg; } return { r: 255, g: 255, b: 255, a: 1 }; };
[...document.querySelectorAll('body *')].filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
  .map(el => { const s = getComputedStyle(el); const size = parseFloat(s.fontSize);
    const need = (size >= 24 || (size >= 18.66 && +s.fontWeight >= 700)) ? 3 : 4.5;
    return { el, ratio: ratio(parse(s.color), bgOf(el)), need }; })
  .filter(x => x.ratio < x.need)
  .forEach(x => console.log(x.ratio.toFixed(2) + '/' + x.need, x.el.className || x.el.tagName, x.el.textContent.trim().slice(0, 24)));

// 2) 可访问名：别忘了 <label> 包裹这种合法写法
[...document.querySelectorAll('button, a, input, select, textarea')].filter(el =>
  !((el.getAttribute('aria-label') || el.textContent || '').trim() || el.closest('label') || el.getAttribute('title') || el.placeholder))
  .forEach(el => console.log('无名字', el.tagName, el.id || el.className));
```

**2026-09-27（0.45.0）实测**：

| 项 | 结果 |
| --- | --- |
| 首屏耗时 | `window.__dshPerf`：bootstrap 20ms、首屏列表 32ms、526 题 |
| 对比度不达标项 | 修前 60 处（全是列表里的状态圆点 `.dot-none` 2.58:1）；修后 **0 处**（`#6b7280` 4.83:1） |
| 可访问名缺失 | **0 处**（8 个输入框用的是 `<label>` 包裹写法，第一版脚本没认，差点误报） |
| 跳转链接 / 焦点环 / aria-live | 都在（`class="skip" href="#main"`、`:focus-visible`、4 个 `aria-live` 区域） |
| 可聚焦元素 | 169 个，无 `tabindex="-1"` 误用 |

一条经验：**先跑脚本再改代码**。这轮如果按「感觉」去调颜色，很可能把本来达标的次要文字一起改坏；
量出来只有圆点不达标，而圆点恰好是装饰（同行文字已经写了状态），所以既标了 `aria-hidden`，也把颜色抬到 4.83:1 以上。
## 工具缺失的环境怎么验（降级行为）

CI 容器里没有 docker、客户机器上没有 kubectl、tcpdump 要 root——"工具不在"是常态，所以降级行为也要能复现：

~~~bash
# 只留 node 与系统基础命令：docker 在 /usr/local/bin、tcpdump 在 /usr/sbin，从这里看不见
export PATH="$(dirname "$(which node)"):/usr/bin:/bin"
node src/cli.mjs runners                  # 应报告 Docker 不可用并说明原因，退出码仍是 0
node src/cli.mjs verify docker.run-web --run   # 应指出"这台机器没有这个命令"，而不是抛堆栈
node src/cli.mjs selftest --run           # 不依赖 docker 的探针照常全过
node src/cli.mjs audit                    # 纯文件命令不受影响
~~~

**2026-09-27（0.72.0）实测**：runners 报「Docker 守护进程不可用：docker info 在 5000ms 内没有返回（守护进程无响应）」；
verify 报「这台机器没有这个命令：换用平台等价的工具」并把 `/bin/sh: docker: command not found` 原样附上；
selftest 12/12 通过；audit 560 题 0 提醒。
同一条命令在有 docker 的环境里会报「可用」——说明这个检查确实在测环境，而不是恒真。

这条路径现在有测试钉住（test/cli.test.mjs：缺工具的环境不崩、且给出可执行提示）。
