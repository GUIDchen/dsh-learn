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