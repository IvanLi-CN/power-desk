use embassy_embedded_hal::shared_bus::asynch::i2c::I2cDevice;
use embassy_futures::select::{select3, Either3};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};
use embassy_time::{Duration, Ticker};
use embedded_hal_async::i2c::I2c;
use esp_hal::{
    gpio::{AnyPin, Flex, Level, Pull},
    peripherals::I2C0,
    Async,
};
use gx21m15::{Gx21m15, Gx21m15Config, OsFailQueueSize};
use ina226::INA226;

use crate::bus::{
    ProtectorSeriesItem, ProtectorSeriesItemChannel, PROTECTOR_SERIES_ITEM_CHANNEL,
    VIN_STATUS_CFG_CHANNEL,
};

const MAX_FAIL_TIMES: u8 = 3;

#[embassy_executor::task]
pub async fn task(
    i2c_mutex: &'static Mutex<CriticalSectionRawMutex, esp_hal::i2c::I2c<'static, I2C0, Async>>,
    vin_ctl_pin: Flex<'static, AnyPin>,
) {
    let i2c_dev = I2cDevice::new(i2c_mutex);
    let sensor_0 = Gx21m15::new(i2c_dev, 0x49);
    let i2c_dev = I2cDevice::new(i2c_mutex);
    let sensor_1 = Gx21m15::new(i2c_dev, 0x48);
    let i2c_dev = I2cDevice::new(i2c_mutex);
    let ina226 = INA226::new(i2c_dev, 0x43);

    let mut protector = Protector::new(
        sensor_0,
        sensor_1,
        ina226,
        vin_ctl_pin,
        &PROTECTOR_SERIES_ITEM_CHANNEL,
    );

    log::info!("run temperature sensor task...");

    let mut ticker = Ticker::every(Duration::from_millis(1000));

    loop {
        let mut fail_times = 0u8;
        ticker.next().await;

        // init
        if let Err(err) = protector.init().await {
            log::error!("Failed to init protector: {:?}", err);
            continue;
        }

        // run
        while fail_times < MAX_FAIL_TIMES {
            ticker.next().await;

            let receive_vin_state_cfg = VIN_STATUS_CFG_CHANNEL.receive();

            let future = select3(
                ticker.next(),
                protector.run_task_once(),
                receive_vin_state_cfg,
            )
            .await;
            match future {
                Either3::First(_) => {
                    log::warn!("read temperature time out");
                    continue;
                }
                Either3::Second(res) => match res {
                    Ok(_) => {}
                    Err(err) => {
                        fail_times += 1;
                        log::warn!("Failed to get temperature#0: {:?}", err);
                        continue;
                    }
                },
                Either3::Third(res) => match res {
                    VinState::Normal => {
                        protector.turn_on_vin();
                    }
                    _ => {
                        protector.turn_off_vin();
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

#[derive(Debug, Clone, Copy)]
#[repr(u8)]
pub enum VinState {
    Normal,
    Shutdown,
    Protection,
}

impl From<VinState> for u8 {
    fn from(vin_state: VinState) -> Self {
        match vin_state {
            VinState::Normal => 0,
            VinState::Shutdown => 1,
            VinState::Protection => 2,
        }
    }
}

impl From<u8> for VinState {
    fn from(vin_state: u8) -> Self {
        match vin_state {
            0 => Self::Normal,
            1 => Self::Shutdown,
            2 => Self::Protection,
            _ => unreachable!(),
        }
    }
}

struct Protector<'a, I2C> {
    gx21m15_0: Gx21m15<I2C>,
    gx21m15_1: Gx21m15<I2C>,
    ina226: INA226<I2C>,
    vin_ctl_pin: Flex<'a, AnyPin>,
    temperature_config: TemperatureConfig,
    temperature_channel: &'a ProtectorSeriesItemChannel,
    current_state: ProtectorSeriesItem,
    shutdown: bool,
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
        vin_ctl_pin: Flex<'a, AnyPin>,
        temperature_channel: &'a ProtectorSeriesItemChannel,
    ) -> Self {
        Self::new_with_config(
            gx21m15_0,
            gx21m15_1,
            ina226,
            vin_ctl_pin,
            temperature_channel,
            TemperatureConfig::default(),
        )
    }

    pub fn new_with_config(
        gx21m15_0: Gx21m15<I2C>,
        gx21m15_1: Gx21m15<I2C>,
        ina226: INA226<I2C>,

        vin_ctl_pin: Flex<'a, AnyPin>,
        temperature_channel: &'a ProtectorSeriesItemChannel,
        config: TemperatureConfig,
    ) -> Self {
        Self {
            gx21m15_0,
            gx21m15_1,
            ina226,
            vin_ctl_pin,
            temperature_config: config,
            temperature_channel,
            current_state: ProtectorSeriesItem::default(),
            shutdown: false,
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

        log::info!(
            "get level: {:?}, get output level: {:?}",
            self.vin_ctl_pin.get_level(),
            self.vin_ctl_pin.get_output_level()
        );
        self.current_state.vin_status = if self.shutdown {
            VinState::Shutdown
        } else if matches!(self.vin_ctl_pin.get_level(), Level::High) {
            VinState::Normal
        } else {
            VinState::Protection
        };

        self.temperature_channel.send(self.current_state).await;

        Ok(())
    }

    pub fn turn_off_vin(&mut self) {
        log::info!("turn_off_vin");

        self.shutdown = true;
        self.vin_ctl_pin.set_as_open_drain(Pull::None);
        self.vin_ctl_pin.set_low();
    }

    pub fn turn_on_vin(&mut self) {
        log::info!("turn_on_vin");
        self.shutdown = false;
        self.vin_ctl_pin.set_as_input(Pull::None);
    }
}
