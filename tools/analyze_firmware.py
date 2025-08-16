#!/usr/bin/env python3
"""
Firmware Analysis Tool for Power Desk
Analyzes the compiled firmware to verify the WiFi configuration structure.
"""

import struct
import sys
import os

def analyze_firmware(firmware_path):
    """Analyze firmware and display configuration structure details"""
    
    if not os.path.exists(firmware_path):
        print(f"Error: Firmware file '{firmware_path}' not found")
        return False
    
    with open(firmware_path, 'rb') as f:
        data = f.read()
    
    print(f"📁 Firmware file: {firmware_path}")
    print(f"📊 File size: {len(data):,} bytes ({len(data)/1024:.1f} KB)")
    print()
    
    # 查找幻数
    magic_bytes = b'\x49\x46\x49\x57'  # 'WIFI' in little-endian
    offset = data.find(magic_bytes)
    
    if offset == -1:
        print("❌ WiFi configuration structure not found!")
        return False
    
    print(f"✅ Configuration found at offset: 0x{offset:08x} ({offset:,} bytes)")
    print()
    
    # 解析配置结构体
    config_data = data[offset:offset+108]
    if len(config_data) < 108:
        print("❌ Incomplete configuration structure!")
        return False
    
    # 解包结构体头部
    magic, version, checksum, ssid_len, password_len, flags, reserved = \
        struct.unpack('<IHHBBBB', config_data[:12])
    
    print("📋 Configuration Structure Analysis:")
    print(f"   Magic Number: 0x{magic:08x} ({'✅ Valid' if magic == 0x57494649 else '❌ Invalid'})")
    print(f"   Version: {version}")
    print(f"   Checksum: 0x{checksum:04x}")
    print(f"   SSID Length: {ssid_len} bytes")
    print(f"   Password Length: {password_len} bytes")
    print(f"   Flags: 0x{flags:02x}")
    print(f"   Reserved: 0x{reserved:02x}")
    print()
    
    # 提取 SSID 和密码
    ssid_data = config_data[12:44]
    password_data = config_data[44:108]
    
    try:
        ssid = ssid_data[:ssid_len].decode('utf-8') if ssid_len > 0 else ""
        password = password_data[:password_len].decode('utf-8') if password_len > 0 else ""
        
        print("📶 WiFi Credentials:")
        print(f"   SSID: '{ssid}' ({len(ssid)} chars)")
        print(f"   Password: {'*' * len(password)} ({len(password)} chars)")
        print()
        
    except UnicodeDecodeError as e:
        print(f"❌ Error decoding credentials: {e}")
        return False
    
    # 验证校验和
    checksum_data = config_data[:6] + config_data[8:]
    crc = 0xFFFF
    for byte in checksum_data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    crc &= 0xFFFF
    
    checksum_valid = (crc == checksum)
    print("🔍 Integrity Check:")
    print(f"   Stored Checksum: 0x{checksum:04x}")
    print(f"   Calculated Checksum: 0x{crc:04x}")
    print(f"   Status: {'✅ Valid' if checksum_valid else '❌ Invalid'}")
    print()
    
    # 显示原始十六进制数据
    print("🔢 Raw Configuration Data (first 64 bytes):")
    for i in range(0, min(64, len(config_data)), 16):
        hex_part = ' '.join(f'{b:02x}' for b in config_data[i:i+16])
        ascii_part = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in config_data[i:i+16])
        print(f"   {offset+i:08x}: {hex_part:<48} |{ascii_part}|")
    
    if len(config_data) > 64:
        print("   ... (truncated)")
    print()
    
    # 检查是否有多个配置结构体
    next_offset = data.find(magic_bytes, offset + 1)
    if next_offset != -1:
        print(f"⚠️  Warning: Found additional configuration at offset 0x{next_offset:08x}")
        print("   This might indicate duplicate structures in the firmware.")
        print()
    
    return checksum_valid

def main():
    if len(sys.argv) != 2:
        print("Usage: python3 analyze_firmware.py <firmware_file>")
        print()
        print("Examples:")
        print("  python3 analyze_firmware.py target/riscv32imc-unknown-none-elf/release/power-desk")
        print("  python3 analyze_firmware.py firmware.bin")
        sys.exit(1)
    
    firmware_path = sys.argv[1]
    
    print("🔬 Power Desk Firmware Analysis Tool")
    print("=" * 50)
    print()
    
    success = analyze_firmware(firmware_path)
    
    if success:
        print("🎉 Analysis completed successfully!")
        sys.exit(0)
    else:
        print("💥 Analysis failed - configuration issues detected!")
        sys.exit(1)

if __name__ == '__main__':
    main()
