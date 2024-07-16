use embassy_embedded_hal::shared_bus::asynch::i2c::I2cDevice;
use embassy_futures::select::{self, select};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};
use embassy_time::{Duration, Ticker, Timer};
use embedded_hal_async::i2c::{I2c, SevenBitAddress};
use esp_hal::{peripherals::I2C0, Async};
use ina226::INA226;
use pca9546a::PCA9546A;
use sw3526::SW3526;

use crate::{
    bus::{ChargeChannelStatus, CHARGE_CHANNELS},
    error::ChargeChannelError,
    i2c_mux::{ChargeChannelIndex, I2cMux},
};

const PCA9546A_ADDRESS_0: SevenBitAddress = 0x70;
const PCA9546A_ADDRESS_1: SevenBitAddress = 0x71;

const INA226_0: SevenBitAddress = 0x40;
const INA226_3: SevenBitAddress = 0x41;

pub struct ChargeChannel<I2C> {
    ina226: INA226<I2C>,
    sw3526: SW3526<I2C>,
    charge_channel: &'static ChargeChannelStatus,
}

impl<I2C, E> ChargeChannel<I2C>
where
    I2C: I2c<Error = E> + 'static,
    E: embedded_hal_async::i2c::Error + 'static,
{
    pub fn new(
        ina226: INA226<I2C>,
        sw3526: SW3526<I2C>,
        charge_channel: &'static ChargeChannelStatus,
    ) -> Self {
        Self {
            ina226,
            sw3526,
            charge_channel,
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
        self.config_ina226().await?;
        Ok(())
    }

    async fn init_sw3526(&mut self) -> Result<(), ChargeChannelError<E>> {
        match self.sw3526.get_chip_version().await {
            Ok(value) => {
                log::info!("sw3526 Chip version: {}", value);
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
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
                log::info!("Bus voltage: {}", value);
                self.charge_channel.millivolts.send(value).await;
            }
            Err(err) => return Err(ChargeChannelError::I2CError(err)),
        };

        match self.ina226.shunt_voltage_microvolts().await {
            Ok(value) => {
                log::info!("Shunt voltage: {}", value);
            }
            Err(err) => return Err(ChargeChannelError::I2CError(err)),
        };

        match self.ina226.current_amps().await {
            Ok(value) => {
                log::info!("Current: {:?}", value);
                if let Some(value) = value {
                    self.charge_channel.amps.send(-value).await; // Negative current
                }
            }
            Err(err) => return Err(ChargeChannelError::I2CError(err)),
        };

        match self.ina226.power_watts().await {
            Ok(value) => {
                log::info!("Power: {:?}", value);
                if let Some(value) = value {
                    self.charge_channel.watts.send(value).await;
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
                log::info!("Protocol: {:?}", protocol);
                self.charge_channel.protocol.send(protocol).await;
            }
            Err(err) => {
                log::error!("Failed to get protocol. {:?}", err);
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        match self.sw3526.get_system_status().await {
            Ok(status) => {
                log::info!("Status: {:?}", status);
                self.charge_channel.system_status.send(status).await;
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        match self.sw3526.get_abnormal_case().await {
            Ok(abnormal_case) => {
                log::info!("Abnormal case: {:?}", abnormal_case,);
                self.charge_channel.abnormal_case.send(abnormal_case).await;
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        match self.sw3526.get_buck_output_limit_milliamps().await {
            Ok(milliamps) => {
                log::info!("Buck output limit: {}", milliamps);
                self.charge_channel
                    .buck_output_limit_milliamps
                    .send(milliamps)
                    .await;
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
                log::info!("Limit: {}", watts);
                self.charge_channel.limit_watts.send(watts).await;
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
                log::info!("Buck output: {}", millivolts,);
                self.charge_channel
                    .buck_output_millivolts
                    .send(millivolts)
                    .await;
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        Ok(())
    }
}

#[embassy_executor::task]
pub(crate) async fn task(
    i2c_mutex: &'static Mutex<CriticalSectionRawMutex, esp_hal::i2c::I2C<'static, I2C0, Async>>,
) {
    let ina226_i2c_dev = I2cDevice::new(i2c_mutex);
    let sw3526_i2c_dev = I2cDevice::new(i2c_mutex);

    let pca9546a_i2c_dev = I2cDevice::new(i2c_mutex);
    let mux_chip_0: PCA9546A<
        I2cDevice<CriticalSectionRawMutex, esp_hal::i2c::I2C<'_, I2C0, Async>>,
    > = PCA9546A::new(pca9546a_i2c_dev, PCA9546A_ADDRESS_0);
    let pca9546a_i2c_dev = I2cDevice::new(i2c_mutex);
    let mux_chip_1 = PCA9546A::new(pca9546a_i2c_dev, PCA9546A_ADDRESS_1);

    let mut mux = I2cMux::new(mux_chip_0, mux_chip_1);

    let ina226 = INA226::new(ina226_i2c_dev, INA226_0);
    let sw3526 = SW3526::new(sw3526_i2c_dev);

    let mut charge_channel_0 = ChargeChannel::new(ina226, sw3526, &CHARGE_CHANNELS[0]);

    let ina226_i2c_dev = I2cDevice::new(i2c_mutex);
    let sw3526_i2c_dev = I2cDevice::new(i2c_mutex);

    let ina226 = INA226::new(ina226_i2c_dev, INA226_3);
    let sw3526 = SW3526::new(sw3526_i2c_dev);

    let mut charge_channel_3 = ChargeChannel::new(ina226, sw3526, &CHARGE_CHANNELS[3]);

    let mut ticker = Ticker::every(Duration::from_secs(1));

    loop {
        ticker.next().await;

        match mux.set_channel(ChargeChannelIndex::Ch0).await {
            Ok(_) => {}
            Err(err) => {
                log::error!("set channel#0 error. {:?}", err);
                continue;
            }
        }
        match charge_channel_0.init().await {
            Ok(_) => {
                log::info!("init charge channel#0 success.");
            }
            Err(err) => {
                log::error!("init charge channel#0 error. {:?}", err);
                continue;
            }
        };

        match mux.set_channel(ChargeChannelIndex::Ch3).await {
            Ok(_) => {}
            Err(err) => {
                log::error!("set channel#3 error. {:?}", err);
                continue;
            }
        }
        match charge_channel_3.init().await {
            Ok(_) => {
                log::info!("init charge channel#3 success.");
            }
            Err(err) => {
                log::error!("init charge channel#3 error. {:?}", err);
                continue;
            }
        }

        loop {
            ticker.next().await;

            match mux.set_channel(ChargeChannelIndex::Ch0).await {
                Ok(_) => {}
                Err(err) => {
                    log::error!("set channel#0 error. {:?}", err);
                    continue;
                }
            }
            match charge_channel_0.task_once().await {
                Ok(_) => {}
                Err(err) => {
                    log::error!("charge channel#0 task error. {:?}", err);
                }
            }

            match mux.set_channel(ChargeChannelIndex::Ch3).await {
                Ok(_) => {}
                Err(err) => {
                    log::error!("set channel#3 error. {:?}", err);
                    continue;
                }
            }
            match charge_channel_3.task_once().await {
                Ok(_) => {}
                Err(err) => {
                    log::error!("charge channel#3 task error. {:?}", err);
                }
            }
        }
    }
}
