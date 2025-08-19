# Power Desk Web Config Tool - 生产环境 Dockerfile
FROM oven/bun:1-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 并安装所有依赖（包括 devDependencies 用于构建）
COPY package.json bun.lock* ./
RUN bun install

# 复制源文件和配置
COPY vite.config.js ./
COPY index.html ./
COPY config-tool.js ./
COPY src ./src

# 使用 Vite 构建生产版本
RUN bun run build

# 复制应用文件
COPY server.js ./

# 构建产物已在 dist/ 目录中生成

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=25086

# 暴露端口
EXPOSE 25086

# 启动应用
CMD ["bun", "run", "server.js"]
