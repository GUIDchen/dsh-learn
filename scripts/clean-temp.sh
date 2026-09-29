#!/usr/bin/env bash
# 清理验证产物：headless Chrome 的 profile、编译出的自检二进制、临时 home、日志。
#
# 为什么需要：三端验证每轮都会在 /tmp 留东西（Chrome profile 每个 10–130MB，自检二进制若干），
# 十几轮下来能攒到几百 MB；第 15 轮验收时磁盘压力把 scripts/verify.sh 的两项检查拖挂了
#（No space left on device），这才意识到验证循环也要做卫生。
#
# 只删本项目产生的、明显属于验证产物的东西；**不动** /tmp/dsh-boss-profile（那是用户的 BOSS 登录态）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-}"

echo "清理验证产物（工作目录：${ROOT}）"

before=$(df -k /System/Volumes/Data 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)

# 1) headless Chrome 的临时 profile（保留用户自己的 BOSS profile）
for dir in /tmp/cdp-profile-*; do
  [ -e "$dir" ] || continue
  case "$dir" in
    /tmp/dsh-boss-profile) continue ;;
  esac
  rm -rf "$dir"
  echo "  删除 $dir"
done

# 2) 自检编译产物与临时 home
rm -rf /tmp/selftest-* /tmp/dsh-learn-selftest-home-* /tmp/dsh-learn-web-* /tmp/dsh-learn-api-repo-* 2>/dev/null || true
rm -rf /tmp/dsh-follow-demo /tmp/dsh-refresh-* /tmp/dsh-doctor-* /tmp/dsh-corpus-* /tmp/dsh-cache-* 2>/dev/null || true

# 3) 中间截图与日志（最终证据都在 docs/evidence 里）
rm -f /tmp/dsh-full*.png /tmp/web-shot*.png /tmp/*.log 2>/dev/null || true
if [ "$MODE" = '--dist-zips' ]; then
  # 发行归档：默认保留最近 3 个，其余删掉（历史版本在 docs/RELEASES.md 里有记录）
  cd "$ROOT/dist" 2>/dev/null && ls -t dsh-learn-*.zip 2>/dev/null | tail -n +4 | while read -r zip; do rm -f "$zip" "$zip.sha256"; echo "  删除 dist/$zip"; done
fi

after=$(df -k /System/Volumes/Data 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
echo "完成：释放约 $(( (after - before) / 1024 )) Mi（当前可用 $(( after / 1024 )) Mi）"
echo "提示：--dist-zips 会额外清 dist/ 里旧的发行归档（保留最近 3 个）"
