#!/usr/bin/env bash
# 构建 macOS 桌面 App（原生 SwiftUI 客户端，无第三方依赖）。
#
# 用法：
#   bash app/macos/build.sh                      # 临时签名（ad-hoc），本机自用
#   bash app/macos/build.sh --identity-list      # 看看本机有哪些可用签名身份
#   bash app/macos/build.sh --sign               # 自动挑一个 Developer ID 签名
#   bash app/macos/build.sh --sign "Developer ID Application: 张三 (AB12CD34EF)"
#   bash app/macos/build.sh --sign --notarize --profile dsh-learn   # 签名 + 公证 + stapling
#
# 产物：dist/dsh-learn.app
set -eo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
APP="$ROOT/dist/dsh-learn.app"
# 先构建到临时目录，全部成功后再替换：构建或签名失败时，上一个可用版本不会被毁掉
BUILD_DIR="$ROOT/dist/.dsh-learn.app.building"
CONTENTS="$BUILD_DIR/Contents"

SIGN_TARGET=""
NOTARIZE=0
PROFILE="dsh-learn"

while [ $# -gt 0 ]; do
  case "$1" in
    --identity-list)
      echo "本机可用签名身份："
      security find-identity -v -p codesigning || true
      echo "提示：没有身份时只能用临时签名（ad-hoc），别人下载后会被 Gatekeeper 拦下。"
      exit 0
      ;;
    --sign)
      shift
      case "$1" in
        ''|--*)
          SIGN_TARGET="auto"
          ;;
        *)
          SIGN_TARGET="$1"
          shift
          ;;
      esac
      continue
      ;;
    --notarize)
      NOTARIZE=1
      shift
      continue
      ;;
    --profile)
      shift
      PROFILE="$1"
      shift
      continue
      ;;
    *)
      echo "未知参数：$1"
      exit 2
      ;;
  esac
  shift
done

echo "==> 项目目录：$ROOT"
command -v swiftc >/dev/null || { echo "缺少 swiftc：请安装 Xcode 或 Command Line Tools（xcode-select --install）"; exit 1; }

# 1. 图标：从 1024 PNG 生成 .icns（缺图就现生成）
if [ ! -f "$ROOT/web/icons/icon-1024.png" ]; then
  echo "==> 生成图标"
  python3 "$ROOT/scripts/gen-icons.py" >/dev/null
fi
ICONSET_DIR="$(mktemp -d)"
ICONSET="$ICONSET_DIR/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 64 128 256 512 1024; do
  OUT="$ICONSET/icon_"$size"x"$size".png"
  sips -z "$size" "$size" "$ROOT/web/icons/icon-1024.png" --out "$OUT" >/dev/null
done
mv "$ICONSET/icon_"64"x"64".png" "$ICONSET/icon_32x32@2x.png"
mv "$ICONSET/icon_"1024"x"1024".png" "$ICONSET/icon_512x512@2x.png"

# 2. 目录结构（在临时目录里搭，最后再搬到 dist）
rm -rf "$BUILD_DIR"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

# 3. 编译（-swift-version 5：避开 Swift 6 严格并发对 main-actor 的要求）
echo "==> 编译 Swift"
swiftc -O -swift-version 5 \
  "$HERE/main.swift" "$HERE/Engine.swift" "$HERE/EngineModels.swift" "$HERE/EngineHTTP.swift" "$HERE/NativeUI.swift" "$HERE/ProjectsFilter.swift" "$HERE/VerdictPanel.swift" "$HERE/Panels.swift" "$HERE/Pages.swift" "$HERE/Preferences.swift" \
  -o "$CONTENTS/MacOS/dsh-learn" \
  -framework Cocoa -framework SwiftUI

# 3.5 把引擎打进 App：src / packs / web / package.json 复制到 Contents/Resources/engine。
# 这样 App 自带判定引擎，不必去读项目目录——装在 ~/Applications（非受保护目录）后
# 就不会再碰上 macOS 的"文稿文件夹"权限：从 GUI 派生的子进程读 ~/Documents 下的文件会被 TCC 卡住。
echo "==> 打包引擎"
ENGINE="$CONTENTS/Resources/engine"
mkdir -p "$ENGINE"
# tools/ 也要带上：src/core/ocr.mjs 会用 tools/ocr.swift 现场编译 OCR 助手，
# 少了它，App 在"这台机器还没编译过助手"时截图 OCR 会直接失败（实测：清空 ~/.dsh-learn 后必现）
cp -R "$ROOT/src" "$ROOT/packs" "$ROOT/web" "$ROOT/tools" "$ENGINE/"
cp "$ROOT/package.json" "$ENGINE/"
node -e 'const p=require(process.argv[1]);console.log(p.version)' "$ROOT/package.json" >/dev/null 2>&1 || true

# 4. Info.plist：把项目目录写进去（开发时用；正式运行优先用 App 内置引擎）
sed "s|__PROJECT_ROOT__|$ROOT|g" "$HERE/Info.plist.template" > "$CONTENTS/Info.plist"
plutil -lint "$CONTENTS/Info.plist" >/dev/null

# 5. 图标打包
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/AppIcon.icns"
rm -rf "$ICONSET_DIR"

# 6. 选择签名身份
if [ "$SIGN_TARGET" = "auto" ]; then
  SIGN_TARGET="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)"
  if [ -z "$SIGN_TARGET" ]; then
    echo "找不到 Developer ID Application 证书。"
    echo "  查看本机身份：bash app/macos/build.sh --identity-list"
    echo "  申请与配置步骤见 docs/RELEASE-MAC.md"
    exit 1
  fi
fi

if [ -n "$SIGN_TARGET" ]; then
  echo "==> 正式签名：$SIGN_TARGET"
  # --options runtime：开启 hardened runtime，公证的前置条件；--timestamp：带上可信时间戳
  if ! codesign --force --deep --options runtime --timestamp --sign "$SIGN_TARGET" "$BUILD_DIR"; then
    echo "签名失败，dist 下的上一个版本保持不变。"
    exit 1
  fi
  codesign --verify --verbose=2 "$BUILD_DIR" 2>&1 | tail -2
else
  echo "==> 临时签名（ad-hoc，仅本机可用）"
  codesign --force --deep --sign - "$BUILD_DIR" >/dev/null 2>&1 || echo "（临时签名失败，本机仍可运行）"
  codesign --verify --deep "$BUILD_DIR" && echo "==> 签名校验通过"
  echo "    要给别人用请加 --sign（需 Developer ID 证书），分发还需要 --notarize"
fi

# 6.5 原子替换：到这一步新的 App 才可能覆盖旧的
rm -rf "$APP"
mv "$BUILD_DIR" "$APP"

if [ -n "$SIGN_TARGET" ]; then
  echo "==> 检查 Gatekeeper 是否认可"
  spctl -a -vv "$APP" 2>&1 | head -3 || echo "（spctl 未通过：通常是还没公证，继续加 --notarize）"
fi

# 7. 公证 + stapling
if [ "$NOTARIZE" = "1" ]; then
  if [ -z "$SIGN_TARGET" ]; then
    echo "公证需要正式签名，请同时加 --sign"
    exit 1
  fi
  echo "==> 打包并上传公证（profile：$PROFILE ）"
  ZIP="$ROOT/dist/dsh-learn.zip"
  rm -f "$ZIP"
  ditto -c -k --keepParent "$APP" "$ZIP"
  if ! xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait; then
    echo "公证提交失败。先配置凭据："
    echo "  xcrun notarytool store-credentials $PROFILE --apple-id <Apple ID> --team-id <TEAMID> --password <App 专用密码>"
    echo "详见 docs/RELEASE-MAC.md"
    exit 1
  fi
  echo "==> stapling（把公证票据钉进 App，离线也能通过 Gatekeeper）"
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
  spctl -a -vv "$APP" 2>&1 | head -3
  rm -f "$ZIP"
fi

echo "==> 完成：$APP"
echo "    双击运行，或：open '$APP'"
