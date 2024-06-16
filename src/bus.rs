use core::fmt::Display;

use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NetDataTrafficSpeed {
    pub up: u32,
    pub down: u32,
}

impl Default for NetDataTrafficSpeed {
    fn default() -> Self {
        Self { up: 0, down: 0 }
    }
}

impl Display for NetDataTrafficSpeed {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "up: {}B, down: {}B", self.up, self.down)
    }
}

#[derive(Debug, Clone, Copy)]
pub enum WiFiConnectStatus {
    Connecting,
    Connected,
    Failed,
}

impl Display for WiFiConnectStatus {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:?}", self)
    }
}

pub static WIFI_CONNECT_STATUS: Mutex<CriticalSectionRawMutex, WiFiConnectStatus> =
    Mutex::new(WiFiConnectStatus::Connecting);

