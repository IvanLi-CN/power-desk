# Power Desk Config Tool 使用指南

## 🚀 快速开始

### 方法一：使用内置代理服务器（推荐）

1. **安装 Bun**（如果未安装）：
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **启动服务器**：
   ```bash
   cd web-config-tool
   bun run power-desk-server.js
   ```

3. **打开浏览器**访问：http://localhost:3000

### 方法二：使用其他 HTTP 服务器

```bash
# 使用 serve
npm install -g serve
serve web-config-tool -p 3000

# 使用 Python
cd web-config-tool
python -m http.server 3000
```

## ✅ 问题解决

### 原始问题：CORS 跨域错误

**问题现象**：
- 直接双击 `index.html` 打开
- 选择开发分支固件时报错：`Failed to fetch`
- 控制台显示 CORS 错误

**根本原因**：
- 浏览器的 CORS 策略阻止从 `file://` 协议访问 `https://` 资源
- GitHub API 和固件下载都被阻止

**解决方案**：
1. ✅ **使用本地代理服务器**（我们的解决方案）
2. ✅ **部署到 GitHub Pages**
3. ✅ **使用任何 HTTP 服务器**

### 我们的解决方案优势

**🛡️ 安全性**：
- 严格的白名单机制，只允许访问 Power Desk 项目资源
- 防止代理到无关内容，避免安全问题

**💾 性能优化**：
- 智能缓存：API 响应缓存 5-10 分钟
- 固件文件缓存 1 小时
- 减少重复请求，提高响应速度

**🔗 透明代理**：
- 自动检测运行环境
- 本地代理时自动使用代理端点
- GitHub Pages 时直接访问 GitHub

## 🔧 技术细节

### 代理服务器架构

```
前端 (localhost:3000)
    ↓
代理服务器 (Bun)
    ↓
GitHub API/Downloads
```

### 白名单配置

```javascript
// 只允许这些 GitHub API 路径
const GITHUB_API_WHITELIST = [
  '/repos/IvanLi-CN/power-desk/releases',
  '/repos/IvanLi-CN/power-desk/branches'
];

// 只允许这些下载路径
const GITHUB_DOWNLOAD_WHITELIST = [
  '/IvanLi-CN/power-desk/releases/download/'
];
```

### 缓存策略

- **API 响应**：5-10 分钟（根据类型）
- **固件文件**：1 小时
- **内存缓存**：进程重启后清空

## 📊 测试结果

✅ **GitHub API 调用**：成功获取版本列表  
✅ **固件下载**：成功下载 609KB 固件文件  
✅ **缓存机制**：所有请求正确缓存  
✅ **安全白名单**：只允许指定资源访问  
✅ **错误处理**：提供清晰的错误信息  

## 🎯 总结

通过使用 Bun 构建的本地代理服务器，我们完美解决了：

1. **CORS 跨域问题** - 通过本地代理避免浏览器限制
2. **安全性问题** - 严格的白名单机制
3. **性能问题** - 智能缓存减少重复请求
4. **用户体验** - 一键启动，无需复杂配置

现在用户可以正常使用开发分支固件下载功能了！🎉
