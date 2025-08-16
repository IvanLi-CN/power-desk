#!/usr/bin/env python3
"""
WiFi Configuration Tool for Power Desk Firmware

This tool allows you to modify WiFi credentials in compiled firmware binaries
without recompiling the source code.

Usage:
    python config_tool.py firmware.bin --ssid "MyWiFi" --password "MyPassword"
    python config_tool.py firmware.bin --read  # Read current configuration
    python config_tool.py firmware.bin --verify  # Verify configuration integrity
"""

import argparse
import struct
import sys
import os
from typing import Optional, Tuple


class WifiConfigTool:
    # Configuration structure constants
    MAGIC = 0x57494649  # "WIFI" in little-endian
    VERSION = 1
    STRUCT_SIZE = 108  # 4+2+2+1+1+1+1+32+64
    
    def __init__(self, firmware_path: str):
        self.firmware_path = firmware_path
        self.config_offset: Optional[int] = None
        
    def find_config_offset(self, data: bytes) -> int:
        """Find the WiFi configuration structure in firmware data"""
        magic_bytes = struct.pack('<I', self.MAGIC)
        offset = data.find(magic_bytes)
        
        if offset == -1:
            raise ValueError("WiFi configuration structure not found in firmware")
            
        # Verify we have enough space for the full structure
        if offset + self.STRUCT_SIZE > len(data):
            raise ValueError("Incomplete WiFi configuration structure found")
            
        return offset
    
    def calculate_crc16(self, data: bytes) -> int:
        """Calculate CRC16 checksum (same algorithm as in Rust code)"""
        crc = 0xFFFF
        
        for byte in data:
            crc ^= byte
            for _ in range(8):
                if crc & 1:
                    crc = (crc >> 1) ^ 0xA001
                else:
                    crc >>= 1
                    
        return crc & 0xFFFF
    
    def parse_config(self, data: bytes, offset: int) -> dict:
        """Parse WiFi configuration from binary data"""
        # Unpack the structure
        magic, version, checksum, ssid_len, password_len, flags, reserved = \
            struct.unpack('<IHHBBBB', data[offset:offset+12])
        
        # Verify magic and version
        if magic != self.MAGIC:
            raise ValueError(f"Invalid magic number: 0x{magic:08x}")
        if version != self.VERSION:
            raise ValueError(f"Unsupported version: {version}")
            
        # Extract SSID and password
        ssid_data = data[offset+12:offset+44]
        password_data = data[offset+44:offset+108]
        
        # Validate lengths
        if ssid_len > 32 or password_len > 64:
            raise ValueError("Invalid SSID or password length")
            
        # Extract actual strings
        ssid = ssid_data[:ssid_len].decode('utf-8', errors='replace')
        password = password_data[:password_len].decode('utf-8', errors='replace')
        
        # Calculate expected checksum (exclude checksum field itself)
        config_data = data[offset:offset+6] + data[offset+8:offset+self.STRUCT_SIZE]
        expected_checksum = self.calculate_crc16(config_data)
        
        return {
            'magic': magic,
            'version': version,
            'checksum': checksum,
            'expected_checksum': expected_checksum,
            'ssid_len': ssid_len,
            'password_len': password_len,
            'flags': flags,
            'reserved': reserved,
            'ssid': ssid,
            'password': password,
            'valid': checksum == expected_checksum
        }
    
    def create_config_data(self, ssid: str, password: str) -> bytes:
        """Create new configuration data"""
        # Validate input
        ssid_bytes = ssid.encode('utf-8')
        password_bytes = password.encode('utf-8')
        
        if len(ssid_bytes) > 32:
            raise ValueError("SSID too long (max 32 bytes)")
        if len(password_bytes) > 64:
            raise ValueError("Password too long (max 64 bytes)")
            
        # Create SSID and password arrays (zero-padded)
        ssid_array = ssid_bytes + b'\x00' * (32 - len(ssid_bytes))
        password_array = password_bytes + b'\x00' * (64 - len(password_bytes))
        
        # Create structure without checksum
        header = struct.pack('<IHHBBBB', 
                           self.MAGIC, self.VERSION, 0,  # checksum will be calculated
                           len(ssid_bytes), len(password_bytes), 0, 0)
        
        config_data = header + ssid_array + password_array
        
        # Calculate checksum (exclude checksum field at offset 6-7)
        checksum_data = config_data[:6] + config_data[8:]
        checksum = self.calculate_crc16(checksum_data)
        
        # Update checksum in the data
        config_data = config_data[:6] + struct.pack('<H', checksum) + config_data[8:]
        
        return config_data
    
    def read_config(self) -> dict:
        """Read current WiFi configuration from firmware"""
        with open(self.firmware_path, 'rb') as f:
            data = f.read()
            
        offset = self.find_config_offset(data)
        self.config_offset = offset
        
        return self.parse_config(data, offset)
    
    def write_config(self, ssid: str, password: str, backup: bool = True) -> None:
        """Write new WiFi configuration to firmware"""
        # Create backup if requested
        if backup:
            backup_path = self.firmware_path + '.backup'
            if not os.path.exists(backup_path):
                with open(self.firmware_path, 'rb') as src, open(backup_path, 'wb') as dst:
                    dst.write(src.read())
                print(f"Backup created: {backup_path}")
        
        # Read current firmware
        with open(self.firmware_path, 'rb') as f:
            data = bytearray(f.read())
            
        # Find configuration offset
        offset = self.find_config_offset(data)
        
        # Create new configuration
        new_config = self.create_config_data(ssid, password)
        
        # Replace configuration in firmware
        data[offset:offset+self.STRUCT_SIZE] = new_config
        
        # Write updated firmware
        with open(self.firmware_path, 'wb') as f:
            f.write(data)
            
        print(f"WiFi configuration updated successfully")
        print(f"SSID: {ssid}")
        print(f"Password: {'*' * len(password)}")


def main():
    parser = argparse.ArgumentParser(description='WiFi Configuration Tool for Power Desk Firmware')
    parser.add_argument('firmware', help='Path to firmware binary file')
    parser.add_argument('--ssid', help='WiFi SSID to set')
    parser.add_argument('--password', help='WiFi password to set')
    parser.add_argument('--read', action='store_true', help='Read current configuration')
    parser.add_argument('--verify', action='store_true', help='Verify configuration integrity')
    parser.add_argument('--no-backup', action='store_true', help='Skip creating backup file')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.firmware):
        print(f"Error: Firmware file '{args.firmware}' not found")
        sys.exit(1)
    
    tool = WifiConfigTool(args.firmware)
    
    try:
        if args.read or args.verify:
            config = tool.read_config()
            print(f"WiFi Configuration:")
            print(f"  Magic: 0x{config['magic']:08x}")
            print(f"  Version: {config['version']}")
            print(f"  SSID: '{config['ssid']}'")
            print(f"  Password: {'*' * len(config['password'])}")
            print(f"  Checksum: 0x{config['checksum']:04x} (expected: 0x{config['expected_checksum']:04x})")
            print(f"  Valid: {config['valid']}")
            
            if args.verify:
                if config['valid']:
                    print("✓ Configuration is valid")
                else:
                    print("✗ Configuration checksum mismatch!")
                    sys.exit(1)
                    
        elif args.ssid and args.password:
            tool.write_config(args.ssid, args.password, not args.no_backup)
            
        else:
            parser.print_help()
            
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
