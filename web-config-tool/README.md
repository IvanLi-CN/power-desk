# Power Desk 固件配置工具 - 网页版

这是一个纯前端的 Power Desk 固件配置工具，可以在浏览器中直接修改固件的 WiFi 配置，无需安装任何软件或搭建服务器环境。

## 功能特点

- 🌐 **纯前端实现**：无需服务器，直接在浏览器中运行
- 🔧 **简单易用**：拖拽上传固件，填写配置，一键下载
- 🎨 **美观界面**：使用 DaisyUI + Tailwind CSS 构建的现代化界面
- 📱 **响应式设计**：支持桌面和移动设备
- 🔒 **安全可靠**：所有处理都在本地完成，不会上传任何数据
- 📖 **详细说明**：集成完整的硬件连接和烧录指南

## 使用方法

### 1. 打开工具
直接在浏览器中打开 `index.html` 文件，或部署到任何静态网站托管服务。

### 2. 选择固件版本（可选）
- 可以选择 Release 版本或开发分支
- 工具会自动从 GitHub 获取可用版本列表
- 也可以直接上传自己编译的固件文件

### 3. 配置 WiFi 参数
- 输入 WiFi 名称（SSID）：最大 32 字节
- 输入 WiFi 密码：最大 64 字节
- 工具会实时显示字节数统计

### 4. 上传固件文件
- 拖拽 `.bin` 固件文件到上传区域
- 或点击"选择文件"按钮选择文件
- 工具会自动检测和显示当前配置

### 5. 应用配置
- 点击"应用配置"按钮
- 工具会在固件中查找配置结构并更新
- 自动计算和验证 CRC16 校验和

### 6. 下载配置后的固件
- 点击"下载固件"按钮
- 获得配置好的 `power-desk-configured.bin` 文件

## 硬件连接和烧录

### 硬件连接
烧录固件前，请按以下步骤连接硬件：

1. **断开所有电源**
2. **连接 DC 供电**（5V-12V）
3. **连接 USB 数据线：**
   - D+ → USB D+
   - D- → USB D-
   - GND → USB GND
   - ⚠️ 注意：硬件上没有 VBUS 引脚
4. **进入下载模式：**
   - 按住 BOOT 按钮
   - 短按 RESET 按钮
   - 松开 BOOT 按钮

### 烧录命令

1. **安装 espflash（如果未安装）：**
   ```bash
   cargo install espflash
   ```

2. **烧录固件：**
   ```bash
   espflash flash power-desk-configured.bin --monitor
   ```

3. **指定端口（可选）：**
   ```bash
   espflash flash power-desk-configured.bin --port /dev/ttyUSB0 --monitor
   ```

## 技术实现

### 核心功能
- **二进制文件处理**：使用 JavaScript 的 ArrayBuffer 和 DataView API
- **CRC16 校验**：实现与 Python 版本相同的校验算法
- **配置结构解析**：精确解析 108 字节的配置结构体
- **文件操作**：支持拖拽上传和下载功能

### 配置结构
```c
struct WifiConfig {
    uint32_t magic;           // 0x57494649 ("WIFI")
    uint16_t version;         // 配置版本 (当前为 1)
    uint16_t checksum;        // CRC16 校验和
    uint8_t ssid_len;         // SSID 实际长度
    uint8_t password_len;     // 密码实际长度
    uint8_t flags;            // 标志位 (保留)
    uint8_t reserved;         // 保留字段
    uint8_t ssid[32];         // SSID 数据
    uint8_t password[64];     // 密码数据
}
```

### 兼容性
- 与现有的 `config_tool.py` 完全兼容
- 生成的固件可以正常烧录和运行
- 支持所有现代浏览器（Chrome、Firefox、Safari、Edge）

## 部署方式

### 🐳 推荐：Docker 部署（生产级）

**使用 Docker 容器化部署，支持一键启动，生产环境首选：**

```bash
# 方法一：使用构建脚本（推荐）
cd web-config-tool
./docker-build.sh
./docker-run.sh

# 方法二：使用 docker-compose
docker-compose up -d

# 访问 http://localhost:25080
```

**Docker 特性：**

- 🐳 **容器化部署**：一键构建和运行，环境隔离
- 🛡️ **生产级安全**：非 root 用户运行，健康检查
- 📦 **轻量镜像**：340MB 优化镜像，多阶段构建
- 🔄 **易于扩展**：支持 docker-compose 编排
- 📚 **完整文档**：详见 [DOCKER.md](./DOCKER.md)

### 🚀 本地开发：Bun 服务器

**使用内置的 Bun 服务器进行本地开发：**

```bash
# 1. 确保已安装 Bun (https://bun.sh/)
curl -fsSL https://bun.sh/install | bash

# 2. 启动服务器
cd web-config-tool
bun run power-desk-server.js
# 或者使用启动脚本
./start-server.sh

# 3. 访问 http://localhost:25080
```

**服务器特性：**

- 🛡️ **安全白名单**：只允许访问 Power Desk 项目的 GitHub 资源
- 💾 **智能缓存**：API 响应缓存 5-10 分钟，固件文件缓存 1 小时
- 🔗 **代理功能**：自动代理 GitHub API 和下载请求，避免 CORS 问题
- ⚡ **高性能**：基于 Bun 运行时，启动快速，内存占用低

### 🌐 GitHub Pages（在线访问）

适合不想安装本地服务器的用户：

1. Fork 或 Clone 本项目到你的 GitHub 仓库
2. 在仓库设置中启用 GitHub Pages
3. 选择 `main` 分支的 `/web-config-tool` 目录作为源
4. 访问 `https://你的用户名.github.io/仓库名/web-config-tool/`

### 📦 其他本地服务器选项

如果不想使用 Bun，也可以使用其他 HTTP 服务器：

```bash
# 使用 serve
npm install -g serve
serve web-config-tool -p 3000

# 使用 Python
cd web-config-tool
python -m http.server 3000

# 使用 Node.js http-server
npm install -g http-server
cd web-config-tool
http-server -p 3000
```

**注意**：直接双击 `index.html` 会遇到 CORS 问题，必须使用 HTTP 服务器。

### 🌍 其他静态网站托管

可以部署到以下平台：

- Netlify
- Vercel
- 任何支持静态文件的 Web 服务器

### 📱 离线使用

除了获取 GitHub 版本信息外，所有功能都支持离线使用。

## 故障排除

### 常见问题

**Q: 上传文件后提示"WiFi 配置结构未在固件中找到"**
A: 这可能是因为：
- 固件文件不是 Power Desk 项目的固件
- 固件是用旧版本编译的，不包含配置结构
- 文件损坏或格式不正确

**Q: 配置应用后校验失败**
A: 请检查：
- SSID 和密码长度是否超出限制
- 输入的字符是否包含特殊字符
- 尝试重新上传固件文件

**Q: 下载的固件无法烧录**
A: 请确认：
- 硬件连接正确
- 设备已进入下载模式
- espflash 工具已正确安装

## 开发说明

### 文件结构
```
web-config-tool/
├── index.html          # 主页面
├── config-tool.js      # 核心 JavaScript 功能
└── README.md          # 说明文档
```

### 核心类
- `WifiConfigTool`: 主要的配置处理类
- 包含固件解析、配置更新、校验等功能

### 主要函数
- `findConfigOffset()`: 查找配置结构位置
- `calculateCRC16()`: 计算 CRC16 校验和
- `parseConfig()`: 解析配置结构
- `createConfigData()`: 创建新配置数据
- `updateFirmware()`: 更新固件配置

## 许可证

本项目遵循与 Power Desk 主项目相同的许可证。

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个工具！
