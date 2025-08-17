use core::ops::{BitAnd, BitAndAssign, BitOr, BitOrAssign, BitXor, BitXorAssign, Not};
use embassy_embedded_hal::shared_bus::asynch::i2c::I2cDevice;
use embassy_futures::select::{self, select};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};
use embassy_time::{Duration, Ticker};
use embedded_hal_async::i2c::{I2c, SevenBitAddress};
// Removed unused imports: peripherals::I2C0, Async
use ina226::INA226;
use pca9546a::PCA9546A;
use sw3526::{FastChargeConfig1, SW3526};

use crate::{
    bus::{
        ChargeChannelSeriesItem, ChargeChannelSeriesItemChannel,
        CHARGE_CHANNEL_SERIES_ITEM_CHANNELS,
    },
    error::ChargeChannelError,
    i2c_mux::{ChargeChannelIndex, I2cMux},
    watchdog::{feed_watchdog, WatchedTask},
};

const PCA9546A_ADDRESS_0: SevenBitAddress = 0x70;
const PCA9546A_ADDRESS_1: SevenBitAddress = 0x71;

const INA226_0: SevenBitAddress = 0x44;
const INA226_1: SevenBitAddress = 0x41;
const INA226_2: SevenBitAddress = 0x45;
const INA226_3: SevenBitAddress = 0x40;

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum ChargeChannelOnlineStatus {
    Online = 3,
    INA226Online = 1,
    SW3526Online = 2,
    Offline = 0,
}

impl ChargeChannelOnlineStatus {
    pub fn from_u8(value: u8) -> Self {
        match value {
            3 => ChargeChannelOnlineStatus::Online,
            1 => ChargeChannelOnlineStatus::INA226Online,
            2 => ChargeChannelOnlineStatus::SW3526Online,
            _ => ChargeChannelOnlineStatus::Offline,
        }
    }
}

impl BitAnd for ChargeChannelOnlineStatus {
    type Output = Self;

    fn bitand(self, rhs: Self) -> Self::Output {
        Self::from_u8(self as u8 & rhs as u8)
    }
}

impl BitOr for ChargeChannelOnlineStatus {
    type Output = Self;

    fn bitor(self, rhs: Self) -> Self::Output {
        Self::from_u8(self as u8 | rhs as u8)
    }
}

impl BitXor for ChargeChannelOnlineStatus {
    type Output = Self;

    fn bitxor(self, rhs: Self) -> Self::Output {
        Self::from_u8(self as u8 ^ rhs as u8)
    }
}

impl Not for ChargeChannelOnlineStatus {
    type Output = Self;

    fn not(self) -> Self::Output {
        Self::from_u8(!(self as u8))
    }
}

impl BitAndAssign for ChargeChannelOnlineStatus {
    fn bitand_assign(&mut self, rhs: Self) {
        *self = *self & rhs;
    }
}

impl BitOrAssign for ChargeChannelOnlineStatus {
    fn bitor_assign(&mut self, rhs: Self) {
        *self = *self | rhs;
    }
}

impl BitXorAssign for ChargeChannelOnlineStatus {
    fn bitxor_assign(&mut self, rhs: Self) {
        *self = *self ^ rhs;
    }
}

pub struct ChargeChannel<I2C> {
    ina226: INA226<I2C>,
    sw3526: SW3526<I2C>,
    charge_channel: &'static ChargeChannelSeriesItemChannel,
    online_status: ChargeChannelOnlineStatus,
    current_channel_state: ChargeChannelSeriesItem,
}

impl<I2C, E> ChargeChannel<I2C>
where
    I2C: I2c<Error = E> + 'static,
    E: embedded_hal_async::i2c::Error + 'static,
{
    pub fn new(
        ina226: INA226<I2C>,
        sw3526: SW3526<I2C>,
        charge_channel: &'static ChargeChannelSeriesItemChannel,
    ) -> Self {
        Self {
            ina226,
            sw3526,
            charge_channel,
            online_status: ChargeChannelOnlineStatus::Offline,
            current_channel_state: ChargeChannelSeriesItem::default(),
        }
    }

    async fn config_ina226(&mut self) -> Result<(), ChargeChannelError<E>> {
        let config = ina226::Config {
            mode: ina226::MODE::ShuntBusVoltageContinuous,
            avg: ina226::AVG::_4,
            vbusct: ina226::VBUSCT::_588us,
            vshct: ina226::VSHCT::_588us,
        };

        self.ina226
            .set_configuration(&config)
            .await
            .map_err(|err| ChargeChannelError::I2CError(err))?;
        self.ina226
            .callibrate(0.01, 5.0)
            .await
            .map_err(|err| ChargeChannelError::I2CError(err))?;

        Ok(())
    }

    async fn init_ina226(&mut self) -> Result<(), ChargeChannelError<E>> {
        match self.ina226.die_id().await {
            Ok(_) => {
                self.online_status |= ChargeChannelOnlineStatus::INA226Online;

                self.config_ina226().await?;
            }
            Err(_) => self.online_status &= !ChargeChannelOnlineStatus::INA226Online,
        }

        Ok(())
    }

    async fn init_sw3526(&mut self) -> Result<(), ChargeChannelError<E>> {
        match self.sw3526.get_chip_version().await {
            Ok(value) => {
                self.online_status |= ChargeChannelOnlineStatus::SW3526Online;
                log::info!("sw3526 Chip version: {}", value);

                self.sw3526
                    .set_i2c_writable()
                    .await
                    .map_err(|err| ChargeChannelError::I2CError(err))?;

                self.sw3526
                    .set_fast_charge_config_1(FastChargeConfig1 {
                        pps1_disabled: false,
                        pps0_disabled: false,
                        pd_20v_disabled: false,
                        pd_15v_disabled: false,
                        pd_12v_disabled: false,
                        pd_9v_disabled: false,
                        pd_disabled: false,
                    })
                    .await
                    .map_err(|err| ChargeChannelError::I2CError(err))?;

                self.sw3526
                    .set_output_limit_watts(65)
                    .await
                    .map_err(|err| ChargeChannelError::I2CError(err))?;
            }
            Err(_) => {
                self.online_status &= !ChargeChannelOnlineStatus::SW3526Online;
            }
        };

        Ok(())
    }

    pub async fn init(&mut self) -> Result<(), ChargeChannelError<E>> {
        match self.init_sw3526().await {
            Ok(_) => {
                log::info!("SW3526 init success");
            }
            Err(err) => {
                log::error!("SW3526 init error. {:?}", err);
                return Err(err);
            }
        }

        match self.init_ina226().await {
            Ok(_) => {
                log::info!("INA226 init success");
            }
            Err(err) => {
                log::error!("INA226 init error. {:?}", err);
                return Err(err);
            }
        }

        Ok(())
    }

    pub async fn task_once(&mut self) -> Result<(), ChargeChannelError<E>> {
        if self.online_status != ChargeChannelOnlineStatus::Online {
            return Ok(());
        }

        let mut timeout = Ticker::every(Duration::from_secs(1));

        match self.ina226_task_once().await {
            Ok(_) => {}
            Err(err) => {
                log::error!("INA226 task error.");
                return Err(err);
            }
        }

        let future = select(timeout.next(), self.sw3526_task_once()).await;

        match future {
            select::Either::First(_) => {
                log::warn!("sw3526 task time out");
            }
            select::Either::Second(result) => match result {
                Ok(_) => {
                    log::info!("SW3526 task success");
                    self.charge_channel.send(self.current_channel_state).await;
                }
                Err(err) => {
                    log::error!("SW3526 task error.");
                    return Err(err);
                }
            },
        }

        Ok(())
    }

    pub async fn ina226_task_once(&mut self) -> Result<(), ChargeChannelError<E>> {
        match self.ina226.bus_voltage_millivolts().await {
            Ok(value) => {
                // log::info!("Bus voltage: {}", value);
                self.current_channel_state.millivolts = value;
            }
            Err(err) => return Err(ChargeChannelError::I2CError(err)),
        };

        // match self.ina226.shunt_voltage_microvolts().await {
        //     Ok(value) => {
        //         // log::info!("Shunt voltage: {}", value);
        //     }
        //     Err(err) => return Err(ChargeChannelError::I2CError(err)),
        // };

        match self.ina226.current_amps().await {
            Ok(value) => {
                // log::info!("Current: {:?}", value);
                if let Some(value) = value {
                    self.current_channel_state.amps = value;
                }
            }
            Err(err) => return Err(ChargeChannelError::I2CError(err)),
        };

        match self.ina226.power_watts().await {
            Ok(value) => {
                // log::info!("Power: {:?}", value);
                if let Some(value) = value {
                    self.current_channel_state.watts = value;
                }
            }
            Err(err) => return Err(ChargeChannelError::I2CError(err)),
        };

        Ok(())
    }

    pub async fn sw3526_task_once(&mut self) -> Result<(), ChargeChannelError<E>> {
        self.report_sw3526_limits().await?;
        self.report_sw3526_status().await?;

        Ok(())
    }

    async fn report_sw3526_status(&mut self) -> Result<(), ChargeChannelError<E>> {
        match self.sw3526.get_protocol().await {
            Ok(protocol) => {
                // log::info!("Protocol: {:?}", protocol);
                self.current_channel_state.protocol = protocol;
            }
            Err(err) => {
                // log::error!("Failed to get protocol. {:?}", err);
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        match self.sw3526.get_system_status().await {
            Ok(status) => {
                // log::info!("Status: {:?}", status);
                self.current_channel_state.system_status = status;
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        match self.sw3526.get_abnormal_case().await {
            Ok(abnormal_case) => {
                // log::info!("Abnormal case: {:?}", abnormal_case,);
                self.current_channel_state.abnormal_case = abnormal_case;
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        match self.sw3526.get_buck_output_limit_milliamps().await {
            Ok(milliamps) => {
                // log::info!("Buck output limit: {}", milliamps);
                self.current_channel_state.buck_output_limit_milliamps = milliamps;
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        Ok(())
    }

    async fn report_sw3526_limits(&mut self) -> Result<(), ChargeChannelError<E>> {
        match self.sw3526.get_limit_watts().await {
            Ok(watts) => {
                // log::info!("Limit: {}", watts);
                self.current_channel_state.limit_watts = watts;
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        // match self.sw3526.get_adc_input_millivolts().await {
        //     Ok(millivolts) => {
        //         log::info!("ADC input: {}", millivolts);
        //         self.charge_channel.in_millivolts.send(millivolts).await;
        //     }
        //     Err(err) => {
        //         return Err(ChargeChannelError::I2CError(err));
        //     }
        // }

        match self.sw3526.get_buck_output_millivolts().await {
            Ok(millivolts) => {
                // log::info!("Buck output: {}", millivolts,);
                self.current_channel_state.buck_output_millivolts = millivolts;
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        Ok(())
    }
}

macro_rules! create_channel {
    ($i2c_mutex:expr, $ina226_addr:expr, $charge_channel:expr) => {{
        let ina226_i2c_dev = I2cDevice::new($i2c_mutex);
        let sw3526_i2c_dev = I2cDevice::new($i2c_mutex);

        let ina226 = INA226::new(ina226_i2c_dev, $ina226_addr);
        let sw3526 = SW3526::new(sw3526_i2c_dev);

        ChargeChannel::new(ina226, sw3526, $charge_channel)
    }};
}

macro_rules! init_charge_channel {
    ($mux:expr, $channel:expr, $charge_channel:expr) => {{
        if $mux.get_channel_available($channel) {
            match $mux.set_channel($channel).await {
                Ok(_) => {}
                Err(err) => {
                    log::error!("set channel#{} error. {:?}", $channel as u8, err);
                    continue;
                }
            }
            match $charge_channel.init().await {
                Ok(_) => {
                    log::info!("init charge channel#{} success.", $channel as u8);
                }
                Err(err) => {
                    log::error!("init charge channel#{} error. {:?}", $channel as u8, err);
                    continue;
                }
            };
        }
    }};
}

macro_rules! do_channel_task {
    ($mux:expr, $channel:expr, $charge_channel:expr, $task_name:ident) => {{
        match $mux.set_channel($channel).await {
            Ok(_) => {}
            Err(err) => {
                log::error!("set channel#{} error. {:?}", $channel as u8, err);
                continue;
            }
        }
        match $charge_channel.$task_name().await {
            Ok(_) => {}
            Err(err) => {
                log::error!(
                    concat!(stringify!($task_name), " channel#{} error. {:?}"),
                    $channel as u8,
                    err
                );
            }
        }
    }};
}

#[embassy_executor::task]
pub(crate) async fn task(
    i2c_mutex: &'static Mutex<
        CriticalSectionRawMutex,
        esp_hal::i2c::master::I2c<'static, esp_hal::Async>,
    >,
) {
    let pca9546a_i2c_dev = I2cDevice::new(i2c_mutex);
    let mux_chip_0: PCA9546A<
        I2cDevice<CriticalSectionRawMutex, esp_hal::i2c::master::I2c<'_, esp_hal::Async>>,
    > = PCA9546A::new(pca9546a_i2c_dev, PCA9546A_ADDRESS_0);
    let pca9546a_i2c_dev = I2cDevice::new(i2c_mutex);
    let mux_chip_1 = PCA9546A::new(pca9546a_i2c_dev, PCA9546A_ADDRESS_1);

    let mut mux = I2cMux::new(mux_chip_0, mux_chip_1);

    let mut charge_channel_0 =
        create_channel!(i2c_mutex, INA226_0, &CHARGE_CHANNEL_SERIES_ITEM_CHANNELS[0]);
    let mut charge_channel_1 =
        create_channel!(i2c_mutex, INA226_1, &CHARGE_CHANNEL_SERIES_ITEM_CHANNELS[1]);
    let mut charge_channel_2 =
        create_channel!(i2c_mutex, INA226_2, &CHARGE_CHANNEL_SERIES_ITEM_CHANNELS[2]);
    let mut charge_channel_3 =
        create_channel!(i2c_mutex, INA226_3, &CHARGE_CHANNEL_SERIES_ITEM_CHANNELS[3]);

    let mut ticker = Ticker::every(Duration::from_secs(1));

    loop {
        ticker.next().await;

        log::info!("init charge channel...");

        mux.init().await;

        init_charge_channel!(mux, ChargeChannelIndex::Ch0, &mut charge_channel_0);
        init_charge_channel!(mux, ChargeChannelIndex::Ch1, &mut charge_channel_1);
        init_charge_channel!(mux, ChargeChannelIndex::Ch2, &mut charge_channel_2);
        init_charge_channel!(mux, ChargeChannelIndex::Ch3, &mut charge_channel_3);

        log::info!("loop charge channels task...");

        loop {
            ticker.next().await;

            // 喂看门狗
            feed_watchdog(WatchedTask::ChargeChannel).await;

            do_channel_task!(
                mux,
                ChargeChannelIndex::Ch0,
                &mut charge_channel_0,
                task_once
            );
            do_channel_task!(
                mux,
                ChargeChannelIndex::Ch1,
                &mut charge_channel_1,
                task_once
            );
            do_channel_task!(
                mux,
                ChargeChannelIndex::Ch2,
                &mut charge_channel_2,
                task_once
            );
            do_channel_task!(
                mux,
                ChargeChannelIndex::Ch3,
                &mut charge_channel_3,
                task_once
            );
        }
    }
}
