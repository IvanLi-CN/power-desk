# GitHub Token 配置说明

## 🔑 为什么需要 GitHub Token？

GitHub API 对未认证请求有严格的限制：
- **未认证请求**：每小时 60 次（基于 IP 地址）
- **认证请求**：每小时 5,000 次（基于用户账户）

当您频繁使用 Power Desk 配置工具时，可能会遇到 API 限制错误。配置 GitHub Token 可以大幅提高请求限制。

## 🛠️ 如何创建 GitHub Token

### 步骤1：访问 GitHub 设置
1. 登录 GitHub
2. 点击右上角头像 → **Settings**
3. 左侧菜单 → **Developer settings**
4. 点击 **Personal access tokens** → **Tokens (classic)**

### 步骤2：创建新 Token
1. 点击 **Generate new token** → **Generate new token (classic)**
2. 填写 **Note**：`Power Desk Config Tool`
3. 选择 **Expiration**：建议选择 `90 days` 或 `No expiration`
4. **权限选择**：
   - ✅ **public_repo**（访问公共仓库）
   - 或者不选择任何权限（仅用于提高 API 限制）
5. 点击 **Generate token**
6. **重要**：复制生成的 Token（只显示一次）

## 🔧 如何配置 Token

### 方法1：环境变量（推荐）
```bash
# 开发环境
GITHUB_TOKEN=your_token_here bun run dev:server

# 生产环境
GITHUB_TOKEN=your_token_here bun run start
```

### 方法2：创建 .env 文件
```bash
# 复制示例文件
cp .env.example .env

# 编辑 .env 文件
echo "GITHUB_TOKEN=your_token_here" >> .env
```

然后正常启动服务器：
```bash
# 开发环境
bun run dev:server

# 生产环境
bun run start
```

## ✅ 验证配置

启动服务器后，查看日志中的 Token 状态：
- `🔑 GitHub Token: ✅ 已配置` - Token 配置成功
- `🔑 GitHub Token: ❌ 未配置（使用免费配额）` - 未配置 Token

## 🔒 安全注意事项

1. **不要提交 Token 到代码仓库**
2. **定期更新 Token**
3. **只给必要的权限**
4. **如果 Token 泄露，立即删除并重新生成**

## 🚨 故障排除

### Token 无效
- 检查 Token 是否正确复制
- 确认 Token 没有过期
- 验证 Token 权限设置

### 仍然遇到限制
- 确认 Token 配置正确
- 检查是否使用了正确的环境变量名 `GITHUB_TOKEN`
- 重启服务器以应用新配置
