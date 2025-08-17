#!/usr/bin/env python3
"""
创建测试用的固件文件
包含 WiFi 配置结构，用于测试网页配置工具
"""

import struct
import sys

def calculate_crc16(data):
    """计算 CRC16 校验和"""
    crc = 0xFFFF
    
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
                
    return crc & 0xFFFF

def create_test_firmware():
    """创建包含 WiFi 配置结构的测试固件"""
    
    # 配置参数
    MAGIC = 0x57494649  # "WIFI"
    VERSION = 1
    STRUCT_SIZE = 108
    
    # 默认配置
    ssid = "TestWiFi"
    password = "TestPassword123"
    
    ssid_bytes = ssid.encode('utf-8')
    password_bytes = password.encode('utf-8')
    
    # 创建 SSID 和密码数组（零填充）
    ssid_array = ssid_bytes + b'\x00' * (32 - len(ssid_bytes))
    password_array = password_bytes + b'\x00' * (64 - len(password_bytes))
    
    # 创建结构体（不包括校验和）
    header = struct.pack('<IHHBBBB', 
                       MAGIC, VERSION, 0,  # 校验和稍后计算
                       len(ssid_bytes), len(password_bytes), 0, 0)
    
    config_data = header + ssid_array + password_array
    
    # 计算校验和（排除校验和字段）
    checksum_data = config_data[:6] + config_data[8:]
    checksum = calculate_crc16(checksum_data)
    
    # 更新校验和
    config_data = config_data[:6] + struct.pack('<H', checksum) + config_data[8:]
    
    # 创建完整的测试固件
    # 前面添加一些随机数据，模拟真实固件
    firmware_data = b'\x00' * 1024  # 1KB 的填充数据
    firmware_data += config_data    # WiFi 配置结构
    firmware_data += b'\xFF' * 2048 # 2KB 的填充数据
    
    return firmware_data

def main():
    """主函数"""
    firmware = create_test_firmware()
    
    # 写入文件
    with open('test-firmware.bin', 'wb') as f:
        f.write(firmware)
    
    print(f"测试固件已创建: test-firmware.bin")
    print(f"文件大小: {len(firmware)} 字节")
    print(f"默认 SSID: TestWiFi")
    print(f"默认密码: TestPassword123")
    print()
    print("可以使用此文件测试网页配置工具的功能")

if __name__ == '__main__':
    main()
