#!/bin/bash

# Power Desk Config Tool Server 启动脚本

echo "🚀 启动 Power Desk Config Tool Server..."
echo ""

# 检查 Bun 是否安装
if ! command -v bun &> /dev/null; then
    echo "❌ 错误: 未找到 Bun"
    echo "请先安装 Bun: https://bun.sh/"
    echo ""
    echo "安装命令:"
    echo "curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "✅ Bun 版本: $(bun --version)"
echo ""

# 启动服务器
echo "🌐 启动服务器..."
bun run power-desk-server.js
