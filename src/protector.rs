use embassy_embedded_hal::shared_bus::{asynch::i2c::I2cDevice, I2cDeviceError};
use embassy_futures::select::{select, Either};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, channel::Channel};
use embassy_time::{Duration, Ticker};
use embedded_hal_async::i2c::I2c;
use esp_hal::{i2c::I2C, peripherals::I2C0, Async};
use gx21m15::{Gx21m15, Gx21m15Config, OsFailQueueSize};

use crate::bus::TEMPERATURE_CH;

const MAX_FAIL_TIMES: u8 = 3;

#[embassy_executor::task]
pub async fn task(
    i2c: &'static mut I2cDevice<'static, CriticalSectionRawMutex, I2C<'static, I2C0, Async>>,
) {
    let sensor = Gx21m15::new(i2c, 0x48);

    let mut protector = Protector::new(sensor, &TEMPERATURE_CH);

    log::info!("run temperature sensor task...");

    protector.run_task().await;
}

#[derive(Debug)]
struct TemperatureConfig {
    hysteresis: f32,
    over_shutdown: f32,
}

impl Default for TemperatureConfig {
    fn default() -> Self {
        Self {
            hysteresis: 60.0,
            over_shutdown: 70.0,
        }
    }
}

struct Protector<'a, I2C, const TC_SIZE: usize> {
    gx21m15: Gx21m15<I2C>,
    temperature_config: TemperatureConfig,
    temperature_channel: &'a Channel<CriticalSectionRawMutex, f32, TC_SIZE>,
}

impl<'a, I2C, E, const TC_SIZE: usize> Protector<'a, I2C, TC_SIZE>
where
    I2C: I2c<Error = E> + 'static,
    E: embedded_hal_async::i2c::Error + 'static,
{
    pub fn new(
        gx21m15: Gx21m15<I2C>,
        temperature_channel: &'a Channel<CriticalSectionRawMutex, f32, TC_SIZE>,
    ) -> Self {
        Self::new_with_config(gx21m15, temperature_channel, TemperatureConfig::default())
    }

    pub fn new_with_config(
        gx21m15: Gx21m15<I2C>,
        temperature_channel: &'a Channel<CriticalSectionRawMutex, f32, TC_SIZE>,
        config: TemperatureConfig,
    ) -> Self {
        Self {
            gx21m15,
            temperature_config: config,
            temperature_channel,
        }
    }

    async fn init_gx21m15(&mut self) -> Result<(), E> {
        let mut config = Gx21m15Config::new();

        config
            .set_os_fail_queue_size(OsFailQueueSize::Four)
            .set_os_mode(false)
            .set_os_polarity(false)
            .set_shutdown(false);

        match self.gx21m15.set_config(&config).await {
            Ok(_) => {
                log::info!("Configured sensor");
            }
            Err(err) => {
                log::error!("Failed to configure sensor: {:?}", err);
                return Err(err);
            }
        }

        // configure over temperature protection
        match self
            .gx21m15
            .set_temperature_hysteresis(self.temperature_config.hysteresis)
            .await
        {
            Ok(_) => {
                let t = self.gx21m15.get_temperature_hysteresis().await;
                log::info!("Temperature hysteresis: {:?}", t);
            }
            Err(err) => {
                log::error!("Failed to set temperature hysteresis: {:?}", err);
                return Err(err);
            }
        }
        match self
            .gx21m15
            .set_temperature_over_shutdown(self.temperature_config.over_shutdown)
            .await
        {
            Ok(_) => {
                let t = self.gx21m15.get_temperature_over_shutdown().await;
                log::info!("Temperature over shutdown: {:?}", t);
            }
            Err(err) => {
                log::error!("Failed to set temperature over shutdown: {:?}", err);
                return Err(err);
            }
        }

        Ok(())
    }

    pub async fn run_task(&mut self) {
        let mut ticker = Ticker::every(Duration::from_secs(1));

        loop {
            ticker.next().await;

            let mut fail_times = 0u8;

            let future = select(ticker.next(), self.init_gx21m15()).await;

            match future {
                Either::First(_) => {
                    log::warn!("read temperature time out");
                    continue;
                }
                Either::Second(result) => match result {
                    Ok(_) => {
                        log::info!("Temperature sensor init success");
                    }
                    Err(err) => {
                        log::error!("Temperature sensor init error: {:?}", err);
                        continue;
                    }
                },
            }

            loop {
                let future = select(ticker.next(), self.gx21m15.get_temperature()).await;

                match future {
                    Either::First(_) => {
                        fail_times += 1;
                        log::warn!("read temperature time out");
                    }
                    Either::Second(temp) => match temp {
                        Ok(temp) => {
                            log::info!("Temperature: {}℃", temp);

                            fail_times = 0;
                            self.temperature_channel.send(temp).await;
                        }
                        Err(err) => {
                            fail_times += 1;
                            log::warn!("Failed to get temperature: {:?}", err);
                        }
                    },
                }

                if fail_times >= MAX_FAIL_TIMES {
                    log::error!("too many failures, re-init temperature sensor");
                    break;
                }

                ticker.next().await;
            }
        }
    }
}
