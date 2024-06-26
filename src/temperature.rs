use embassy_time::Timer;
use esp_hal::{i2c::I2C, peripherals::I2C0, Async};
use gx21m15::{Gx21m15, Gx21m15Config, OsFailQueueSize};

use crate::bus::TEMPERATURE_CH;

const MAX_FAIL_TIMES: u8 = 3;

#[embassy_executor::task]
pub async fn task(i2c: &'static mut I2C<'static, I2C0, Async>) {
    let mut sensor = Gx21m15::new(i2c, 0x48);

    log::info!("run temperature sensor task...");

    loop {
        let mut fail_times = 0u8;

        let mut config = Gx21m15Config::new();

        config
            .set_os_fail_queue_size(OsFailQueueSize::Four)
            .set_os_mode(false)
            .set_os_polarity(false)
            .set_shutdown(false);

        match sensor.set_config(&config).await {
            Ok(_) => {
                log::info!("Configured sensor");
            }
            Err(err) => {
                log::error!("Failed to configure sensor: {:?}", err);
                Timer::after_millis(1000).await;
                continue;
            }
        }

        // configure over temperature protection
        match sensor.set_temperature_hysteresis(50.0).await {
            Ok(_) => {
                let t = sensor.get_temperature_hysteresis().await;
                log::info!("Temperature hysteresis: {:?}", t);
            },
            Err(err) => {
                log::error!("Failed to set temperature hysteresis: {:?}", err);
                Timer::after_millis(1000).await;
                continue;
            },
        }
        match sensor.set_temperature_over_shutdown(40.0).await {
            Ok(_) => {
                let t = sensor.get_temperature_over_shutdown().await;
                log::info!("Temperature over shutdown: {:?}", t);
            },
            Err(err) => {
                log::error!("Failed to set temperature over shutdown: {:?}", err);
                Timer::after_millis(1000).await;
                continue;
            },
        }

        loop {
            let temp = sensor.get_temperature().await;

            if let Err(e) = temp {
                fail_times += 1;
                if fail_times >= MAX_FAIL_TIMES {
                    log::error!("Failed to get temperature: {:?}. re-init sensor", e);
                    break;
                } else {
                    log::warn!("Failed to get temperature: {:?}", e);
                }
            }

            if let Ok(temp) = temp {
                log::info!("Temperature: {}℃", temp);
                TEMPERATURE_CH.send(temp).await;
            }

            Timer::after_millis(1000).await;
        }
    }
}
