#!/usr/bin/env bash
#
# scripts/push-to-github.sh — 把 router-core/ 推到 GitHub 名为 EchoCode-Router 的新仓库
#
# 前置：
#   1) 安装 gh CLI（https://cli.github.com/）
#   2) gh auth login
#
# 用法：
#   bash scripts/push-to-github.sh
#
# 效果：
#   - 在 GitHub 上创建公开仓库 echo-code/EchoCode-Router
#   - 临时 clone 它到 .github-clone-tmp
#   - 把 router-core/ 的内容拷贝过去（排除 node_modules / dist / .DS_Store）
#   - 提交 + push
#   - 删除临时目录

set -euo pipefail

REPO_ORG="echo-code"
REPO_NAME="EchoCode-Router"
REPO_DESC="Smart AI gateway router — cascading failover, weighted key pool, rollout. 0 backend deps."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"

if ! command -v gh >/dev/null 2>&1; then
  echo "❌ gh CLI 未安装。先装：brew install gh / apt install gh / winget install..."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "❌ gh 未登录。先：gh auth login"
  exit 1
fi

echo "📦 在 GitHub 上创建 $REPO_ORG/$REPO_NAME ..."
gh repo create "$REPO_ORG/$REPO_NAME" \
  --public \
  --description "$REPO_DESC" \
  --clone "$TMP_DIR" || true

# 仓库已存在的情况：clone
if [ ! -d "$TMP_DIR/.git" ]; then
  gh repo clone "$REPO_ORG/$REPO_NAME" "$TMP_DIR"
fi

cd "$TMP_DIR"

echo "📋 把 router-core 内容拷贝到 $REPO_NAME ..."
rsync -a --exclude='node_modules' --exclude='dist' --exclude='.DS_Store' \
  "$ROOT_DIR/" "./"

# 替换仓库里的默认 README（gh create 时会创建一份）
if [ -f "README.md" ] && ! grep -q "EchoCode Router" README.md; then
  rm -f README.md
fi

git add -A
git -c user.name="EchoCode Robot" -c user.email="oss@echo-code.dev" commit -m "feat: initial open-source release of EchoCode Router" || {
  echo "⚠️ 没有需要提交的更改"
}

git push -u origin main 2>/dev/null || git push -u origin master 2>/dev/null || {
  echo "❌ push 失败，请手动检查"
  exit 1
}

echo
echo "✅ 完成！"
echo "   Repo: https://github.com/$REPO_ORG/$REPO_NAME"
echo "   临时目录保留：$TMP_DIR（验证后可手动删除）"
