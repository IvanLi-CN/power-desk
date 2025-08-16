#!/bin/bash
# WiFi Configuration Batch Script for Power Desk
# Usage: ./batch_config.sh <SSID> <PASSWORD> [firmware_path]

set -e  # Exit on any error

# Default firmware path
DEFAULT_FIRMWARE="target/riscv32imc-unknown-none-elf/release/power-desk"

# Check arguments
if [ $# -lt 2 ]; then
    echo "Usage: $0 <SSID> <PASSWORD> [firmware_path]"
    echo ""
    echo "Examples:"
    echo "  $0 \"MyWiFi\" \"MyPassword\""
    echo "  $0 \"MyWiFi\" \"MyPassword\" custom_firmware.bin"
    exit 1
fi

SSID="$1"
PASSWORD="$2"
FIRMWARE="${3:-$DEFAULT_FIRMWARE}"

# Check if firmware file exists
if [ ! -f "$FIRMWARE" ]; then
    echo "Error: Firmware file '$FIRMWARE' not found!"
    echo "Please build the firmware first with: cargo build --release"
    exit 1
fi

# Check if config tool exists
if [ ! -f "tools/config_tool.py" ]; then
    echo "Error: config_tool.py not found in tools/ directory"
    exit 1
fi

echo "🔧 Configuring Power Desk firmware..."
echo "📁 Firmware: $FIRMWARE"
echo "📶 SSID: $SSID"
echo "🔐 Password: $(echo "$PASSWORD" | sed 's/./*/g')"
echo ""

# Configure WiFi
echo "⚙️  Setting WiFi configuration..."
python tools/config_tool.py "$FIRMWARE" --ssid "$SSID" --password "$PASSWORD"

echo ""
echo "✅ Verifying configuration..."
python tools/config_tool.py "$FIRMWARE" --verify

echo ""
echo "🎉 Configuration complete!"
echo ""
echo "Next steps:"
echo "1. Flash the firmware: espflash flash $FIRMWARE --monitor"
echo "2. Or copy the firmware to your target device"
echo ""
echo "💾 Backup file created: $FIRMWARE.backup"
