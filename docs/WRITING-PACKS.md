# 写一个题库包

题库是纯数据：新增技能点、加一门语言、补一个平台的写法差异，都只需要写 JSON，不需要改代码。
包在新增加载时就经过校验（id 唯一、要素非空、正则可编译、验证命令必须在只读白名单内），坏包会被直接拒绝，不会带病运行。

## 1. 最小可用包

~~~json
{
  "id": "demo-pack",
  "name": "示例包",
  "track": "demo",
  "version": 1,
  "tasks": [
    {
      "id": "demo.echo",
      "track": "demo",
      "title": "打印一行文本",
      "goal": "把 hello 打印到标准输出",
      "hint": "echo 是最基础的输出命令",
      "sample": "echo hello",
      "require": [{ "p": "echo\\s+hello", "tip": "应使用 echo 输出 hello" }],
      "forbid": []
    }
  ]
}
~~~

id 规则：包 id 用小写短横线；任务 id 必须形如 track.name（小写字母数字与短横线），全库唯一。

## 2. 字段说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| title | 是 | 题目名，列表与计划里都会显示 |
| goal | 是 | 一句话说清要达成什么 |
| hint | 否 | 卡住时给的提示，不直接给答案 |
| sample | 否 | 参考答案，判定未通过时一起展示 |
| require | 是 | 判定要素数组，全部命中才满分 |
| forbid | 否 | 禁止写法数组，命中扣 30 分 |
| verify | 否 | 可执行验证项：{ cmd, expect, note } |
| variants | 否 | 平台变体，见第 3 节 |
| level | 否 | 难度标注：easy / medium / hard（默认 medium），见第 2.1 节 |

要素 rule：{ p: 正则, tip: 缺失说明 }。
禁止项 rule 多一个可选的 severity：

- warn（默认）：扣 30 分，档位按分数走。
- block：扣分之外把分数封顶 59，直接判未通过。用在会丢数据的写法上（删卷、reset --hard、rm）。

### 2.1 难度标注（level）

三档：easy（简单）、medium（中等）、hard（困难）；不写按 medium 算，写别的值加载即报错。

口径故意做成可复算的，避免"凭感觉标"：

- 数要素：require 的条数；**带平台变体的题按变体里的 require 条数算**（变体往往把一件事拆得更细，按基础 require 算会把它算轻）。
- easy：≤3 要素，且没有 forbid、没有 variants。
- medium：4–5 要素，或带 forbid / variants 的 ≤3 要素题。
- hard：≥6 要素；或 ≥5 要素且含 block 级禁止项。

口径的唯一实现是 `src/core/tasks.mjs` 的 `expectedLevel(task)`：题库体检会拿它复核每个标注，测试也拿它兜底——标注和口径对不上会被点名。

客户端按 level 过滤（`node src/cli.mjs list --level=hard`、网页版左栏难度筛选），
网页版同时按 `node src/cli.mjs tasks --json` 的字段做颜色区分。

## 3. 平台变体

同一个动作在 BSD 与 GNU 上写法不同时，不要写成两道题，写一道题加变体：

~~~json
{
  "id": "linux.stat-size",
  "title": "取文件字节大小",
  "variants": {
    "darwin": {
      "sample": "stat -f '%z' a.txt",
      "require": [{ "p": "stat\\s+-f", "tip": "macOS 用 -f 指定格式串" }],
      "forbid": [{ "p": "stat\\s+-c", "tip": "macOS 不支持 -c，会报 illegal option" }]
    },
    "linux": {
      "sample": "stat -c '%s' a.txt",
      "require": [{ "p": "stat\\s+-c", "tip": "GNU stat 用 -c 指定格式串" }],
      "forbid": [{ "p": "stat\\s+-f", "tip": "GNU 的 -f 是文件系统信息" }]
    }
  }
}
~~~

已知平台取值来自 core/platform.mjs 的 PROFILES：darwin、linux、win32。
变体可以覆盖 require / forbid / sample / hint / verify；没覆盖的字段回落到任务顶层。只给个别平台写变体也合法（其余平台用顶层规则）。

变体会被 test/variant-platform.test.mjs 逐条实跑判定：**变体的要素不能与顶层完全相同**（否则等于没写）、**变体答案在自己平台必须拿 100 分、在题目声明过的其他平台上必须判不过**。加变体时把对面平台的写法放进警告级禁止项，能顺手提醒写错的学员（`severity: 'warn'`，扣分但不封顶）。

## 4. 可执行验证

verify.cmd 必须是只读命令，且要在 core/exec.mjs 的白名单里，否则包校验会失败。
白名单是唯一的安全边界，不会为了某个包放宽——要加命令就同时改白名单并补测试。

~~~json
"verify": { "cmd": "git --version", "expect": "git version \\d+\\.\\d+", "note": "只读命令" }
~~~

- 默认 dry-run，只有显式 --run 才会真的执行。
- 三个后端（local / docker / remote）都会校验退出码与 expect，语义一致。
- 期望输出用正则写，尽量宽松到只锁定关键信息（版本号、状态词），别锁死整行。

## 5. 校验与加载

~~~bash
node src/cli.mjs pack validate ./my-pack.json   # 出题时先校验，错误逐条列出，非零退出即有问题
## 先跑脚手架，再填内容

不用手写整个 JSON：pack new 会生成一个**开箱即通过校验**的模板——难度按口径自动算、要素从参考答案推导、题面留 TODO 占位。

~~~bash
node src/cli.mjs pack new database-pg --name='PostgreSQL 排障' --track=database --sample='psql -c select version()'
# 生成 packs/database-pg.json，并立刻做一次深度校验；下一步：把 TODO 换成真正想考的点
node src/cli.mjs pack validate packs/database-pg.json --deep
~~~

--deep 比默认校验多两条**权威口径**（以前只在 CI 审计里查，本地会漏）：

1. **难度必须等于口径**：按要素数/禁止项/变体数自动推出的难度，与声明的 level 不符就报错；
2. **参考答案必须在它自己的平台拿满分**：拿 sample 真跑一遍判定，不满分说明规则写错了（不是学员写错了）。

顺带一提：verify 命令是否在只读白名单内，默认校验也会查。

node src/cli.mjs pack list                      # 看当前加载了哪些包、来自哪个目录
export DSH_LEARN_PACKS=/path/to/my-packs        # 让 CLI / Web / Agent 都加载外部包
node src/cli.mjs list --json                    # 确认新题已经出现
~~~

外部包按文件名排序加载，同 id 任务以后加载的为准，所以可以用外部包覆盖内置题的判定规则，而不用改内置包。

## 6. 外部包的信任模型

外部包等于可执行规则的集合，来源不明就不该进内核。信任分两层，两层不等价：

| 层次 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| 签名（HMAC-SHA256） | 包来自持有密钥的人，且此后没被改过 | 那个人本身是否可信 |
| 哈希锁定（TOFU） | 首次记录的内容之后没变 | 首次拿到的包是不是正版 |

~~~bash
node src/cli.mjs pack keygen                       # 生成 ~/.dsh-learn/keys/pack.key（权限 0600）
node src/cli.mjs pack sign my-pack.json --signer me # 生成 my-pack.json.sig
node src/cli.mjs pack verify my-pack.json          # 先比对内容哈希，再比对 HMAC
node src/cli.mjs pack trust my-pack.json           # 记入信任库（有签名则顺带验签）
node src/cli.mjs pack trusted                      # 查看信任库

export DSH_LEARN_REQUIRE_TRUST=1                   # 打开加载门禁：未信任的外部包直接拒绝加载
export DSH_LEARN_REQUIRE_SIGNATURE=1               # 更严：只有哈希锁定的包也不算通过
~~~

门禁默认关闭（本地自用不受影响），失败时以退出码 3 结束并给出处理建议。

## 7. 出题原则

1. **先实测再出题**：本项目的选择题差异都是先在本机跑出来的（stat -c 报 illegal option、grep -P 报 invalid option、date -d 不可用）。反过来也成立——readlink -f、xargs -r、sort -V 在本机 macOS 上都能用，所以没有被写成差异题。
2. **只考一个技能点**：一道题一个动作，要求写得具体到可以直接验收。
3. **禁止项要能解释**：tip 里写清"为什么不行"，而不是只说"错了"。
4. **参考答案要是真实可跑的**：不要写伪代码或省略参数。
5. **危险写法标 block**：删数据、丢改动、清卷这类动作必须让学员看到"未通过"，不能停在部分通过。
6. **加题就要加断言**：给普通题在 test/content.test.mjs 补一条判定断言（防止改规则时悄悄退化）；平台变体不用手写——test/variant-platform.test.mjs 会遍历全部变体题实跑判定，自动要求「本平台满分、跨平台判不过」。
