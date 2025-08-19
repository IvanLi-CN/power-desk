#!/bin/bash

# Power Desk Config Tool - Docker 运行脚本

set -e  # 遇到错误立即退出

echo "🚀 Power Desk Config Tool - Docker 运行脚本"
echo "=============================================="

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: Docker 未安装或不在 PATH 中"
    exit 1
fi

# 设置镜像名称
IMAGE_NAME="power-desk-config-tool:latest"
CONTAINER_NAME="power-desk-config-tool"
PORT="25086"

echo "🔍 检查镜像是否存在..."
if ! docker images "${IMAGE_NAME}" --format "{{.Repository}}:{{.Tag}}" | grep -q "${IMAGE_NAME}"; then
    echo "❌ 镜像 ${IMAGE_NAME} 不存在"
    echo "请先运行构建脚本: ./docker-build.sh"
    exit 1
fi

echo "✅ 镜像 ${IMAGE_NAME} 已找到"

# 停止并删除已存在的容器（如果有）
if docker ps -a --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "🛑 停止并删除已存在的容器..."
    docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
fi

echo ""
echo "🐳 启动 Docker 容器..."
echo "容器名称: ${CONTAINER_NAME}"
echo "端口映射: ${PORT}:${PORT}"
echo ""

# 运行容器
docker run \
    --detach \
    --name "${CONTAINER_NAME}" \
    -p "${PORT}:${PORT}" \
    --restart unless-stopped \
    "${IMAGE_NAME}"

if [ $? -eq 0 ]; then
    echo "✅ 容器启动成功！"
    echo ""
    echo "📊 容器状态:"
    docker ps --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo "🌐 访问地址:"
    echo "   http://localhost:${PORT}"
    echo ""
    echo "📋 常用命令:"
    echo "   查看日志: docker logs ${CONTAINER_NAME}"
    echo "   停止容器: docker stop ${CONTAINER_NAME}"
    echo "   删除容器: docker rm ${CONTAINER_NAME}"
    echo "   进入容器: docker exec -it ${CONTAINER_NAME} /bin/bash"
    echo ""
    echo "🔍 健康检查状态:"
    echo "   docker inspect ${CONTAINER_NAME} --format='{{.State.Health.Status}}'"
else
    echo "❌ 容器启动失败！"
    exit 1
fi
