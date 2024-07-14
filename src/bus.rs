use core::fmt::Display;

use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, channel::Channel, mutex::Mutex};
use sw3526::{AbnormalCaseResponse, ProtocolIndicationResponse, SystemStatusResponse};

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
    pub millivolts: Channel<CriticalSectionRawMutex, f64, 10>,
    pub amps: Channel<CriticalSectionRawMutex, f64, 10>,
    pub watts: Channel<CriticalSectionRawMutex, f64, 10>,
    pub in_millivolts: Channel<CriticalSectionRawMutex, u16, 10>,
    pub protocol: Channel<CriticalSectionRawMutex, ProtocolIndicationResponse, 4>,
    pub system_status: Channel<CriticalSectionRawMutex, SystemStatusResponse, 4>,
    pub abnormal_case: Channel<CriticalSectionRawMutex, AbnormalCaseResponse, 4>,
    pub buck_output_millivolts: Channel<CriticalSectionRawMutex, u16, 4>,
    pub buck_output_limit_milliamps: Channel<CriticalSectionRawMutex, u16, 4>,
    pub limit_watts: Channel<CriticalSectionRawMutex, u8, 4>,
}

impl ChargeChannelStatus {
    const fn new() -> Self {
        Self {
            amps: Channel::new(),
            watts: Channel::new(),
            millivolts: Channel::new(),
            in_millivolts: Channel::new(),
            protocol: Channel::new(),
            system_status: Channel::new(),
            abnormal_case: Channel::new(),
            buck_output_millivolts: Channel::new(),
            buck_output_limit_milliamps: Channel::new(),
            limit_watts: Channel::new(),
        }
    }
}
