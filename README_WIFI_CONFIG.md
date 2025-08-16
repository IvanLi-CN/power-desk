# WiFi Configuration Tool for Power Desk

This tool allows you to modify WiFi configuration in compiled firmware without recompilation.

## Features

- 🔧 **No Recompilation Required**: Directly modify WiFi configuration in binary firmware files
- 🛡️ **Data Integrity**: Use CRC16 checksum to ensure configuration data integrity
- 🔍 **Smart Location**: Precisely locate configuration structure through magic number
- 🔄 **Development Compatible**: Maintain full compatibility with existing development environment
- 💾 **Automatic Backup**: Automatically create backup files before modification

## How It Works

### Configuration Priority

1. **Environment Variables** (Development Priority)
   - If valid `SSID` and `PASSWORD` are set in `.cargo/config.toml`, they take precedence
   - Suitable for development and debugging phases

2. **Embedded Configuration Structure** (Production Environment)
   - When environment variables are empty or placeholders, read from configuration structure in firmware
   - Suitable for end-user firmware distribution

### Configuration Structure

```rust
#[repr(C, packed)]
struct WifiConfig {
    magic: u32,           // 0x57494649 ("WIFI")
    version: u16,         // Configuration version (currently 1)
    checksum: u16,        // CRC16 checksum
    ssid_len: u8,         // Actual SSID length
    password_len: u8,     // Actual PASSWORD length
    flags: u8,            // Flag bits (reserved)
    reserved: u8,         // Reserved field
    ssid: [u8; 32],       // SSID data
    password: [u8; 64],   // PASSWORD data
}
```

## Usage

### Development Environment

Continue using the existing approach during development, set in `.cargo/config.toml`:

```toml
[env]
SSID="your_development_ssid"
PASSWORD="your_development_password"
```

### Production Environment

#### 1. Build Firmware

```bash
# Clear or use placeholder environment variables
export SSID=""
export PASSWORD=""

# Or set placeholders in .cargo/config.toml
# SSID="your_ssid"
# PASSWORD="your_password"

# Build release version
cargo build --release

# Generated firmware is located at
# target/riscv32imc-unknown-none-elf/release/power-desk
```

#### 2. Configure WiFi Credentials

```bash
# Enter tools directory
cd tools

# Set WiFi configuration
python config_tool.py ../target/riscv32imc-unknown-none-elf/release/power-desk \
    --ssid "MyHomeWiFi" \
    --password "MySecurePassword"
```

#### 3. Verify Configuration

```bash
# Read current configuration
python config_tool.py ../target/riscv32imc-unknown-none-elf/release/power-desk --read

# Verify configuration integrity
python config_tool.py ../target/riscv32imc-unknown-none-elf/release/power-desk --verify
```

#### 4. Flash Firmware

```bash
# Use espflash to flash firmware
espflash flash target/riscv32imc-unknown-none-elf/release/power-desk --monitor
```

## Configuration Tool Options

```bash
# Basic usage
python config_tool.py <firmware_file> --ssid <ssid> --password <password>

# Read current configuration
python config_tool.py <firmware_file> --read

# Verify configuration integrity
python config_tool.py <firmware_file> --verify

# Skip backup file creation
python config_tool.py <firmware_file> --ssid <ssid> --password <password> --no-backup
```

## Limitations

- **Maximum SSID Length**: 32 bytes (UTF-8 encoding)
- **Maximum Password Length**: 64 bytes (UTF-8 encoding)
- **Supported Characters**: UTF-8 character set

## Error Handling

The tool automatically handles the following situations:

- ✅ Configuration structure not found
- ✅ Checksum mismatch
- ✅ SSID/password length exceeded
- ✅ File read/write errors
- ✅ Character encoding errors

## Security Considerations

1. **Backup Important**: Tool automatically creates `.backup` files, please keep them safe
2. **Checksum Verification**: Checksum is recalculated after each modification
3. **Configuration Validation**: Firmware validates configuration integrity at startup
4. **Password Security**: Tool hides password content when displaying

## Troubleshooting

### Configuration Not Found

```
Error: WiFi configuration structure not found in firmware
```

**Solution**: Ensure firmware is compiled with the new configuration system.

### Checksum Error

```
Error: Configuration checksum mismatch!
```

**Solution**: Configuration data may be corrupted, restore using backup file.

### Length Exceeded

```
Error: SSID too long (max 32 bytes)
```
**Solution**: Use shorter SSID or password.

## Developer Information

- **Configuration Structure Size**: 108 bytes
- **Magic Number**: 0x57494649 ("WIFI")
- **Checksum Algorithm**: CRC16 (polynomial 0xA001)
- **Byte Order**: Little Endian

## Example Scripts

Create a batch configuration script:

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

Usage:
```bash
chmod +x batch_config.sh
./batch_config.sh "MyWiFi" "MyPassword"
```
