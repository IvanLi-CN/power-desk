# WiFi Configuration Tool for Power Desk

这个工具允许你在不重新编译的情况下修改已编译固件中的 WiFi 配置。

## 特性

- 🔧 **无需重编译**：直接修改二进制固件文件中的 WiFi 配置
- 🛡️ **数据完整性**：使用 CRC16 校验和确保配置数据的完整性
- 🔍 **智能定位**：通过幻数精确定位配置结构体
- 🔄 **开发兼容**：保持与现有开发环境的完全兼容性
- 💾 **自动备份**：修改前自动创建备份文件

## 工作原理

### 配置优先级

1. **环境变量**（开发环境优先）
   - 如果 `.cargo/config.toml` 中设置了有效的 `SSID` 和 `PASSWORD`，优先使用
   - 适用于开发和调试阶段

2. **嵌入式配置结构体**（生产环境）
   - 当环境变量为空或为占位符时，从固件中的配置结构体读取
   - 适用于最终用户的固件分发

### 配置结构体

```rust
#[repr(C, packed)]
struct WifiConfig {
    magic: u32,           // 0x57494649 ("WIFI")
    version: u16,         // 配置版本 (当前为 1)
    checksum: u16,        // CRC16 校验和
    ssid_len: u8,         // SSID 实际长度
    password_len: u8,     // PASSWORD 实际长度
    flags: u8,            // 标志位（预留）
    reserved: u8,         // 保留字段
    ssid: [u8; 32],       // SSID 数据
    password: [u8; 64],   // PASSWORD 数据
}
```

## 使用方法

### 开发环境

开发时继续使用现有的方式，在 `.cargo/config.toml` 中设置：

```toml
[env]
SSID="your_development_ssid"
PASSWORD="your_development_password"
```

### 生产环境

#### 1. 构建固件

```bash
# 清空或使用占位符环境变量
export SSID=""
export PASSWORD=""

# 或者在 .cargo/config.toml 中设置占位符
# SSID="your_ssid"
# PASSWORD="your_password"

# 构建发布版本
cargo build --release

# 生成的固件位于
# target/riscv32imc-unknown-none-elf/release/power-desk
```

#### 2. 配置 WiFi 凭据

```bash
# 进入工具目录
cd tools

# 设置 WiFi 配置
python config_tool.py ../target/riscv32imc-unknown-none-elf/release/power-desk \
    --ssid "MyHomeWiFi" \
    --password "MySecurePassword"
```

#### 3. 验证配置

```bash
# 读取当前配置
python config_tool.py ../target/riscv32imc-unknown-none-elf/release/power-desk --read

# 验证配置完整性
python config_tool.py ../target/riscv32imc-unknown-none-elf/release/power-desk --verify
```

#### 4. 刷写固件

```bash
# 使用 espflash 刷写固件
espflash flash target/riscv32imc-unknown-none-elf/release/power-desk --monitor
```

## 配置工具选项

```bash
# 基本用法
python config_tool.py <firmware_file> --ssid <ssid> --password <password>

# 读取当前配置
python config_tool.py <firmware_file> --read

# 验证配置完整性
python config_tool.py <firmware_file> --verify

# 跳过备份文件创建
python config_tool.py <firmware_file> --ssid <ssid> --password <password> --no-backup
```

## 限制

- **SSID 最大长度**：32 字节（UTF-8 编码）
- **密码最大长度**：64 字节（UTF-8 编码）
- **支持的字符**：UTF-8 字符集

## 错误处理

工具会自动处理以下情况：

- ✅ 配置结构体未找到
- ✅ 校验和不匹配
- ✅ SSID/密码长度超限
- ✅ 文件读写错误
- ✅ 字符编码错误

## 安全注意事项

1. **备份重要**：工具会自动创建 `.backup` 文件，请妥善保存
2. **校验和验证**：每次修改后都会重新计算校验和
3. **配置验证**：固件启动时会验证配置的完整性
4. **密码安全**：工具在显示时会隐藏密码内容

## 故障排除

### 配置未找到
```
Error: WiFi configuration structure not found in firmware
```
**解决方案**：确保固件是使用新的配置系统编译的。

### 校验和错误
```
Error: Configuration checksum mismatch!
```
**解决方案**：配置数据可能已损坏，使用备份文件恢复。

### 长度超限
```
Error: SSID too long (max 32 bytes)
```
**解决方案**：使用更短的 SSID 或密码。

## 开发者信息

- **配置结构体大小**：108 字节
- **幻数**：0x57494649 ("WIFI")
- **校验算法**：CRC16 (polynomial 0xA001)
- **字节序**：小端序 (Little Endian)

## 示例脚本

创建一个批量配置脚本：

```bash
#!/bin/bash
# batch_config.sh

FIRMWARE="target/riscv32imc-unknown-none-elf/release/power-desk"
SSID="$1"
PASSWORD="$2"

if [ -z "$SSID" ] || [ -z "$PASSWORD" ]; then
    echo "Usage: $0 <SSID> <PASSWORD>"
    exit 1
fi

echo "Configuring firmware with SSID: $SSID"
python tools/config_tool.py "$FIRMWARE" --ssid "$SSID" --password "$PASSWORD"

echo "Verifying configuration..."
python tools/config_tool.py "$FIRMWARE" --verify

echo "Ready to flash!"
```

使用方法：
```bash
chmod +x batch_config.sh
./batch_config.sh "MyWiFi" "MyPassword"
```
