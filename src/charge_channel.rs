use embassy_embedded_hal::shared_bus::asynch::i2c::I2cDevice;
use embassy_futures::select::{self, select};
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_time::{Duration, Ticker, Timer};
use embedded_hal_async::i2c::I2c;
use esp_hal::{i2c::I2C, peripherals::I2C0, Async};
use ina226::INA226;
use pca9546a::PCA9546A;
use sw3526::SW3526;

use crate::{
    bus::{ChargeChannelStatus, CHARGE_CHANNELS},
    error::ChargeChannelError,
};

pub struct ChargeChannel<I2C> {
    ina226: INA226<I2C>,
    sw3526: SW3526<I2C>,
    pca9546a: PCA9546A<I2C>,
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
        pca9546a: PCA9546A<I2C>,
        charge_channel: &'static ChargeChannelStatus,
    ) -> Self {
        Self {
            ina226,
            sw3526,
            pca9546a,
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
        self.select_mux_channel().await?;

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

    pub async fn task(&mut self) {
        let mut ticker = Ticker::every(Duration::from_secs(1));

        loop {
            ticker.next().await;

            match self.init_ina226().await {
                Ok(_) => {
                    log::info!("INA226 init success");
                }
                Err(err) => {
                    log::error!("INA226 init error. {:?}", err);
                }
            }

            match self.init_sw3526().await {
                Ok(_) => {
                    log::info!("SW3526 init success");
                }
                Err(err) => {
                    log::error!("SW3526 init error. {:?}", err);
                }
            }

            loop {
                ticker.next().await;

                match self.ina226_task_once().await {
                    Ok(_) => {}
                    Err(_) => {
                        log::error!("INA226 task error.");
                    }
                }

                log::warn!("task go");

                let future = select(ticker.next(), self.sw3526_task_once()).await;

                match future {
                    select::Either::First(_) => {
                        log::warn!("sw3526 task time out");
                    }
                    select::Either::Second(result) => match result {
                        Ok(_) => {
                            log::info!("SW3526 task success");
                        }
                        Err(_) => {
                            log::error!("SW3526 task error.");
                        }
                    },
                }

                log::warn!("wait for next task");
            }
        }
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
        self.select_mux_channel().await?;

        log::info!("get protocol");
        match self.sw3526.get_protocol().await {
            Ok(protocol) => {
                log::info!("Protocol: {:?}", protocol);
            }
            Err(err) => {
                log::error!("Failed to get protocol. {:?}", err);
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        match self.sw3526.get_system_status().await {
            Ok(status) => {
                log::info!("Status: {:?}", status);
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        match self.sw3526.get_abnormal_case().await {
            Ok(abnormal_case) => {
                log::info!("Abnormal case: {:?}", abnormal_case);
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        match self.sw3526.get_adc_output_millivolts().await {
            Ok(value) => {
                log::info!("output_millivolts: {}", value);
                self.charge_channel.out_millivolts.send(value).await;
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        match self.sw3526.get_adc_output_milliamps().await {
            Ok(value) => {
                log::info!("output_milliamps: {}", value);
                self.charge_channel.out_milliamps.send(value).await;
            }
            Err(err) => {
                return Err(ChargeChannelError::I2CError(err));
            }
        }

        Ok(())
    }

    async fn select_mux_channel(&mut self) -> Result<(), ChargeChannelError<E>> {
        self.pca9546a
            .set_channel(pca9546a::Channel::Ch0)
            .await
            .map_err(|err| {
                log::error!("Failed to select mux channel. {:?}", err);
                ChargeChannelError::I2CError(err)
            })
    }
}

#[embassy_executor::task]
pub(crate) async fn task(
    ina226_i2c_dev: &'static mut I2cDevice<
        'static,
        CriticalSectionRawMutex,
        I2C<'static, I2C0, Async>,
    >,
    sw3526_i2c_dev: &'static mut I2cDevice<
        'static,
        CriticalSectionRawMutex,
        I2C<'static, I2C0, Async>,
    >,
    pca9546a_i2c_dev: &'static mut I2cDevice<
        'static,
        CriticalSectionRawMutex,
        I2C<'static, I2C0, Async>,
    >,
) {
    let pca9546a_address = 0x70;
    let ina226_address = 0x40;

    let mut pca9546a = PCA9546A::new(pca9546a_i2c_dev, pca9546a_address);
    let ina226 = INA226::new(ina226_i2c_dev, ina226_address);
    let sw3526 = SW3526::new(sw3526_i2c_dev);

    loop {
        match pca9546a.set_channel(pca9546a::Channel::None).await {
            Ok(_) => {
                log::info!("init pca9546a success.");
                break;
            }
            Err(err) => {
                log::error!("init pca9546a error. {:?}", err);
                Timer::after(Duration::from_millis(100)).await;
            }
        }
    }

    let mut charge_channel = ChargeChannel::new(ina226, sw3526, pca9546a, &CHARGE_CHANNELS[0]);

    charge_channel.task().await;
}
