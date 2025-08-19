#!/bin/bash

# Power Desk Config Tool - Docker 构建脚本
# 生产优化版构建

set -e  # 遇到错误立即退出

echo "🐳 Power Desk Config Tool - Docker 构建脚本"
echo "================================================"

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: Docker 未安装或不在 PATH 中"
    echo "请先安装 Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

echo "✅ Docker 版本: $(docker --version)"
echo ""

# 设置镜像名称和标签
IMAGE_NAME="power-desk-config-tool"
IMAGE_TAG="latest"
FULL_IMAGE_NAME="${IMAGE_NAME}:${IMAGE_TAG}"

echo "🏗️  开始构建 Docker 镜像..."
echo "镜像名称: ${FULL_IMAGE_NAME}"
echo ""

# 构建镜像
echo "📦 执行 Docker 构建..."
docker build \
    --tag "${FULL_IMAGE_NAME}" \
    --file Dockerfile \
    .

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 构建成功！"
    echo ""
    echo "📊 镜像信息:"
    docker images "${IMAGE_NAME}" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
    echo ""
    echo "🚀 运行命令:"
    echo "   docker run -p 25086:25086 ${FULL_IMAGE_NAME}"
    echo ""
    echo "🐙 或使用 docker-compose:"
    echo "   docker-compose up -d"
    echo ""
    echo "🌐 访问地址:"
    echo "   http://localhost:25086"
else
    echo ""
    echo "❌ 构建失败！"
    exit 1
fi
