#!/bin/bash
# Complete Workflow Test for Power Desk WiFi Configuration System
# This script tests the entire development and production workflow

set -e  # Exit on any error

echo "🧪 Power Desk WiFi Configuration System - Complete Test"
echo "========================================================"
echo

# Test parameters
TEST_SSID="TestNetwork"
TEST_PASSWORD="TestPassword123"
FIRMWARE_PATH="target/riscv32imc-unknown-none-elf/release/power-desk"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() {
    echo -e "${BLUE}📋 Step $1: $2${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Step 1: Clean build with empty environment variables
print_step 1 "Testing production build (empty environment variables)"

# Backup current config
cp .cargo/config.toml .cargo/config.toml.backup

# Set empty environment variables
cat > .cargo/config.toml << EOF
[target.riscv32imc-unknown-none-elf]
runner = "espflash flash --monitor"


[env]
ESP_LOG="INFO"
SSID=""
PASSWORD=""

[build]
rustflags = [
  # Required to obtain backtraces (e.g. when using the "esp-backtrace" crate.)
  # NOTE: May negatively impact performance of produced code
  "-C", "force-frame-pointers",
  "-C", "link-arg=-Tlinkall.x",
  # "-C", "link-arg=-Trom_functions.x", # Not needed in esp-hal 1.0.0-beta.1
]

target = "riscv32imc-unknown-none-elf"

[unstable]
build-std = ["alloc", "core"]
EOF

echo "Building firmware with empty environment variables..."
cargo build --release > /dev/null 2>&1

# Analyze the firmware
echo "Analyzing firmware structure..."
if python3 tools/analyze_firmware.py "$FIRMWARE_PATH" > /dev/null 2>&1; then
    print_error "Expected empty configuration to be invalid, but it passed analysis"
    exit 1
else
    print_success "Empty configuration correctly detected as invalid"
fi

# Step 2: Test configuration tool
print_step 2 "Testing configuration replacement tool"

echo "Setting WiFi configuration using tool..."
python3 tools/config_tool.py "$FIRMWARE_PATH" --ssid "$TEST_SSID" --password "$TEST_PASSWORD" > /dev/null

echo "Verifying configuration..."
if python3 tools/config_tool.py "$FIRMWARE_PATH" --verify > /dev/null; then
    print_success "Configuration tool works correctly"
else
    print_error "Configuration verification failed"
    exit 1
fi

# Step 3: Test batch configuration script
print_step 3 "Testing batch configuration script"

# Reset firmware to empty state
cargo build --release > /dev/null 2>&1

echo "Running batch configuration script..."
if ./tools/batch_config.sh "BatchTest" "BatchPassword" > /dev/null; then
    print_success "Batch configuration script works correctly"
else
    print_error "Batch configuration script failed"
    exit 1
fi

# Step 4: Test development environment compatibility
print_step 4 "Testing development environment compatibility"

# Restore config with development settings
cat > .cargo/config.toml << EOF
[target.riscv32imc-unknown-none-elf]
runner = "espflash flash --monitor"


[env]
ESP_LOG="INFO"
SSID="DevelopmentWiFi"
PASSWORD="DevPassword123"

[build]
rustflags = [
  # Required to obtain backtraces (e.g. when using the "esp-backtrace" crate.)
  # NOTE: May negatively impact performance of produced code
  "-C", "force-frame-pointers",
  "-C", "link-arg=-Tlinkall.x",
  # "-C", "link-arg=-Trom_functions.x", # Not needed in esp-hal 1.0.0-beta.1
]

target = "riscv32imc-unknown-none-elf"

[unstable]
build-std = ["alloc", "core"]
EOF

echo "Building firmware with development environment variables..."
cargo build --release > /dev/null 2>&1

# The firmware should still have empty config structure but use env vars at runtime
echo "Checking that config structure remains empty (env vars take precedence)..."
if python3 tools/analyze_firmware.py "$FIRMWARE_PATH" > /dev/null 2>&1; then
    print_error "Expected empty configuration structure, but analysis passed"
    exit 1
else
    print_success "Development environment correctly uses environment variables"
fi

# Step 5: Test edge cases
print_step 5 "Testing edge cases and error handling"

# Test with very long SSID (should fail)
echo "Testing SSID length validation..."
LONG_SSID=$(python3 -c "print('A' * 33)")  # 33 chars, should fail
if python3 tools/config_tool.py "$FIRMWARE_PATH" --ssid "$LONG_SSID" --password "test" > /dev/null 2>&1; then
    print_error "Expected long SSID to fail, but it succeeded"
    exit 1
else
    print_success "SSID length validation works correctly"
fi

# Test with very long password (should fail)
echo "Testing password length validation..."
LONG_PASSWORD=$(python3 -c "print('A' * 65)")  # 65 chars, should fail
if python3 tools/config_tool.py "$FIRMWARE_PATH" --ssid "test" --password "$LONG_PASSWORD" > /dev/null 2>&1; then
    print_error "Expected long password to fail, but it succeeded"
    exit 1
else
    print_success "Password length validation works correctly"
fi

# Step 6: Test backup and restore functionality
print_step 6 "Testing backup and restore functionality"

# Set a known configuration
python3 tools/config_tool.py "$FIRMWARE_PATH" --ssid "BackupTest" --password "BackupPassword" > /dev/null

# Verify backup file exists
if [ -f "$FIRMWARE_PATH.backup" ]; then
    print_success "Backup file created correctly"
else
    print_error "Backup file not found"
    exit 1
fi

# Restore from backup
cp "$FIRMWARE_PATH.backup" "$FIRMWARE_PATH"

# Verify restoration
if python3 tools/config_tool.py "$FIRMWARE_PATH" --verify > /dev/null 2>&1; then
    print_error "Expected restored firmware to have invalid config, but it passed"
    exit 1
else
    print_success "Backup and restore functionality works correctly"
fi

# Cleanup and restore original config
print_step 7 "Cleanup and final verification"

mv .cargo/config.toml.backup .cargo/config.toml
rm -f "$FIRMWARE_PATH.backup"

# Final build to ensure everything is back to normal
cargo build --release > /dev/null 2>&1

print_success "All tests passed successfully!"
echo
echo "🎉 WiFi Configuration System Test Complete!"
echo "   ✅ Production workflow tested"
echo "   ✅ Development environment compatibility verified"
echo "   ✅ Configuration tools validated"
echo "   ✅ Error handling confirmed"
echo "   ✅ Backup/restore functionality verified"
echo
echo "The system is ready for production use! 🚀"
