use embassy_embedded_hal::shared_bus::asynch::i2c::I2cDevice;
use embassy_futures::select::{select, Either};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};
use embassy_time::{Duration, Ticker};
use embedded_hal_async::i2c::I2c;
use esp_hal::{peripherals::I2C0, Async};
use gx21m15::{Gx21m15, Gx21m15Config, OsFailQueueSize};
use ina226::INA226;

use crate::bus::{ProtectorSeriesItem, ProtectorSeriesItemChannel, PROTECTOR_SERIES_ITEM_CHANNEL};

const MAX_FAIL_TIMES: u8 = 3;

#[embassy_executor::task]
pub async fn task(
    i2c_mutex: &'static Mutex<CriticalSectionRawMutex, esp_hal::i2c::I2C<'static, I2C0, Async>>,
) {
    let i2c_dev = I2cDevice::new(i2c_mutex);
    let sensor_0 = Gx21m15::new(i2c_dev, 0x49);
    let i2c_dev = I2cDevice::new(i2c_mutex);
    let sensor_1 = Gx21m15::new(i2c_dev, 0x49);
    let i2c_dev = I2cDevice::new(i2c_mutex);
    let ina226 = INA226::new(i2c_dev, 0x43);

    let mut protector = Protector::new(sensor_0, sensor_1, ina226, &PROTECTOR_SERIES_ITEM_CHANNEL);

    log::info!("run temperature sensor task...");

    let mut ticker = Ticker::every(Duration::from_millis(1000));

    loop {
        let mut fail_times = 0u8;
        ticker.next().await;

        // init
        if let Err(err) = protector.init().await {
            log::error!("Failed to init protector_1: {:?}", err);
            continue;
        }

        // run
        while fail_times < MAX_FAIL_TIMES {
            ticker.next().await;

            let future = select(ticker.next(), protector.run_task_once()).await;
            match future {
                Either::First(_) => {
                    log::warn!("read temperature time out");
                    continue;
                }
                Either::Second(res) => match res {
                    Ok(_) => {}
                    Err(err) => {
                        fail_times += 1;
                        log::warn!("Failed to get temperature#0: {:?}", err);
                        continue;
                    }
                },
            }

            fail_times = 0;
        }
    }
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

struct Protector<'a, I2C> {
    gx21m15_0: Gx21m15<I2C>,
    gx21m15_1: Gx21m15<I2C>,
    ina226: INA226<I2C>,
    temperature_config: TemperatureConfig,
    temperature_channel: &'a ProtectorSeriesItemChannel,
    current_state: ProtectorSeriesItem,
}

impl<'a, I2C, E> Protector<'a, I2C>
where
    I2C: I2c<Error = E> + 'static,
    E: embedded_hal_async::i2c::Error + 'static,
{
    pub fn new(
        gx21m15_0: Gx21m15<I2C>,
        gx21m15_1: Gx21m15<I2C>,
        ina226: INA226<I2C>,
        temperature_channel: &'a ProtectorSeriesItemChannel,
    ) -> Self {
        Self::new_with_config(
            gx21m15_0,
            gx21m15_1,
            ina226,
            temperature_channel,
            TemperatureConfig::default(),
        )
    }

    pub fn new_with_config(
        gx21m15_0: Gx21m15<I2C>,
        gx21m15_1: Gx21m15<I2C>,
        ina226: INA226<I2C>,
        temperature_channel: &'a ProtectorSeriesItemChannel,
        config: TemperatureConfig,
    ) -> Self {
        Self {
            gx21m15_0,
            gx21m15_1,
            ina226,
            temperature_config: config,
            temperature_channel,
            current_state: ProtectorSeriesItem::default(),
        }
    }

    async fn init(&mut self) -> Result<(), E> {
        macro_rules! init_gx21m15 {
            ($gx21m15:expr) => {{
                let mut config = Gx21m15Config::new();

                config
                    .set_os_fail_queue_size(OsFailQueueSize::Four)
                    .set_os_mode(false)
                    .set_os_polarity(false)
                    .set_shutdown(false);

                match $gx21m15.set_config(&config).await {
                    Ok(_) => {
                        log::info!("Configured sensor");
                    }
                    Err(err) => {
                        log::error!("Failed to configure sensor: {:?}", err);
                        return Err(err);
                    }
                }

                // configure over temperature protection
                match $gx21m15
                    .set_temperature_hysteresis(self.temperature_config.hysteresis)
                    .await
                {
                    Ok(_) => {
                        let t = $gx21m15.get_temperature_hysteresis().await;
                        log::info!("Temperature hysteresis: {:?}", t);
                    }
                    Err(err) => {
                        log::error!("Failed to set temperature hysteresis: {:?}", err);
                        return Err(err);
                    }
                }
                match $gx21m15
                    .set_temperature_over_shutdown(self.temperature_config.over_shutdown)
                    .await
                {
                    Ok(_) => {
                        let t = $gx21m15.get_temperature_over_shutdown().await;
                        log::info!("Temperature over shutdown: {:?}", t);
                    }
                    Err(err) => {
                        log::error!("Failed to set temperature over shutdown: {:?}", err);
                        return Err(err);
                    }
                }
            }};
        }

        init_gx21m15!(self.gx21m15_0);
        init_gx21m15!(self.gx21m15_1);

        self.init_ina226().await?;

        Ok(())
    }

    async fn init_ina226(&mut self) -> Result<(), E> {
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

    pub async fn run_task_once(&mut self) -> Result<(), E> {
        self.current_state.temperature_0 = self.gx21m15_0.get_temperature().await?;
        self.current_state.temperature_1 = self.gx21m15_1.get_temperature().await?;

        self.current_state.millivolts = self.ina226.bus_voltage_millivolts().await?;
        match self.ina226.current_amps().await? {
            Some(amps) => {
                self.current_state.amps = -amps;
            }
            None => {
                log::info!("Failed to read input current");
            }
        }
        match self.ina226.power_watts().await? {
            Some(watts) => {
                self.current_state.watts = watts;
            }
            None => {
                log::info!("Failed to read input power");
            }
        }

        self.temperature_channel.send(self.current_state).await;

        Ok(())
    }
}
