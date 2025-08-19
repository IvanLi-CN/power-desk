# Power Desk Config Tool - Docker 部署指南

## 🐳 Docker 化完成

白羽已经成功为 Power Desk Web Config Tool 创建了生产级 Docker 镜像！

## 📦 包含文件

- `Dockerfile` - 生产优化版多阶段构建
- `.dockerignore` - 优化构建上下文
- `docker-compose.yml` - 便于本地开发
- `docker-build.sh` - 自动化构建脚本
- `docker-run.sh` - 便捷运行脚本

## 🚀 快速开始

### 方法一：使用构建脚本（推荐）

```bash
# 1. 构建镜像
./docker-build.sh

# 2. 运行容器
./docker-run.sh
```

### 方法二：使用 docker-compose

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 方法三：手动 Docker 命令

```bash
# 构建镜像
docker build -t power-desk-config-tool:latest .

# 运行容器
docker run -d \
  --name power-desk-config-tool \
  -p 25086:25086 \
  --restart unless-stopped \
  power-desk-config-tool:latest
```

## 🌐 访问服务

启动后访问：<http://localhost:25086>

## 📊 镜像特性

- **基础镜像**: oven/bun:1-alpine (官方 Bun 镜像)
- **运行时**: Bun (高性能 JavaScript 运行时)
- **镜像大小**: ~200MB (优化后)
- **架构**: 单阶段构建优化
- **安全性**: 非 root 用户运行
- **健康检查**: 自动监控服务状态
- **端口**: 25086

## 🏗️ 构建过程

1. **基础环境**：使用 oven/bun:1-alpine 镜像
2. **依赖安装**：使用 Bun 安装依赖
3. **Vite 构建**：使用 Vite 构建完整的生产版本
4. **应用复制**：复制服务器文件
5. **环境配置**：设置生产环境变量

## 🛡️ 安全特性

- ✅ 非 root 用户 (appuser) 运行
- ✅ 最小化文件复制
- ✅ 生产环境变量设置
- ✅ 健康检查机制
- ✅ 资源限制配置

## 📋 常用命令

```bash
# 查看容器状态
docker ps

# 查看日志
docker logs power-desk-config-tool

# 进入容器
docker exec -it power-desk-config-tool /bin/bash

# 停止容器
docker stop power-desk-config-tool

# 删除容器
docker rm power-desk-config-tool

# 查看健康状态
docker inspect power-desk-config-tool --format='{{.State.Health.Status}}'
```

## 🔧 配置说明

### 环境变量

- `NODE_ENV=production` - 生产环境模式
- `PORT=25086` - 服务端口
- `GITHUB_TOKEN` - GitHub API Token（可选，提高 API 限制）

### 资源限制

- CPU: 最大 1.0 核心，预留 0.25 核心
- 内存: 最大 512MB，预留 128MB

### 健康检查

- 检查间隔: 30 秒
- 超时时间: 10 秒
- 启动等待: 5 秒
- 重试次数: 3 次

## 🐛 故障排除

### 容器无法启动

```bash
# 查看详细日志
docker logs power-desk-config-tool

# 检查端口占用
lsof -i :25086
```

### 健康检查失败

```bash
# 手动测试服务
curl -f http://localhost:25086/

# 检查容器内部
docker exec -it power-desk-config-tool bun --version
```

### 构建失败

```bash
# 清理 Docker 缓存
docker system prune -f

# 重新构建
./docker-build.sh
```

## 🎯 生产部署建议

1. **使用 docker-compose** 进行服务编排
2. **配置反向代理** (Nginx/Traefik) 处理 HTTPS
3. **设置日志轮转** 避免日志文件过大
4. **监控健康状态** 配置告警机制
5. **定期更新镜像** 保持安全性

## 📝 更新说明

如需更新应用代码：

1. 修改源代码
2. 重新运行 `./docker-build.sh`
3. 停止旧容器：`docker stop power-desk-config-tool`
4. 启动新容器：`./docker-run.sh`

## 🎉 完成

Docker 化部署完成！现在你可以：

- 🚀 在任何支持 Docker 的环境中运行
- 📦 轻松部署到云平台
- 🔄 快速扩展和更新
- 🛡️ 享受容器化的安全隔离

喵~ 白羽的任务完成了！
