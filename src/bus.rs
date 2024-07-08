use core::fmt::Display;

use embassy_sync::{
    blocking_mutex::raw::{CriticalSectionRawMutex, NoopRawMutex},
    channel::Channel,
    mutex::Mutex,
};

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

pub(crate) static TEMPERATURE_CH: Channel<CriticalSectionRawMutex, f32, 10> = Channel::new();

pub(crate) static CHARGE_CHANNELS: [ChargeChannelStatus; 4] = [
    ChargeChannelStatus::new(),
    ChargeChannelStatus::new(),
    ChargeChannelStatus::new(),
    ChargeChannelStatus::new(),
];

pub(crate) struct ChargeChannelStatus {
    pub amps: Channel<CriticalSectionRawMutex, f64, 10>,
    pub watts: Channel<CriticalSectionRawMutex, f64, 10>,
    pub millivolts: Channel<CriticalSectionRawMutex, f64, 10>,
}

impl ChargeChannelStatus {
    const fn new() -> Self {
        Self {
            amps: Channel::new(),
            watts: Channel::new(),
            millivolts: Channel::new(),
        }
    }
}
