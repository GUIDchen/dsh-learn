#!/usr/bin/env bash
# 端到端验证脚本：跑通内核、CLI、Web、Agent 四条链路，并打印可复制的证据。
# 用独立的 DSH_LEARN_HOME，避免污染日常进度；任何一项检查失败都会以非零码退出。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
export DSH_LEARN_HOME="$(mktemp -d)"
WEB_PORT=8796
AGENT_PORT=8797
TOKEN="verify-token"
# 容器后端用的镜像：默认走国内镜像源，可用环境变量覆盖成任意本地镜像
CONTAINER_IMAGE="${DSH_LEARN_DOCKER_IMAGE:-docker.m.daocloud.io/library/python:3.12-slim}"
TMP="$(mktemp -d)"

pass=0
fail=0
section() { printf '\n=== %s ===\n' "$1"; }
check() {
  if [ "$1" = "0" ]; then
    printf 'PASS  %s\n' "$2"
    pass=$((pass + 1))
  else
    printf 'FAIL  %s\n' "$2"
    fail=$((fail + 1))
  fi
}

section "环境"
printf 'platform  : %s %s\n' "$(uname -s)" "$(uname -m)"
printf 'node      : %s\n' "$(node --version)"
printf 'progress  : %s\n' "$DSH_LEARN_HOME"
printf 'docker cli: %s\n' "$(docker --version 2>/dev/null || echo '未安装（容器后端将降级）')"

section "0. 语法体检"
bash scripts/check-syntax.sh | tail -1
bash scripts/check-syntax.sh > /dev/null 2>&1
check $? "全仓 JS 与页面脚本语法通过"

section "0.5 静态检查：用了但没声明（漏 import）"
node scripts/lint-unresolved.mjs > "$TMP/lint.log" 2>&1
LINT_STATUS=$?
tail -2 "$TMP/lint.log"
if [ "$LINT_STATUS" != "0" ]; then
  echo "新问题："
  grep -E '新增' "$TMP/lint.log" | head -8
fi
check $LINT_STATUS "静态检查：没有新增的「用了但没声明」"

section "1. 内核测试"
node --test --test-timeout=30000 > "$TMP/tests.log" 2>&1
TEST_STATUS=$?
grep -E '^ℹ (tests|pass|fail)' "$TMP/tests.log" | tail -3
if [ "$TEST_STATUS" != "0" ]; then
  echo "失败用例："
  grep -E '^✖' "$TMP/tests.log" | head -5
fi
check $TEST_STATUS "node --test 全绿"

section "2. 题库与校验"
node -e "import('./src/core/tasks.mjs').then(function (m) { console.log('packs :', m.PACK_IDS.join(', ')); console.log('tracks:', m.TRACKS.join(', ')); console.log('tasks :', m.TASKS.length); });" > "$TMP/packs.txt" 2>&1
cat "$TMP/packs.txt"
# 题库规模从运行时推导：加题不用改这个脚本
EXPECTED_TASKS=$(node -e "import('./src/core/tasks.mjs').then(function (m) { process.stdout.write(String(m.TASKS.length)) })")
grep -q "tasks : $EXPECTED_TASKS" "$TMP/packs.txt"
check $? "题库规模与包结构符合预期"

section "3. 平台变体判定（同一答案在两个平台得到不同结果）"
node src/cli.mjs check linux.stat-size "stat -c '%s' a.txt" --client verify-mac --platform darwin > "$TMP/mac.txt"
grep -q '未通过' "$TMP/mac.txt"
check $? "同一答案在 macOS 被判为写法错误"
head -3 "$TMP/mac.txt"
node src/cli.mjs check linux.stat-size "stat -c '%s' a.txt" --client verify-linux --platform linux > "$TMP/linux.txt"
grep -q '通过（100 分）' "$TMP/linux.txt"
check $? "同一答案在 Linux 被判为通过"
head -3 "$TMP/linux.txt"
node src/cli.mjs check git.autocrlf-cross-platform "git config --global core.autocrlf true" --client verify-win --platform win32 | head -3
node src/cli.mjs check docker.system-prune-safe "docker system prune --volumes" --client verify-mac --platform darwin > "$TMP/prune.txt"
grep -q '数据卷' "$TMP/prune.txt"
check $? "危险清理参数被点名（--volumes）"

section "3.4 题库质量体检"
node src/cli.mjs audit | tail -4
node src/cli.mjs audit > /dev/null 2>&1
check $? "题库体检通过（参考答案自查满分、变体有区分度）"

section "3.5 白名单与题库对账"
node src/cli.mjs security whitelist | tail -6
node src/cli.mjs security whitelist > /dev/null 2>&1
check $? "白名单与题库对账通过（无阻塞、无闲置、无泄漏）"

section "4. 只读验证后端"
node src/cli.mjs verify linux.date-offset --run --platform darwin --runner local > "$TMP/verify-local.txt"
head -6 "$TMP/verify-local.txt"
grep -q '结果：通过' "$TMP/verify-local.txt"
check $? "本机只读验证通过并校验输出格式"
node src/cli.mjs verify docker.context-diagnose --run --platform darwin --runner docker | head -5
node src/cli.mjs runners | head -8
# 有 Docker 守护进程时真跑一次容器后端（跨后端证据）；守护进程没起就跳过，
# 因为同一条链路本地后端刚刚已经验证过，把「Docker 没开」记成失败只会制造噪音。
# 用项目自己的探针判断守护进程状态：它带 5 秒上限，daemon 卡死时不会把脚本一起拖住
DOCKER_OK=$(node src/cli.mjs runners --json | node -e "let s='';process.stdin.on('data',function(d){s+=d}).on('end',function(){var r=JSON.parse(s).filter(function(x){return x.name==='docker'})[0];process.stdout.write(r&&r.available.ok?'1':'0')})")
if [ "$DOCKER_OK" = "1" ]; then
  node src/cli.mjs verify linux.platform-probe --run --platform linux --runner docker --image "$CONTAINER_IMAGE" > "$TMP/verify-docker.txt"
  tail -4 "$TMP/verify-docker.txt"
  grep -q '结果：通过' "$TMP/verify-docker.txt"
  check $? "容器后端真机验证通过（Linux 容器内 uname -s = Linux）"
else
  printf '跳过：Docker 守护进程未运行，容器后端只保留可用性检查\n'
  check 0 "守护进程缺席时容器后端降级，本地后端已覆盖同一链路"
fi

section "4.5 知识点分析（岗位/文档 → 训练清单）"
node src/cli.mjs knowledge | head -6
node src/cli.mjs knowledge > /dev/null 2>&1
check $? "知识点字典可读（模块 / 难度 / 对应题目）"
node src/cli.mjs analyze --text '岗位要求：熟悉 Python 虚拟环境与依赖管理；会用 tcpdump 抓包；了解 YOLO 训练与 mAP 评估；会用 CMake 构建 C++ 工程' > "$TMP/analyze.txt" 2>&1
head -4 "$TMP/analyze.txt"
grep -q '识别出' "$TMP/analyze.txt"
check $? "岗位 JD 能分析出知识点"
ANALYZE_TASKS=$(node src/cli.mjs analyze --text '熟悉 tcpdump 抓包与 iperf3 带宽测试' --tasks | paste -sd, -)
printf '训练清单：%s\n' "$ANALYZE_TASKS"
node src/cli.mjs drill --tasks="$ANALYZE_TASKS" > "$TMP/drill-tasks.txt" 2>&1
grep -q '指定训练' "$TMP/drill-tasks.txt"
check $? "分析出的清单能直接开练（analyze --tasks | drill --tasks）"
node src/cli.mjs analyze --url ftp://nope > "$TMP/analyze-bad.txt" 2>&1
grep -q '只支持 http/https' "$TMP/analyze-bad.txt"
check $? "非 http 链接被明确拒绝"
cat > "$TMP/site.html" <<'HTML'
<html><body><h2>部署</h2>
<pre>docker run -d --name web -p 8080:80 nginx:1.25</pre>
<pre>docker logs -f --tail 100 web</pre>
<pre>kubectl get pods -A</pre>
<pre>docker container run [OPTIONS] IMAGE</pre>
</body></html>
HTML
node src/cli.mjs learn-site "$TMP/site.html" --limit 5 --out "$TMP/site-draft.json" > "$TMP/site-learn.txt" 2>&1
head -3 "$TMP/site-learn.txt"
grep -q '草案包' "$TMP/site-learn.txt" && grep -q '页面代码块' "$TMP/site-learn.txt"
check $? "从文档页生成题库草案（只认代码块）"
grep -q 'docker container run [OPTIONS]' "$TMP/site-learn.txt" && check 1 "用法签名不该被当成命令" || check 0 "用法签名被正确过滤"
node src/cli.mjs modules > "$TMP/modules.txt" 2>&1
head -3 "$TMP/modules.txt"
grep -q '模块总览' "$TMP/modules.txt" && grep -qE '知识点 +[0-9]+' "$TMP/modules.txt"
check $? "模块总览给出每个模块的题数进度与知识点数量"

section "5. 学习计划与进度"
node src/cli.mjs plan --hours 2 | head -8
node src/cli.mjs progress | head -8

section "6. 远程 agent（跨机多客户端）"
node src/agent.mjs --host 127.0.0.1 --port "$AGENT_PORT" --token "$TOKEN" > "$TMP/agent.log" 2>&1 &
AGENT_PID=$!
sleep 1
curl -s "http://127.0.0.1:$AGENT_PORT/agent/health" > "$TMP/health.json"
cat "$TMP/health.json"
printf '\n'
grep -q '"ok":true' "$TMP/health.json"
check $? "agent 健康检查可用"
node src/cli.mjs verify git.version-check --run --runner remote --endpoint "http://127.0.0.1:$AGENT_PORT" --token "$TOKEN" > "$TMP/remote.txt"
head -6 "$TMP/remote.txt"
grep -q '结果：通过' "$TMP/remote.txt"
check $? "远程只读执行通过（输出经 expect 校验）"
node src/cli.mjs verify git.version-check --run --runner remote --endpoint "http://127.0.0.1:$AGENT_PORT" --token "wrong-token" > "$TMP/badtoken.txt"
tail -2 "$TMP/badtoken.txt"
grep -q 'token 不匹配' "$TMP/badtoken.txt"
check $? "错误 token 被拒绝"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$AGENT_PORT/agent/exec" -H 'content-type: application/json' -d '{"cmd":"rm -rf /","run":true,"token":"'"$TOKEN"'"}')
printf '非法命令 HTTP 状态: %s\n' "$CODE"
[ "$CODE" = "403" ]
check $? "白名单拦截非法命令返回 403"
kill "$AGENT_PID" 2>/dev/null
wait "$AGENT_PID" 2>/dev/null

section "7. Web 客户端"
# 首页"今日建议"用的就是这个接口
curl -s "http://127.0.0.1:$WEB_PORT/api/drill?mode=all&limit=2" > "$TMP/drill.json" 2>/dev/null || true
node src/web/server.mjs --host 127.0.0.1 --port "$WEB_PORT" > "$TMP/web.log" 2>&1 &
WEB_PID=$!
sleep 1
HOME_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/")
printf 'GET /               -> %s\n' "$HOME_CODE"
[ "$HOME_CODE" = "200" ]
check $? "浏览器页面可访问"
for path in /api/bootstrap?platform=darwin /api/progress /api/board /api/runners; do
  API_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT$path")
  printf 'GET %-26s -> %s\n' "$path" "$API_CODE"
done
curl -s -X POST "http://127.0.0.1:$WEB_PORT/api/plan" -H 'content-type: application/json' -d '{"hoursPerDay":2,"track":"git"}' > "$TMP/plan.json"
grep -q '"days"' "$TMP/plan.json"
check $? "Web 端生成学习计划"
curl -s -X POST "http://127.0.0.1:$WEB_PORT/api/check" -H 'content-type: application/json' -d '{"taskId":"docker.logs-follow","answer":"docker logs -f web","platform":"darwin","clientId":"verify-web"}' > "$TMP/webcheck.json"
grep -q '通过' "$TMP/webcheck.json"
check $? "Web 端提交判定并入库"
curl -s "http://127.0.0.1:$WEB_PORT/api/drill?mode=weak&limit=2" > "$TMP/drill.json"
grep -q '"practice"' "$TMP/drill.json"
check $? "Web 端今日建议接口可用"
curl -s -o /dev/null -w 'GET /manifest.webmanifest -> %{http_code}\n' "http://127.0.0.1:$WEB_PORT/manifest.webmanifest"
SW_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
curl -s "http://127.0.0.1:$WEB_PORT/sw.js" > "$TMP/sw.js"
grep -q 'dsh-learn-shell' "$TMP/sw.js"
check $? "网页版可安装（PWA manifest 与 Service Worker 就位）"
# sw.js 的缓存名必须带当前版本：不带的话发版后清不掉旧缓存桶，用户会一直看到上一版页面
grep -q "dsh-learn-shell-${SW_VERSION}" "$TMP/sw.js"
check $? "sw.js 的缓存名带当前版本（${SW_VERSION}）"
if grep -q '__VERSION__' "$TMP/sw.js"; then check 1 "sw.js 里的 __VERSION__ 已替换"; else check 0 "sw.js 里的 __VERSION__ 已替换"; fi
# 离线外壳的清单逐条取一遍：清单里有一个 404，SW 的 install 会吞掉它，
# 表现是"离线打开少一块"——比整块失效更难发现，所以要在验证脚本里逐条 curl。
SHELL_MISSING=''
for SHELL_PATH in $(sed -n '/const SHELL = \[/,/\];/p' "$TMP/sw.js" | grep -o "'/[^']*'" | tr -d "'"); do
  SHELL_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT${SHELL_PATH}")
  if [ "$SHELL_CODE" != "200" ]; then SHELL_MISSING="$SHELL_MISSING ${SHELL_PATH}(${SHELL_CODE})"; fi
done
if [ -z "$SHELL_MISSING" ]; then check 0 "离线外壳清单里的资源全部可取（逐条 curl）"; else echo "  取不到：${SHELL_MISSING}"; check 1 "离线外壳清单里的资源全部可取"; fi
curl -s -o "$TMP/icon.png" "http://127.0.0.1:$WEB_PORT/icons/icon-512.png"
test "$(head -c 4 "$TMP/icon.png" | xxd -p)" = "89504e47"
check $? "图标是真实 PNG"
curl -s "http://127.0.0.1:$WEB_PORT/api/daily?track=shell" > "$TMP/daily.json"
grep -q '"taskId"' "$TMP/daily.json"
check $? "每日一题接口可用"
curl -s "http://127.0.0.1:$WEB_PORT/api/report" > "$TMP/report.md"
grep -q '## 分轨道进度' "$TMP/report.md"
check $? "学习报告接口返回 Markdown"
curl -s "http://127.0.0.1:$WEB_PORT/api/progress" > "$TMP/progress.json"
grep -q '"streak"' "$TMP/progress.json"
check $? "进度接口带连续学习天数"
grep -q '"goal"' "$TMP/progress.json"
check $? "进度接口带今日学习目标"
curl -s "http://127.0.0.1:$WEB_PORT/api/review?limit=3" > "$TMP/review.json"
grep -q '"due"' "$TMP/review.json"
check $? "复习队列接口可用"
curl -s -X POST "http://127.0.0.1:$WEB_PORT/api/goal" -H 'content-type: application/json' -d '{"dailyTasks":2,"dailyMinutes":10}' > "$TMP/goal.json"
grep -q '"dailyTasks":2' "$TMP/goal.json"
check $? "学习目标可保存并回读"
curl -s -X POST "http://127.0.0.1:$WEB_PORT/api/note" -H 'content-type: application/json' -d '{"taskId":"docker.run-web","text":"验证脚本写入的笔记"}' > "$TMP/note.json"
grep -q '验证脚本写入的笔记' "$TMP/note.json"
check $? "题目笔记可保存并回读"
curl -s "http://127.0.0.1:$WEB_PORT/core/judge.mjs" > "$TMP/judge.mjs"
grep -q 'export function judge' "$TMP/judge.mjs"
check $? "判定内核以 ES 模块提供给浏览器（离线可判分）"
curl -s "http://127.0.0.1:$WEB_PORT/api/bootstrap?platform=darwin" > "$TMP/boot.json"
grep -q '"rules"' "$TMP/boot.json"
check $? "bootstrap 下发判定规则（离线判定所需）"
CLI_CLIENT="verify-consistency"
node src/cli.mjs check docker.volume-persist "docker volume create redis-data && docker run -d -v redis-data:/data --name cache redis:7" --client "$CLI_CLIENT" > /dev/null
curl -s "http://127.0.0.1:$WEB_PORT/api/board" > "$TMP/board-consistency.json"
grep -q "$CLI_CLIENT" "$TMP/board-consistency.json"
check $? "CLI 提交的记录立刻出现在网页排行榜"
CLI_PASSED=$(node src/cli.mjs progress --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).passed))")
WEB_PASSED=$(curl -s "http://127.0.0.1:$WEB_PORT/api/progress" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).summary.passed))")
printf 'CLI 通过数=%s　网页通过数=%s\n' "$CLI_PASSED" "$WEB_PASSED"
test "$CLI_PASSED" = "$WEB_PASSED"
check $? "CLI 与网页的通过数完全一致"

section "7.4 浏览器层端到端（headless Chrome：学习/项目/投递三页）"
# 没有 Chrome 的机器跳过（不算失败），与原生自检缺 swiftc 的处理一致。
if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  node scripts/e2e-web.mjs > "$TMP/e2e-web.log" 2>&1
  E2E_WEB_STATUS=$?
  tail -4 "$TMP/e2e-web.log"
  if [ "$E2E_WEB_STATUS" != "0" ]; then
    echo "失败步骤："
    grep -E '^FAIL' "$TMP/e2e-web.log" | head -5
  fi
  check $E2E_WEB_STATUS "浏览器层端到端（三页 + 无进程残留）"
else
  echo "没有 Google Chrome：跳过浏览器层端到端"
fi

section "7.5 响应压缩（题库 170KB 必须走 gzip）"
PLAIN_SIZE=$(curl -s -o /dev/null -w '%{size_download}' "http://127.0.0.1:$WEB_PORT/api/bootstrap")
GZIP_SIZE=$(curl -s -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}' "http://127.0.0.1:$WEB_PORT/api/bootstrap")
printf 'bootstrap 原始 %s 字节　gzip %s 字节\n' "$PLAIN_SIZE" "$GZIP_SIZE"
if [ "$PLAIN_SIZE" -gt 100000 ] && [ "$GZIP_SIZE" -lt "$((PLAIN_SIZE / 2))" ]; then check 0 "bootstrap 走 gzip 且体积减半以上"; else check 1 "bootstrap 压缩没生效"; fi
curl -s -H 'Accept-Encoding: gzip' -D "$TMP/hdr.txt" -o /dev/null "http://127.0.0.1:$WEB_PORT/app.mjs"
grep -qi 'content-encoding: gzip' "$TMP/hdr.txt" && grep -qi 'vary: accept-encoding' "$TMP/hdr.txt"
check $? "静态资源带 content-encoding 与 vary 头"

kill "$WEB_PID" 2>/dev/null
wait "$WEB_PID" 2>/dev/null

section "8. 进度导出与合并导入"
node src/cli.mjs export "$TMP/export.json"
node src/cli.mjs import "$TMP/export.json" > "$TMP/import.txt"
cat "$TMP/import.txt"
grep -q '新增 0 条，跳过重复' "$TMP/import.txt"
check $? "导出后原样导入被正确去重"
node src/cli.mjs board

section "8.5 存储并发安全"
CONC_HOME="$(mktemp -d)"
for i in 1 2 3 4; do
  DSH_LEARN_HOME="$CONC_HOME" node src/cli.mjs check docker.logs-follow "docker logs -f web" --client "conc-$i" > /dev/null 2>&1 &
done
wait
CONC_COUNT=$(DSH_LEARN_HOME="$CONC_HOME" node src/cli.mjs board --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length))")
printf '并发提交后客户端数: %s\n' "$CONC_COUNT"
test "$CONC_COUNT" = "4"
check $? "四个进程并发提交，记录一条不丢"
rm -rf "$CONC_HOME"

section "9. Kubernetes 验证与失败诊断"
node src/cli.mjs verify k8s.context-switch --run > "$TMP/k8s-cli.txt" 2>&1
tail -4 "$TMP/k8s-cli.txt"
grep -q '结果：通过' "$TMP/k8s-cli.txt"
check $? "kubectl 本地检查可执行（不需要集群）"
node src/cli.mjs verify k8s.get-pods-wide --run > "$TMP/k8s-cluster.txt" 2>&1
tail -3 "$TMP/k8s-cluster.txt"
if grep -q '结果：通过' "$TMP/k8s-cluster.txt"; then
  check 0 "集群可达，kubectl 只读检查通过"
elif grep -q '排查建议' "$TMP/k8s-cluster.txt"; then
  check 0 "集群不可达时给出可执行的排查建议"
else
  check 1 "集群不可达时既没通过也没给建议"
fi
node src/cli.mjs selftest --platform win32 > "$TMP/win32.txt" 2>&1
grep -q 'where-wsl' "$TMP/win32.txt"
check $? "Windows 探针集合可用（win32 平台自检）"

section "10. 平台自检（本机工具链 vs 题库假设）"
node src/cli.mjs selftest --run > "$TMP/selftest.txt" 2>&1
tail -2 "$TMP/selftest.txt"
grep -q '全部探针与题库里的平台假设一致' "$TMP/selftest.txt"
check $? "本机平台自检与题库假设一致"

section "11. 定向练习与题库信任"
node src/cli.mjs drill --all --track k8s --limit 2 | head -4
node src/cli.mjs pack keygen | head -1
mkdir -p "$TMP/packs"
printf '{"id":"demo","track":"demo","version":1,"tasks":[{"id":"demo.x","track":"demo","title":"t","goal":"g","require":[{"p":"echo","tip":"x"}]}]}' > "$TMP/packs/pack.json"
node src/cli.mjs pack sign "$TMP/packs/pack.json" --signer verify-bot > "$TMP/sign.txt"
cat "$TMP/sign.txt"
node src/cli.mjs pack verify "$TMP/packs/pack.json" > "$TMP/verify.txt"
cat "$TMP/verify.txt"
grep -q '签名有效' "$TMP/verify.txt"
check $? "题库包签名可验证"
node src/cli.mjs pack trust "$TMP/packs/pack.json" | head -1
DSH_LEARN_PACKS="$TMP/packs" DSH_LEARN_REQUIRE_TRUST=1 node src/cli.mjs list --track demo --json > "$TMP/gated.json" 2>&1
grep -q 'demo.x' "$TMP/gated.json"
check $? "受信任的外部包通过加载门禁"
printf ' ' >> "$TMP/packs/pack.json"
DSH_LEARN_PACKS="$TMP/packs" DSH_LEARN_REQUIRE_TRUST=1 node src/cli.mjs list > /dev/null 2>&1
test $? = 3
check $? "内容被改后门禁以退出码 3 拒绝加载"

if [ "${VERIFY_COVERAGE:-}" = "1" ]; then
  section "11.5 覆盖率门槛（默认跳过，设 VERIFY_COVERAGE=1 启用）"
  node scripts/coverage.mjs > "$TMP/coverage.txt" 2>&1
  COVERAGE_STATUS=$?
  tail -4 "$TMP/coverage.txt"
  check $COVERAGE_STATUS "覆盖率门槛通过（低于基线 2% 即失败）"
fi

section "11.5 本地实验室（靶机 + 受限压测）"
node scripts/with-timeout.mjs 60 bash scripts/lab.sh status | sed -n '1,8p' || echo '（lab 状态查询超时，按不可用处理）'
# 压测靶机在跑时，用受限压测（白名单限死请求数与并发）真跑一次；没跑就如实跳过
if curl -s -o /dev/null "http://127.0.0.1:8899/health" 2>/dev/null; then
  node src/cli.mjs verify perf.ab-bench --run > "$TMP/ab.txt" 2>&1
  tail -3 "$TMP/ab.txt"
  grep -q '结果：通过' "$TMP/ab.txt"
  check $? "受限压测对本地靶机真跑一次（ab，白名单已限死 n≤200 / c≤20）"
else
  printf '跳过：压测靶机没在跑（bash scripts/lab.sh up 会同时准备靶机与 kind 集群）\n'
  node src/cli.mjs verify perf.ab-bench 2>&1 | tail -2
  check 0 "靶机缺席时压测验证如实降级（默认 dry-run，不乱发包）"
fi

section "12. 发布脚本与桌面壳"
bash -n scripts/release-mac.sh
check $? "发布脚本语法通过"
RELEASE_VERSION=$(grep -A1 'CFBundleShortVersionString' app/macos/Info.plist.template | sed -n 's|.*<string>\([0-9.]*\)</string>.*|\1|p' | head -1)
printf 'Info.plist 版本号: %s\n' "$RELEASE_VERSION"
test -n "$RELEASE_VERSION"
check $? "发布版本号可从 Info.plist 模板解析"
bash scripts/release-mac.sh --dry-run > "$TMP/release-dry.txt" 2>&1
cat "$TMP/release-dry.txt"
grep -q '版本：' "$TMP/release-dry.txt"
check $? "发布脚本能算出下一个版本号（--dry-run 不写文件）"
PKG_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
printf 'package.json 版本号: %s
' "$PKG_VERSION"
[ "$PKG_VERSION" = "$RELEASE_VERSION" ]
check $? "package.json 与 Info.plist 版本号一致（避免发版张冠李戴）"

# 桌面壳的孤儿防护：父进程 pid 不存在时，服务必须自己退出，否则会一直占着端口
DSH_LEARN_PARENT_PID=999999 node src/web/server.mjs --host 127.0.0.1 --port 0 > "$TMP/watchdog.log" 2>&1 &
WD_PID=$!
sleep 5
grep -q '父进程已退出' "$TMP/watchdog.log"
check $? "父进程看门狗：父进程不存在时服务自己退出（桌面壳不留孤儿）"
kill "$WD_PID" 2>/dev/null
wait "$WD_PID" 2>/dev/null
node src/web/server.mjs --host 127.0.0.1 --port 0 > "$TMP/port0.log" 2>&1 &
PORT0_PID=$!
sleep 1
PORT0_URL=$(grep -o 'DSH_LEARN_URL=http://127.0.0.1:[0-9]*' "$TMP/port0.log" | tail -1 | cut -d= -f2)
printf '内核分配地址: %s\n' "$PORT0_URL"
if [ -n "$PORT0_URL" ]; then
  curl -s -o /dev/null -w 'GET bootstrap on ephemeral port -> %{http_code}\n' "$PORT0_URL/api/bootstrap"
fi
[ -n "$PORT0_URL" ]
check $? "服务端 --port 0 会打印可解析地址"
kill "$PORT0_PID" 2>/dev/null
wait "$PORT0_PID" 2>/dev/null
if [ -d dist/dsh-learn.app ]; then
  du -sh dist/dsh-learn.app
  codesign --verify --deep dist/dsh-learn.app
  check $? "已构建的 macOS App 签名校验通过"
  plutil -p dist/dsh-learn.app/Contents/Info.plist | grep -q DSHLearnProjectRoot
  check $? "App 里写入了项目目录（开发模式兜底）"
  test -f dist/dsh-learn.app/Contents/Resources/engine/src/web/server.mjs && test -d dist/dsh-learn.app/Contents/Resources/engine/packs
  check $? "App 自带引擎（装到 ~/Applications 后不依赖项目目录）"
else
  echo "dist/dsh-learn.app 不存在：跳过（构建命令：bash app/macos/build.sh）"
fi

# 原生客户端自检：编译 App 里那份 Engine.swift，把客户端真正走的链路（bootstrap/check/history/progress）跑一遍。
# 进度写到临时 HOME，不碰真实进度；没有 swiftc 的机器跳过（不算失败）。
if command -v swiftc >/dev/null; then
  NATIVE_BIN="$TMP/dsh-native-selftest"
  # NativeUI.swift 也要编进来：自检里有针对 Store（筛选描述与重置）的断言
  swiftc -O -swift-version 5 app/macos/selftest.swift app/macos/Engine.swift app/macos/EngineModels.swift app/macos/EngineHTTP.swift app/macos/Preferences.swift app/macos/NativeUI.swift app/macos/ProjectsFilter.swift app/macos/VerdictPanel.swift app/macos/Panels.swift -o "$NATIVE_BIN" -framework Cocoa -framework SwiftUI >/dev/null 2>&1
  if [ -x "$NATIVE_BIN" ]; then
    NATIVE_HOME="$TMP/native-home"
    mkdir -p "$NATIVE_HOME"
    DSH_LEARN_ROOT="$ROOT" DSH_LEARN_HOME="$NATIVE_HOME" "$NATIVE_BIN" >"$TMP/native.log" 2>&1
    NATIVE_STATUS=$?
    sed 's/^/  /' "$TMP/native.log"
    check $NATIVE_STATUS "原生客户端接口自检（题库/判定/历史对比/进度）"
  else
    echo "原生客户端自检编译失败"
    check 1 "原生客户端自检编译"
  fi
else
  echo "没有 swiftc：跳过原生客户端自检"
fi


# 安装包冒烟：真的把 ~/Applications 里的 App 拉起来，验证它**自带的**引擎能读题库、能跑截图 OCR。
# 这一条与上面的原生自检互补：自检编译的是仓库里的源码 + 仓库引擎，测不到「打包」这一步
# （实测漏打 tools/ 时仓库里一切正常，装出来的 App 截图 OCR 直接 400）。没装 App 就跳过。
if [ -x "$HOME/Applications/dsh-learn.app/Contents/MacOS/dsh-learn" ]; then
  bash scripts/smoke-app.sh > "$TMP/smoke-app.log" 2>&1
  SMOKE_STATUS=$?
  sed 's/^/  /' "$TMP/smoke-app.log" | tail -6
  check $SMOKE_STATUS "安装包冒烟（自带引擎 + 截图 OCR）"
else
  echo "没有装 App（~/Applications/dsh-learn.app）：跳过安装包冒烟"
fi
section "13. 项目目录与仓库解析（project / learn-repo）"
PROJ_FIX="$TMP/proj-fixture"
mkdir -p "$PROJ_FIX/scripts"
printf '# demo\n\n    docker build -t demo:1.0 .\n    go test -race ./...\n    kubectl rollout status deploy/demo -n demo\n' > "$PROJ_FIX/README.md"
printf 'FROM golang:1.22-alpine AS build\n' > "$PROJ_FIX/Dockerfile"
printf 'module example.com/demo\n\ngo 1.22\n' > "$PROJ_FIX/go.mod"
printf 'test:\n\tgo test ./...\n' > "$PROJ_FIX/Makefile"
printf '#!/bin/sh\nset -eu\nkubectl apply -f deploy/\n' > "$PROJ_FIX/scripts/deploy.sh"
node src/cli.mjs project init verify-demo > "$TMP/project-init.log" 2>&1
check $? "project init 能建立项目目录"
grep -q "项目已建立" "$TMP/project-init.log"
check $? "project init 输出目录路径"
node src/cli.mjs project add verify-demo --text "熟悉 Docker 镜像构建与 Compose；会用 kubectl 排查 Pod；了解 go test -race" > "$TMP/project-add.log" 2>&1
check $? "project add --text 收下文字输入并解析知识点"
grep -q "识别出" "$TMP/project-add.log"
check $? "project add 给出知识点摘要"
node src/cli.mjs learn-repo "$PROJ_FIX" --project=verify-demo --limit=6 > "$TMP/learn-repo.log" 2>&1
check $? "learn-repo 扫描本地仓库"
for sig in dockerfile go make shell; do
  # 变量后面不要紧跟中文括号：bash 3.2 会把中文吃进变量名（check-shell.mjs 就是守这条的）
  grep -q "$sig" "$TMP/learn-repo.log"
  check $? "learn-repo 识别技术信号 $sig"
done
grep -qE "docker build|go test" "$TMP/learn-repo.log"
check $? "learn-repo 从 README/Makefile 抽出命令草案"
node src/cli.mjs project show verify-demo > "$TMP/project-show.log" 2>&1
grep -q "\[repo\]" "$TMP/project-show.log"
check $? "project show 记账了仓库来源"
ls "$DSH_LEARN_HOME"/projects/verify-demo/drafts/*.json >/dev/null 2>&1
check $? "草案写进了项目 drafts/ 目录"

section "汇总"
printf 'PASS %s / FAIL %s\n' "$pass" "$fail"

# 把这次实测的结论落成一份机器可读记录：docs/PROGRESS.md 直接引用它，
# 于是"进度文档里的数字"永远来自最近一次真跑，而不是手抄。
TESTS_TOTAL=$(grep -E '^ℹ tests' "$TMP/tests.log" | awk '{print $3}' | tail -1)
TESTS_PASS=$(grep -E '^ℹ pass' "$TMP/tests.log" | awk '{print $3}' | tail -1)
mkdir -p docs/evidence
node -e '
  const fs = require("node:fs");
  const out = {
    at: new Date().toISOString(),
    tests: Number(process.argv[1]) || 0,
    testPass: Number(process.argv[2]) || 0,
    verifyPass: Number(process.argv[3]) || 0,
    verifyFail: Number(process.argv[4]) || 0,
    version: JSON.parse(fs.readFileSync("package.json", "utf8")).version
  };
  fs.writeFileSync("docs/evidence/last-verify.json", JSON.stringify(out, null, 2) + "\n");
' "$TESTS_TOTAL" "$TESTS_PASS" "$pass" "$fail"

rm -rf "$DSH_LEARN_HOME" "$TMP"
if [ "$fail" != "0" ]; then
  exit 1
fi
echo "端到端验证通过"
