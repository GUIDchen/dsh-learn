#!/usr/bin/env bash
# 产出可分发（或本机归档）的 macOS 发布包，并把版本号打通：
#   选版本 -> 写入 package.json 与 Info.plist.template -> 构建 -> 签名/公证 -> 打包 zip + 校验和 -> 记一笔发布记录
#
# 用法：
#   bash scripts/release-mac.sh --ad-hoc                    # 本机归档包，版本号默认 patch +1
#   bash scripts/release-mac.sh --bump minor --ad-hoc       # 明确指定怎么涨版本
#   bash scripts/release-mac.sh --version 0.2.0 --ad-hoc    # 直接指定版本号
#   bash scripts/release-mac.sh                             # Developer ID 签名 + 公证（需要证书）
#   bash scripts/release-mac.sh --dry-run --bump minor      # 只看版本会变成什么，不写文件、不构建
#   bash scripts/release-mac.sh --ad-hoc --note "题库扩到 201 题"
#
# 退出码：0 成功；1 缺证书/凭据或校验失败；2 参数错误
set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
PLIST_TEMPLATE="$ROOT/app/macos/Info.plist.template"
PACKAGE_JSON="$ROOT/package.json"
RELEASES_MD="$ROOT/docs/RELEASES.md"
DIST="$ROOT/dist"
PROFILE="dsh-learn"
AD_HOC=0
DRY_RUN=0
BUMP=""
TARGET_VERSION=""
NOTE=""
SKIP_TESTS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --ad-hoc) AD_HOC=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --bump) shift; BUMP="$1"; shift ;;
    --version) shift; TARGET_VERSION="$1"; shift ;;
    --profile) shift; PROFILE="$1"; shift ;;
    --note) shift; NOTE="$1"; shift ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

CURRENT="$(node -e "process.stdout.write(require('./package.json').version)")"
if [ -n "$TARGET_VERSION" ]; then
  NEXT="$(node -e "import('./src/core/version.mjs').then(m=>{const p=m.parseVersion(process.argv[1]);if(!p){console.error('版本号必须是 x.y.z：'+process.argv[1]);process.exit(1)}process.stdout.write(m.formatVersion(p))})" "$TARGET_VERSION")" || exit 2
else
  NEXT="$(node -e "import('./src/core/version.mjs').then(m=>process.stdout.write(m.bumpVersion(process.argv[1], process.argv[2] || 'patch')))" "$CURRENT" "$BUMP")"
fi
BUILD_NUMBER="$(node -e "import('./src/core/version.mjs').then(m=>process.stdout.write(m.buildNumber(process.argv[1])))" "$NEXT")"

# 发布前哨：先跑用例，红了就拒绝发布（要跳过加 --skip-tests）。
# 理由：本项目出现过「用例红的、包已经发出去」——把顺序固化进脚本，而不是靠记性。
if [ "$SKIP_TESTS" != "1" ]; then
  echo "==> 发布前先跑用例（跳过加 --skip-tests）"
  if ! ( cd "$ROOT" && node --test >"$ROOT/dist/release-preflight.log" 2>&1 ); then
    echo "用例未通过，已中止发布。日志：dist/release-preflight.log"
    tail -20 "$ROOT/dist/release-preflight.log"
    exit 1
  fi
  echo "    用例通过：$(grep -E 'pass [0-9]+' "$ROOT/dist/release-preflight.log" | tail -1 | tr -d '\r')"
fi

echo "==> 版本：$CURRENT -> $NEXT （构建号 $BUILD_NUMBER ）"
if [ "$DRY_RUN" = "1" ]; then
  echo "（--dry-run：不改文件、不构建）"
  exit 0
fi

# 1) 版本号同时写进 package.json 与 Info.plist 模板：两处必须一致，否则 verify.sh 会拦
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
pkg.version = process.argv[2];
fs.writeFileSync(process.argv[1], JSON.stringify(pkg, null, 2) + '\n');
const plistPath = process.argv[3];
let plist = fs.readFileSync(plistPath, 'utf8');
plist = plist.replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/, '\$1' + process.argv[2] + '\$2');
plist = plist.replace(/(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/, '\$1' + process.argv[4] + '\$2');
fs.writeFileSync(plistPath, plist);
" "$PACKAGE_JSON" "$NEXT" "$PLIST_TEMPLATE" "$BUILD_NUMBER"
echo "==> 已写入 package.json 与 app/macos/Info.plist.template"

# 2) 构建（参数透传给 build.sh：--ad-hoc 之外还给 --sign/--notarize）
ZIP="$DIST/dsh-learn-$NEXT.zip"
APP="$DIST/dsh-learn.app"
if [ "$AD_HOC" = "1" ]; then
  echo "==> 本机归档模式（ad-hoc 签名，不做公证）"
  bash "$ROOT/app/macos/build.sh"
else
  if ! security find-identity -v -p codesigning | grep -q 'Developer ID Application'; then
    echo "没有 Developer ID Application 证书，无法产出可对外分发的版本。"
    echo "  1) 申请证书：docs/RELEASE-MAC.md 第 1 节"
    echo "  2) 只看本机现有身份：bash app/macos/build.sh --identity-list"
    echo "  3) 只想本机归档：bash scripts/release-mac.sh --ad-hoc"
    exit 1
  fi
  echo "==> 签名 + 公证（profile：$PROFILE ）"
  bash "$ROOT/app/macos/build.sh" --sign --notarize --profile "$PROFILE"
fi

# 3) 校验与打包
echo "==> 校验签名"
codesign --verify --deep "$APP"
if [ "$AD_HOC" = "0" ]; then
  xcrun stapler validate "$APP"
  spctl -a -vv "$APP" 2>&1 | head -3
fi

echo "==> 打包"
mkdir -p "$DIST"
rm -f "$ZIP" "$ZIP.sha256"
ditto -c -k --keepParent "$APP" "$ZIP"
( cd "$DIST" && shasum -a 256 "dsh-learn-$NEXT.zip" > "dsh-learn-$NEXT.zip.sha256" )
SHA="$(cut -d' ' -f1 "$ZIP.sha256")"

# 4) 记一笔发布记录：版本、日期、题库规模、校验和、备注
TASKS="$(node -e "import('./src/core/tasks.mjs').then(m=>process.stdout.write(String(m.TASKS.length)))")"
TRACKS="$(node -e "import('./src/core/tasks.mjs').then(m=>process.stdout.write(String(m.TRACKS.length)))")"
DATE="$(date '+%Y-%m-%d %H:%M')"
if [ ! -f "$RELEASES_MD" ]; then
  printf '# 发布记录\n\n每次 bash scripts/release-mac.sh 都会在下面追加一行。\n\n| 版本 | 时间 | 题库 | SHA-256（前 12 位） | 说明 |\n| --- | --- | --- | --- | --- |\n' > "$RELEASES_MD"
fi
printf '| %s | %s | %s 题 / %s 轨道 | %s | %s |\n' "$NEXT" "$DATE" "$TASKS" "$TRACKS" "$(printf '%s' "$SHA" | cut -c1-12)" "$NOTE" >> "$RELEASES_MD"

echo "==> 产物"
ls -lh "$ZIP" "$ZIP.sha256" | awk '{print "    " $9 "  " $5}'
cat "$ZIP.sha256"
echo "==> 发布记录已追加：docs/RELEASES.md（版本 $NEXT ）"

# 版本号变了，进度文档里的"当前版本"就过期：顺手重新生成一次，
# 免得每次发完版还要记得手动跑（护栏测试因为这个红过两次）。
if [ -f "$ROOT/scripts/progress-doc.mjs" ]; then
  if node "$ROOT/scripts/progress-doc.mjs" >/dev/null 2>&1; then
    echo "==> 已同步 docs/PROGRESS.md（版本 $NEXT ）"
  else
    echo "（docs/PROGRESS.md 生成失败：手动跑 node scripts/progress-doc.mjs 看看）"
  fi
fi
if [ "$AD_HOC" = "1" ]; then
  echo "注意：这是本机归档包（未公证），别人下载会被 Gatekeeper 拦下。对外分发请不加 --ad-hoc 重跑。"
else
  echo "可以对外分发：签名 + 公证 + stapling 均已完成。"
fi
