use core::str;

/// WiFi配置结构体，使用幻数定位
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct WifiConfig {
    pub magic: u32,         // 0x57494649 ("WIFI" in little-endian)
    pub version: u16,       // 配置版本，当前为 1
    pub checksum: u16,      // CRC16 校验和（不包括这个字段本身）
    pub ssid_len: u8,       // SSID 实际长度 (0-32)
    pub password_len: u8,   // PASSWORD 实际长度 (0-64)
    pub flags: u8,          // 标志位（预留）
    pub reserved: u8,       // 保留字段，确保对齐
    pub ssid: [u8; 32],     // SSID 数据，未使用部分填充0
    pub password: [u8; 64], // PASSWORD 数据，未使用部分填充0
}

impl WifiConfig {
    pub const MAGIC: u32 = 0x57494649; // "WIFI"
    pub const VERSION: u16 = 1;
    pub const SIZE: usize = core::mem::size_of::<WifiConfig>();

    /// 创建新的配置
    pub const fn new() -> Self {
        Self {
            magic: Self::MAGIC,
            version: Self::VERSION,
            checksum: 0,
            ssid_len: 0,
            password_len: 0,
            flags: 0,
            reserved: 0,
            ssid: [0; 32],
            password: [0; 64],
        }
    }

    /// 设置SSID
    #[allow(dead_code)]
    pub fn set_ssid(&mut self, ssid: &str) -> Result<(), &'static str> {
        let bytes = ssid.as_bytes();
        if bytes.len() > 32 {
            return Err("SSID too long (max 32 bytes)");
        }

        self.ssid.fill(0);
        self.ssid[..bytes.len()].copy_from_slice(bytes);
        self.ssid_len = bytes.len() as u8;
        Ok(())
    }

    /// 设置密码
    #[allow(dead_code)]
    pub fn set_password(&mut self, password: &str) -> Result<(), &'static str> {
        let bytes = password.as_bytes();
        if bytes.len() > 64 {
            return Err("Password too long (max 64 bytes)");
        }

        self.password.fill(0);
        self.password[..bytes.len()].copy_from_slice(bytes);
        self.password_len = bytes.len() as u8;
        Ok(())
    }

    /// 获取SSID字符串
    pub fn get_ssid(&self) -> Result<&str, str::Utf8Error> {
        let len = self.ssid_len as usize;
        if len > 32 {
            return Err(core::str::from_utf8(&[]).unwrap_err());
        }
        str::from_utf8(&self.ssid[..len])
    }

    /// 获取密码字符串
    pub fn get_password(&self) -> Result<&str, str::Utf8Error> {
        let len = self.password_len as usize;
        if len > 64 {
            return Err(core::str::from_utf8(&[]).unwrap_err());
        }
        str::from_utf8(&self.password[..len])
    }

    /// 验证配置是否有效
    pub fn is_valid(&self) -> bool {
        self.magic == Self::MAGIC
            && self.version == Self::VERSION
            && self.ssid_len <= 32
            && self.password_len <= 64
            && self.verify_checksum()
    }

    /// 计算CRC16校验和
    pub fn calculate_checksum(&self) -> u16 {
        let mut crc: u16 = 0xFFFF;

        // 计算除checksum字段外的所有数据
        let data = unsafe {
            let ptr = self as *const Self as *const u8;
            core::slice::from_raw_parts(ptr, Self::SIZE)
        };

        // 跳过checksum字段（偏移6-7）
        for (i, &byte) in data.iter().enumerate() {
            if i == 6 || i == 7 {
                continue;
            } // 跳过checksum字段

            crc ^= byte as u16;
            for _ in 0..8 {
                if crc & 1 != 0 {
                    crc = (crc >> 1) ^ 0xA001;
                } else {
                    crc >>= 1;
                }
            }
        }

        crc
    }

    /// 更新校验和
    #[allow(dead_code)]
    pub fn update_checksum(&mut self) {
        self.checksum = self.calculate_checksum();
    }

    /// 验证校验和
    pub fn verify_checksum(&self) -> bool {
        self.checksum == self.calculate_checksum()
    }
}

/// 默认的WiFi配置实例，使用#[used]确保不被优化器移除
#[used]
#[no_mangle]
static mut WIFI_CONFIG_INSTANCE: WifiConfig = WifiConfig::new();

/// 获取WiFi配置
#[allow(static_mut_refs)]
pub fn get_wifi_config() -> (Option<&'static str>, Option<&'static str>) {
    // 优先使用环境变量（开发环境）
    if let (Some(ssid), Some(password)) = (option_env!("SSID"), option_env!("PASSWORD")) {
        // 检查是否为占位符或空值
        if !ssid.is_empty()
            && ssid != "your_ssid"
            && !password.is_empty()
            && password != "your_password"
        {
            return (Some(ssid), Some(password));
        }
    }

    // 从配置结构体读取
    unsafe {
        if WIFI_CONFIG_INSTANCE.is_valid() {
            let ssid = WIFI_CONFIG_INSTANCE.get_ssid().ok();
            let password = WIFI_CONFIG_INSTANCE.get_password().ok();

            // 确保配置不为空
            if let (Some(s), Some(p)) = (ssid, password) {
                if !s.is_empty() && !p.is_empty() {
                    return (Some(s), Some(p));
                }
            }
        }
    }

    (None, None)
}

/// 初始化配置（可选，用于运行时设置）
#[allow(dead_code, static_mut_refs)]
pub fn init_wifi_config(ssid: &str, password: &str) -> Result<(), &'static str> {
    unsafe {
        WIFI_CONFIG_INSTANCE.set_ssid(ssid)?;
        WIFI_CONFIG_INSTANCE.set_password(password)?;
        WIFI_CONFIG_INSTANCE.update_checksum();
        Ok(())
    }
}
