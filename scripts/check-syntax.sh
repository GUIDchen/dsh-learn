#!/usr/bin/env bash
# 全仓语法体检：所有 .mjs/.js 用 node --check，网页版的模块脚本单独抽出来检查。
# 手写代码最容易犯的错就是把 '\n' 写成了真实换行，这个脚本能在跑测试之前抓到。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

fail=0
checked=0

for file in $(find src test scripts app web -name '*.mjs' | sort); do
  checked=$((checked + 1))
  if ! node --check "$file" > /tmp/dsh-syntax.log 2>&1; then
    echo "语法错误：$file"
    sed -n '1,6p' /tmp/dsh-syntax.log
    fail=$((fail + 1))
  fi
done
echo "已检查 $checked 个 JS 文件"

# 网页版的 markup 里不该再有内联模块脚本（逻辑统一放 web/app.mjs）
if grep -q '<script type="module">' web/index.html; then
  echo "web/index.html 里还有内联 module script，应改为引用 /app.mjs"
  fail=$((fail + 1))
fi
if ! grep -q 'src="/app.mjs"' web/index.html; then
  echo "web/index.html 没有引用 /app.mjs"
  fail=$((fail + 1))
fi

# shell 脚本另有一条坑：bash 3.2 遇到「变量紧跟中文」会把中文吞进变量名
if ! node scripts/check-shell.mjs; then
  fail=$((fail + 1))
fi

if [ "$fail" != "0" ]; then
  echo "语法体检失败：$fail 个文件"
  exit 1
fi
echo "语法体检通过（$checked 个文件）"
