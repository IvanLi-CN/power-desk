# Power Desk Web Config Tool - 生产优化版 Dockerfile
# 基于 Bun 运行时的多阶段构建

# 使用 Bun 官方镜像作为基础
FROM oven/bun:1 AS base

# 设置工作目录
WORKDIR /app

# 阶段 1: 依赖安装
FROM base AS deps

# 复制 package 定义文件
COPY package.json ./

# 安装依赖（虽然这个项目没有外部依赖，但保持最佳实践）
RUN bun install --frozen-lockfile --production

# 阶段 2: 构建阶段（准备应用文件）
FROM base AS build

WORKDIR /app

# 复制 package 文件
COPY package.json ./

# 安装所有依赖（开发 + 生产）
RUN bun install --frozen-lockfile

# 复制所有源代码
COPY . .

# 这个项目不需要构建步骤，但我们可以在这里做一些准备工作
# 比如验证文件完整性或设置权限
RUN echo "✅ 应用文件准备完成"

# 阶段 3: 生产运行时镜像
FROM base AS runtime

# 创建非 root 用户以提高安全性
RUN adduser --disabled-password --gecos "" appuser

# 设置工作目录
WORKDIR /app

# 从依赖阶段复制 node_modules（如果有的话）
COPY --from=deps /app/node_modules ./node_modules

# 从构建阶段复制应用文件
COPY --from=build /app/*.js ./
COPY --from=build /app/*.html ./
COPY --from=build /app/*.json ./
COPY --from=build /app/*.bin ./
COPY --from=build /app/*.py ./

# 设置文件所有者为 appuser
RUN chown -R appuser:appuser /app

# 切换到非 root 用户
USER appuser

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=25080

# 暴露端口
EXPOSE 25080

# 添加健康检查（使用 Bun 的内置 fetch 功能）
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun -e "fetch('http://localhost:25080/').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# 启动应用
CMD ["bun", "run", "power-desk-server.js"]
