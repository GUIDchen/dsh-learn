#!/usr/bin/env bash
# 本地实验室：给"需要真环境才能验证"的题目准备靶子。
#   bash scripts/lab.sh up      起实验环境（kind 集群 + 压测靶机）
#   bash scripts/lab.sh status  看现在有什么可用
#   bash scripts/lab.sh down    收掉实验环境
# 设计原则：不自动安装任何东西（kind/kubectl 缺失时给出确切的安装命令并如实退出），
# 也不碰用户已有的集群——kind 集群固定叫 dsh-learn-lab，压测靶机只监听回环。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

CLUSTER_NAME="dsh-learn-lab"
# 端口可用环境变量覆盖：这里用 printenv 而不是 ${VAR:-default}，避免脚本被模板化时吃掉默认值
TARGET_PORT="$(printenv DSH_LEARN_TARGET_PORT)"
[ -n "$TARGET_PORT" ] || TARGET_PORT=8899
BASE_DIR="$TMPDIR"
[ -n "$BASE_DIR" ] || BASE_DIR=/tmp
TARGET_LOG="$BASE_DIR/dsh-learn-target.log"
TARGET_PID_FILE="$BASE_DIR/dsh-learn-target.pid"
KIND_LOG="$BASE_DIR/dsh-learn-kind.log"
KIND_KUBECONFIG="$BASE_DIR/dsh-learn-lab.kubeconfig"

has() { command -v "$1" >/dev/null 2>&1; }

target_running() {
  [ -f "$TARGET_PID_FILE" ] && kill -0 "$(cat "$TARGET_PID_FILE")" 2>/dev/null
}

cluster_exists() {
  has kind && $TMO 15 kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"
}

# 所有外部命令都套超时：docker/kind 在守护进程卡死时会一直不返回（实测挂过 20 分钟）
TMO="node scripts/with-timeout.mjs"

status() {
  if has kind; then printf 'kind      : %s\n' "$($TMO 10 kind version 2>/dev/null | head -1)"; else printf 'kind      : 缺失（brew install kind）\n'; fi
  if has kubectl; then printf 'kubectl   : %s\n' "$($TMO 10 kubectl version --client 2>/dev/null | head -1)"; else printf 'kubectl   : 缺失（brew install kubectl）\n'; fi
  printf 'docker    : %s\n' "$($TMO 10 docker version --format '{{.Server.Version}}' 2>/dev/null || echo '守护进程不可用')"
  if has wrk; then printf 'wrk       : 有\n'; else printf 'wrk       : 缺失（可选：brew install wrk）\n'; fi
  if has ab; then printf 'ab        : 有\n'; else printf 'ab        : 缺失（可选）\n'; fi
  if target_running; then
    printf '压测靶机  : http://127.0.0.1:%s（pid %s）\n' "$TARGET_PORT" "$(cat "$TARGET_PID_FILE")"
  else
    printf '压测靶机  : 未运行\n'
  fi
  if cluster_exists; then printf 'k8s 集群  : kind/%s 已就绪\n' "$CLUSTER_NAME"; else printf 'k8s 集群  : 未就绪\n'; fi
}

up() {
  failed=0

  # 1) 压测靶机：零依赖，随时能起
  if target_running; then
    echo "压测靶机已在运行（pid $(cat "$TARGET_PID_FILE")）"
  else
    node scripts/load-target.mjs --port "$TARGET_PORT" > "$TARGET_LOG" 2>&1 &
    echo $! > "$TARGET_PID_FILE"
    sleep 1
    if curl -s -o /dev/null "http://127.0.0.1:$TARGET_PORT/health"; then
      echo "压测靶机已启动：http://127.0.0.1:$TARGET_PORT （日志 $TARGET_LOG ）"
    else
      echo "压测靶机启动失败，见 $TARGET_LOG"
      failed=1
    fi
  fi

  # 2) kind 集群
  if ! has kind; then
    echo "缺少 kind：brew install kind（本脚本只驱动 kind，不自动安装）"
    failed=1
  elif ! $TMO 10 docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
    echo "Docker 守护进程不可用：先起 Docker Desktop / OrbStack 再来"
    failed=1
  elif cluster_exists; then
    echo "kind 集群 $CLUSTER_NAME 已存在"
  else
    # 节点镜像可以先备好：镜像仓被墙的环境里，指定本地已有的镜像或可用镜像仓
    node_image="$(printenv DSH_LEARN_KIND_IMAGE)"
    image_args=""
    if [ -n "$node_image" ]; then
      if $TMO 20 docker image inspect "$node_image" >/dev/null 2>&1; then
        echo "用本地已有的节点镜像：$node_image"
      else
        echo "节点镜像 $node_image 不在本地，尝试拉取…"
        if ! $TMO 120 docker pull "$node_image" > "$KIND_LOG" 2>&1; then
          echo "镜像拉取失败（见 $KIND_LOG 最后一行）"
          tail -1 "$KIND_LOG"
          echo "两条路：先把节点镜像拉到本地，或改 DSH_LEARN_KIND_IMAGE 指向可用的镜像仓"
          status
          return 1
        fi
      fi
      image_args="--image $node_image"
    fi
    echo "正在创建 kind 集群 $CLUSTER_NAME （第一次要拉节点镜像，几分钟）…"
    if $TMO 300 kind create cluster --name "$CLUSTER_NAME" $image_args --wait 120s > "$KIND_LOG" 2>&1; then
      echo "kind 集群已创建"
    else
      echo "创建失败，见 $KIND_LOG 最后几行："
      tail -4 "$KIND_LOG"
      if grep -qi 'deadline exceeded\|registry-1.docker.io\|dial tcp' "$KIND_LOG"; then
        echo "看起来是镜像仓不可达（Docker Hub 被墙很常见）。两条现成的路："
        echo "  1) 在 Docker Desktop / OrbStack 里配好 registry mirror，再重跑 bash scripts/lab.sh up"
        echo "  2) 先 docker pull 一个能用的 kindest/node 镜像，再："
        echo "     DSH_LEARN_KIND_IMAGE=<你的镜像> bash scripts/lab.sh up"
      fi
      failed=1
    fi
  fi

  if cluster_exists; then
    $TMO 20 kind export kubeconfig --name "$CLUSTER_NAME" --kubeconfig "$KIND_KUBECONFIG" >/dev/null 2>&1
    if [ -f "$KIND_KUBECONFIG" ]; then
      echo "实验室 kubeconfig：export KUBECONFIG=$KIND_KUBECONFIG"
      echo "（只影响当前 shell；不要覆盖你日常用的 ~/.kube/config）"
    fi
  fi

  status
  return $failed
}

down() {
  if target_running; then
    pid="$(cat "$TARGET_PID_FILE")"
    kill "$pid" 2>/dev/null && echo "压测靶机已停止（pid $pid ）"
  fi
  rm -f "$TARGET_PID_FILE"
  if cluster_exists; then
    $TMO 60 kind delete cluster --name "$CLUSTER_NAME" >/dev/null 2>&1 && echo "kind 集群已删除"
  fi
  rm -f "$KIND_KUBECONFIG"
  status
}

ACTION="$1"
[ -n "$ACTION" ] || ACTION=status
case "$ACTION" in
  up) up ;;
  down) down ;;
  status) status ;;
  *) echo "用法：bash scripts/lab.sh up|status|down"; exit 2 ;;
esac
