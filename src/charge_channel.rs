use embassy_embedded_hal::shared_bus::asynch::i2c::I2cDevice;
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, channel::Channel};
use embassy_time::{Duration, Ticker};
use embedded_hal_async::i2c::I2c;
use esp_hal::{i2c::I2C, peripherals::I2C0, Async};
use ina226::INA226;

use crate::bus::{ChargeChannelStatus, CHARGE_CHANNELS};

pub struct ChargeChannel<I2C> {
    mux_address: u8,
    ina226_address: u8,
    ina226: INA226<I2C>,
    charge_channel: &'static ChargeChannelStatus,
}

impl<I2C, E> ChargeChannel<I2C>
where
    I2C: I2c<Error = E>,
{
    pub fn new(
        mux_address: u8,
        ina226_address: u8,
        i2c: I2C,
        charge_channel: &'static ChargeChannelStatus,
    ) -> Self {
        Self {
            mux_address,
            ina226_address,
            ina226: INA226::new(i2c, ina226_address),
            charge_channel,
        }
    }

    pub async fn config_ina226(&mut self) -> Result<(), E> {
        let config = ina226::Config {
            mode: ina226::MODE::ShuntBusVoltageContinuous,
            avg: ina226::AVG::_4,
            vbusct: ina226::VBUSCT::_588us,
            vshct: ina226::VSHCT::_588us,
        };

        self.ina226.set_configuration(&config).await?;
        self.ina226.callibrate(0.01, 5.0).await?;

        Ok(())
    }

    pub async fn task(&mut self) {
        let mut ticker = Ticker::every(Duration::from_secs(5));

        loop {
            ticker.next().await;

            match self.config_ina226().await {
                Ok(_) => {}
                Err(_) => {
                    log::error!("INA226 config error.");
                }
            }

            match self.ina226_task_once().await {
                Ok(_) => {}
                Err(_) => {
                    log::error!("INA226 task error.");
                }
            }
        }
    }

    pub async fn ina226_task_once(&mut self) -> Result<(), E> {
        match self.ina226.bus_voltage_millivolts().await {
            Ok(value) => {
                log::info!("Bus voltage: {}", value);
                self.charge_channel.millivolts.send(value).await;
            }
            Err(err) => return Err(err),
        };

        match self.ina226.shunt_voltage_microvolts().await {
            Ok(value) => {
                log::info!("Shunt voltage: {}", value);
            }
            Err(err) => return Err(err),
        };

        match self.ina226.current_amps().await {
            Ok(value) => {
                log::info!("Current: {:?}", value);
                if let Some(value) = value {
                    self.charge_channel.amps.send(-value).await; // Negative current
                }
            }
            Err(err) => return Err(err),
        };

        match self.ina226.power_watts().await {
            Ok(value) => {
                log::info!("Power: {:?}", value);
                if let Some(value) = value {
                    self.charge_channel.watts.send(value).await;
                }
            }
            Err(err) => return Err(err),
        };

        Ok(())
    }
}

#[embassy_executor::task]
pub(crate) async fn task(
    i2c: &'static mut I2cDevice<'static, CriticalSectionRawMutex, I2C<'static, I2C0, Async>>,
) {
    let mux_address = 0x70;
    let ina226_address = 0x40;

    let mut charge_channel =
        ChargeChannel::new(mux_address, ina226_address, i2c, &CHARGE_CHANNELS[0]);

    charge_channel.task().await;
}
