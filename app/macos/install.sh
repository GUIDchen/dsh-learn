#!/usr/bin/env bash
# 把构建好的 App 装到 ~/Applications（无需 sudo），可选装登录自启。
# 用法：bash app/macos/install.sh [--launchagent]
#       bash app/macos/install.sh --uninstall
set -eo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/dist/dsh-learn.app"
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/dsh-learn.app"
AGENT="$HOME/Library/LaunchAgents/local.dshlearn.app.plist"

if [ "$1" = "--uninstall" ]; then
  launchctl unload "$AGENT" 2>/dev/null || true
  rm -f "$AGENT"
  rm -rf "$DEST"
  echo "已卸载：$DEST （自启配置也一并移除）"
  exit 0
fi

[ -d "$SRC" ] || { echo "先构建：bash app/macos/build.sh"; exit 1; }
mkdir -p "$DEST_DIR"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
echo "已安装：$DEST"

if [ "$1" = "--launchagent" ] || [ "$2" = "--launchagent" ]; then
  mkdir -p "$(dirname "$AGENT")"
  cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.dshlearn.app</string>
  <key>ProgramArguments</key>
  <array><string>$DEST/Contents/MacOS/dsh-learn</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
PLIST
  launchctl unload "$AGENT" 2>/dev/null || true
  launchctl load "$AGENT"
  echo "已设置登录自启：$AGENT"
  echo "取消自启：launchctl unload '$AGENT' && rm '$AGENT'"
fi
