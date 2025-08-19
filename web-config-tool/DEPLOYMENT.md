# Power Desk 固件配置工具 - 部署指南

## 🚀 快速部署

### 开发环境

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev
```

访问：http://localhost:25085

### 生产环境（Docker）

```bash
# 快速部署
./docker-build.sh && ./docker-run.sh

# 或者使用 docker-compose
docker-compose up -d
```

访问：http://localhost:25086

## 📋 详细说明

### 技术栈

- **前端框架**：Vanilla JavaScript + ES Modules
- **样式系统**：Tailwind CSS v4.1.12 + DaisyUI v5.0.0
- **构建工具**：Vite v5.0.0
- **运行时**：Bun (统一使用)
- **容器化**：Docker + Docker Compose

### 关键特性

- ✅ **零 CDN 依赖**：所有样式和脚本完全本地化
- ✅ **最新技术栈**：使用 Tailwind CSS v4 和 DaisyUI v5
- ✅ **生产就绪**：Docker 容器化部署
- ✅ **开发友好**：热重载和实时更新
- ✅ **响应式设计**：支持移动端和桌面端

### 构建流程

1. **Vite 构建**：
   ```bash
   bun run build           # 生产环境构建
   bun run dev             # 开发环境（热重载）
   bun run preview         # 预览构建结果
   ```

2. **Docker 构建**：
   ```bash
   ./docker-build.sh       # 构建镜像
   ./docker-run.sh         # 启动容器
   docker-compose up -d    # 使用 compose 启动
   ```

### 端口配置

- **开发环境**：25085
- **生产环境**：25086
- **Vite 开发服务器**：5173（内部）

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `NODE_ENV` | `production` | 运行环境 |
| `PORT` | `25086` | 服务端口 |

## 🔧 故障排除

### 样式问题

如果遇到样式显示问题：

1. **重新构建**：
   ```bash
   bun run build
   ```

2. **检查构建文件**：
   确认 `dist/` 目录存在且包含 CSS 和 JS 文件

3. **清除缓存**：
   ```bash
   # 清除 Docker 缓存
   docker system prune -f

   # 重新构建
   ./docker-build.sh && ./docker-run.sh
   ```

### 容器问题

1. **检查容器状态**：
   ```bash
   docker-compose ps
   ```

2. **查看日志**：
   ```bash
   docker-compose logs -f
   ```

3. **重启服务**：
   ```bash
   ./docker-build.sh && ./docker-run.sh
   ```

### 开发环境问题

1. **依赖问题**：
   ```bash
   rm -rf node_modules bun.lock
   bun install
   ```

2. **端口冲突**：
   检查端口 25085 是否被占用

## 📝 更新日志

### v1.0.0 (2025-01-18)

- ✅ 修复 Docker 生产环境样式加载问题
- ✅ 升级到 Tailwind CSS v4 和 DaisyUI v5
- ✅ 实现零 CDN 依赖
- ✅ 优化构建流程和 Docker 配置
- ✅ 添加完整的部署脚本

## 🛠️ 开发指南

### 添加新样式

1. 在 `src/style.css` 中添加自定义样式
2. 如果使用新的 DaisyUI 组件，需要在 `.force-include-daisyui` 类中添加对应的 `@apply` 指令
3. 重新构建：`bun run build`

### 修改主题

在 `src/style.css` 中的 `@plugin "daisyui"` 配置中修改主题列表。

### 调试技巧

1. **开发环境调试**：使用 `bun run dev` 启动开发服务器
2. **样式调试**：Vite 提供热重载，样式变化实时生效
3. **生产环境调试**：使用 `docker-compose logs -f` 查看容器日志

## 📞 支持

如果遇到问题，请检查：

1. Bun 版本 >= 1.0.0
2. Docker 和 Docker Compose 已安装
3. 端口 25085 和 25086 未被占用
4. 网络连接正常（用于下载依赖）
