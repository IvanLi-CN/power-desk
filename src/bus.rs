use core::fmt::Display;

use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, channel::Channel, mutex::Mutex};
use sw3526::{AbnormalCaseResponse, ProtocolIndicationResponse, SystemStatusResponse};

use crate::protector::VinState;

#[derive(Debug, Clone, Copy)]
pub enum WiFiConnectStatus {
    Connecting,
    Connected,
}

impl Display for WiFiConnectStatus {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:?}", self)
    }
}

pub static WIFI_CONNECT_STATUS: Mutex<CriticalSectionRawMutex, WiFiConnectStatus> =
    Mutex::new(WiFiConnectStatus::Connecting);

#[derive(Debug, Clone, Copy)]
pub(crate) struct ProtectorSeriesItem {
    pub temperature_0: f32,
    pub temperature_1: f32,
    pub millivolts: f64,
    pub amps: f64,
    pub watts: f64,
    pub vin_status: VinState,
}

impl ProtectorSeriesItem {
    const BYTE_SIZE: usize = size_of::<f32>() * 2 + size_of::<f64>() * 3 + size_of::<u8>();
    pub fn to_bytes(&self) -> [u8; Self::BYTE_SIZE] {
        let mut buffer = [0u8; Self::BYTE_SIZE];
        let mut offset = 0;

        fn copy_into_slice(buffer: &mut [u8], offset: &mut usize, bytes: &[u8]) {
            let end = *offset + bytes.len();
            buffer[*offset..end].copy_from_slice(bytes);
            *offset = end;
        }

        copy_into_slice(&mut buffer, &mut offset, &self.temperature_0.to_le_bytes());
        copy_into_slice(&mut buffer, &mut offset, &self.temperature_1.to_le_bytes());
        copy_into_slice(&mut buffer, &mut offset, &self.millivolts.to_le_bytes());
        copy_into_slice(&mut buffer, &mut offset, &self.amps.to_le_bytes());
        copy_into_slice(&mut buffer, &mut offset, &self.watts.to_le_bytes());
        copy_into_slice(
            &mut buffer,
            &mut offset,
            &(self.vin_status as u8).to_le_bytes(),
        );
        buffer
    }
}

impl Default for ProtectorSeriesItem {
    fn default() -> Self {
        Self {
            temperature_0: 0.0,
            temperature_1: 0.0,
            millivolts: 0.0,
            amps: 0.0,
            watts: 0.0,
            vin_status: VinState::Normal,
        }
    }
}

pub(crate) type ProtectorSeriesItemChannel =
    Channel<CriticalSectionRawMutex, ProtectorSeriesItem, 10>;

pub(crate) static PROTECTOR_SERIES_ITEM_CHANNEL: ProtectorSeriesItemChannel = Channel::new();

#[derive(Debug, Clone, Copy)]
pub(crate) struct ChargeChannelSeriesItem {
    pub millivolts: f64,
    pub amps: f64,
    pub watts: f64,
    pub protocol: ProtocolIndicationResponse,
    pub system_status: SystemStatusResponse,
    pub abnormal_case: AbnormalCaseResponse,
    pub buck_output_millivolts: u16,
    pub buck_output_limit_milliamps: u16,
    pub limit_watts: u8,
}

impl ChargeChannelSeriesItem {
    const BYTE_SIZE: usize = size_of::<f64>() * 3
        + size_of::<ProtocolIndicationResponse>()
        + size_of::<SystemStatusResponse>()
        + size_of::<AbnormalCaseResponse>()
        + size_of::<u16>() * 2
        + size_of::<u8>();

    pub fn to_bytes(&self) -> [u8; Self::BYTE_SIZE] {
        let mut buffer = [0u8; Self::BYTE_SIZE];
        let mut offset = 0;

        // Helper function to copy bytes into the buffer
        fn copy_into_slice(buffer: &mut [u8], offset: &mut usize, bytes: &[u8]) {
            let end = *offset + bytes.len();
            buffer[*offset..end].copy_from_slice(bytes);
            *offset = end;
        }

        copy_into_slice(&mut buffer, &mut offset, &self.millivolts.to_le_bytes());
        copy_into_slice(&mut buffer, &mut offset, &self.amps.to_le_bytes());
        copy_into_slice(&mut buffer, &mut offset, &self.watts.to_le_bytes());

        let protocol: u8 = self.protocol.into();
        let system_status: u8 = self.system_status.into();
        let abnormal_case: u8 = self.abnormal_case.into();
        copy_into_slice(&mut buffer, &mut offset, &protocol.to_le_bytes());
        copy_into_slice(&mut buffer, &mut offset, &system_status.to_le_bytes());
        copy_into_slice(&mut buffer, &mut offset, &abnormal_case.to_le_bytes());

        copy_into_slice(
            &mut buffer,
            &mut offset,
            &self.buck_output_millivolts.to_le_bytes(),
        );
        copy_into_slice(
            &mut buffer,
            &mut offset,
            &self.buck_output_limit_milliamps.to_le_bytes(),
        );

        copy_into_slice(&mut buffer, &mut offset, &self.limit_watts.to_le_bytes());

        buffer
    }
}

impl Default for ChargeChannelSeriesItem {
    fn default() -> Self {
        Self {
            millivolts: 0.0,
            amps: 0.0,
            watts: 0.0,
            protocol: 0.into(),
            system_status: 0.into(),
            abnormal_case: 0.into(),
            buck_output_millivolts: 0,
            buck_output_limit_milliamps: 0,
            limit_watts: 0,
        }
    }
}

pub(crate) type ChargeChannelSeriesItemChannel =
    Channel<CriticalSectionRawMutex, ChargeChannelSeriesItem, 10>;

pub(crate) static CHARGE_CHANNEL_SERIES_ITEM_CHANNELS: [ChargeChannelSeriesItemChannel; 4] = [
    Channel::new(),
    Channel::new(),
    Channel::new(),
    Channel::new(),
];

pub(crate) static VIN_STATUS_CFG_CHANNEL: Channel<CriticalSectionRawMutex, VinState, 1> = Channel::new();