#!/usr/bin/env bash
# 安装包冒烟：真的把 App 拉起来，验证它自带的引擎能读题库、能跑截图 OCR，并且退出/崩溃时不留孤儿引擎。
#
# 为什么单开一个脚本：verify.sh 里的"原生自检"编译的是**仓库里的** Engine.swift + src，
# 用的是仓库目录下的引擎；而用户双击的是 ~/Applications 里那份**打包过的** App。
# 两者差的正是打包这一步——实测漏打 tools/ 时，仓库里一切正常，装出来的 App 截图 OCR 直接 400。
#
# 用法：bash scripts/smoke-app.sh [--app=<路径>]
# 没有装 App（或不是 macOS）时跳过，不算失败。
APP="$HOME/Applications/dsh-learn.app"
for arg in "$@"; do
  case "$arg" in
    --app=*) APP="${arg#--app=}" ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "跳过：不是 macOS"
  exit 0
fi
BIN="$APP/Contents/MacOS/dsh-learn"
if [ ! -x "$BIN" ]; then
  echo "跳过：没有装 App（${APP}）"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=0

launch() {   # launch <home> <log> → 回显 App PID
  DSH_LEARN_HOME="$1" "$BIN" > "$2" 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid"
}

wait_port() {   # wait_port <appPid> → 回显引擎端口（找不到就空）
  local app="$1" target child port
  for _ in $(seq 1 40); do
    sleep 0.5
    target="$app"
    child="$(pgrep -P "$app" | head -1)"
    [ -n "$child" ] && target="$child"
    port="$(lsof -nP -iTCP -sTCP:LISTEN -a -p "$target" 2>/dev/null | awk 'NR==2 {print $9}' | sed 's/.*://')"
    [ -n "$port" ] && { echo "$port"; return 0; }
  done
  echo ""
}

engine_of() { pgrep -P "$1" | head -1; }

wait_gone() {   # wait_gone <pid> <秒数> → 消失返回 0
  local pid="$1" limit="$2" i
  for i in $(seq 1 "$limit"); do
    sleep 1
    kill -0 "$pid" 2>/dev/null || return 0
  done
  return 1
}

echo "启动：$BIN"
HOME_DIR="$(mktemp -d)"
APP_PID="$(launch "$HOME_DIR" "$HOME_DIR/app.log")"
trap 'pkill -f "$APP/Contents/MacOS/dsh-learn" >/dev/null 2>&1; rm -rf "$HOME_DIR"' EXIT

PORT="$(wait_port "$APP_PID")"
if [ -z "$PORT" ]; then
  echo "FAIL  10 秒内没等到 App 的引擎端口"
  tail -20 "$HOME_DIR/app.log" | sed 's/^/  /'
  exit 1
fi
ENGINE_PID="$(engine_of "$APP_PID")"

# 测的必须是 App 自带的那份引擎：设了 DSH_LEARN_ROOT 时 App 会走"开发模式"用仓库引擎，
# 那样打包漏文件也测不出来（第一次写这个脚本就踩过）
ENGINE_CMD="$(ps -o command= -p "$ENGINE_PID" 2>/dev/null)"
case "$ENGINE_CMD" in
  *"$APP/Contents/Resources/engine"*) echo "PASS  App 起来了，用的是自带引擎，端口 127.0.0.1:$PORT" ;;
  *)
    echo "FAIL  测到的不是 App 自带的引擎（它用的是：${ENGINE_CMD}）"
    exit 1
    ;;
esac

node "$ROOT/scripts/smoke-app-check.mjs" "$PORT" "$ROOT" "$ROOT/docs/evidence/terminal-note-screenshot.png" || FAILED=1

# 退出行为：点退出（SIGTERM）与崩溃（SIGKILL）都不该留下占着端口的孤儿引擎
kill -TERM "$APP_PID" 2>/dev/null
if wait_gone "$ENGINE_PID" 6; then
  echo "PASS  正常退出后引擎跟着退出（不留孤儿）"
else
  echo "FAIL  正常退出 6 秒后引擎还在（pid ${ENGINE_PID}）"
  kill -9 "$ENGINE_PID" 2>/dev/null
  FAILED=1
fi

HOME_DIR2="$(mktemp -d)"
APP_PID2="$(launch "$HOME_DIR2" "$HOME_DIR2/app.log")"
PORT2="$(wait_port "$APP_PID2")"
ENGINE_PID2="$(engine_of "$APP_PID2")"
if [ -n "$ENGINE_PID2" ]; then
  kill -9 "$APP_PID2" 2>/dev/null
  # 父进程看门狗：App 被 kill -9，引擎靠 DSH_LEARN_PARENT_PID 轮询发现自己成了孤儿
  if wait_gone "$ENGINE_PID2" 8; then
    echo "PASS  App 被 kill -9 后，引擎靠看门狗自己退出（不留孤儿）"
  else
    echo "FAIL  App 崩溃 8 秒后引擎还在（pid ${ENGINE_PID2}）"
    kill -9 "$ENGINE_PID2" 2>/dev/null
    FAILED=1
  fi
else
  echo "FAIL  第二次启动没等到引擎（端口 ${PORT2}）"
  FAILED=1
fi
pkill -f "$APP/Contents/MacOS/dsh-learn" >/dev/null 2>&1
rm -rf "$HOME_DIR2"

if [ "$FAILED" != "0" ]; then
  echo "安装包冒烟：有失败项"
  exit 1
fi
echo "安装包冒烟通过"
