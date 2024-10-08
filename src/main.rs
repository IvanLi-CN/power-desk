#![no_std]
#![no_main]
#![feature(type_alias_impl_trait)]

use embassy_executor::Spawner;
use embassy_net::{Stack, StackResources};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};
use embassy_time::{Duration, Timer};
use esp_backtrace as _;
use esp_hal::{
    clock::ClockControl,
    gpio::{Flex, Io, Level, Pull},
    i2c::I2C,
    peripherals::Peripherals,
    prelude::*,
    system::SystemControl,
    timer::{OneShotTimer, PeriodicTimer},
};
use esp_wifi::wifi::WifiStaDevice;
use mqtt::mqtt_task;
use static_cell::make_static;
use wifi::{connection, get_ip_addr, net_task};

mod bus;
mod charge_channel;
mod error;
mod helper;
mod i2c_mux;
mod mqtt;
mod protector;
mod wifi;

#[main]
async fn main(spawner: Spawner) {
    esp_println::logger::init_logger_from_env();

    log::info!("starting");

    let peripherals = Peripherals::take();
    let system = SystemControl::new(peripherals.SYSTEM);
    let clocks = ClockControl::max(system.clock_control).freeze();

    let io: Io = Io::new(peripherals.GPIO, peripherals.IO_MUX);

    let systimer = esp_hal::timer::systimer::SystemTimer::new(peripherals.SYSTIMER);
    let timer0 = OneShotTimer::new(systimer.alarm0.into());
    let timers = [timer0];
    let timers = make_static!(timers);
    esp_hal_embassy::init(&clocks, timers);

    let vin_ctl_pin = io.pins.gpio7;
    let mut vin_ctl_pin = Flex::new(vin_ctl_pin);

    vin_ctl_pin.set_as_open_drain(Pull::None);
    vin_ctl_pin.set_low();

    log::info!("vin_ctl_pin: {:?}", vin_ctl_pin.get_level());

    if matches!(vin_ctl_pin.get_level(), Level::High) {
        log::error!("vin_ctl_pin cannot set to low");

        Timer::after_millis(5000).await;
        return;
    }
    vin_ctl_pin.set_as_input(Pull::None);

    let timer = PeriodicTimer::new(
        esp_hal::timer::timg::TimerGroup::new(peripherals.TIMG0, &clocks, None)
            .timer0
            .into(),
    );
    let _init = esp_wifi::initialize(
        esp_wifi::EspWifiInitFor::Wifi,
        timer,
        esp_hal::rng::Rng::new(peripherals.RNG),
        peripherals.RADIO_CLK,
        &clocks,
    )
    .unwrap();

    let wifi = peripherals.WIFI;
    let (wifi_interface, controller) =
        esp_wifi::wifi::new_with_mode(&_init, wifi, WifiStaDevice).unwrap();
    let config = embassy_net::Config::dhcpv4(Default::default());
    let seed = 1234; // very random, very secure seed

    // Init network stack
    let stack = &*make_static!(Stack::new(
        wifi_interface,
        config,
        make_static!(StackResources::<3>::new()),
        seed
    ));
    // Init I2C driver
    let i2c = I2C::new_async(
        peripherals.I2C0,
        io.pins.gpio4,
        io.pins.gpio5,
        400u32.kHz(),
        &clocks,
    );

    let i2c_mutex = make_static!(Mutex::<CriticalSectionRawMutex, _>::new(i2c));

    spawner.spawn(connection(controller)).ok();
    spawner.spawn(net_task(&stack)).ok();
    spawner.spawn(get_ip_addr(&stack)).ok();

    spawner.spawn(mqtt_task(&stack)).ok();

    spawner.spawn(protector::task(i2c_mutex, vin_ctl_pin)).ok();

    spawner.spawn(charge_channel::task(i2c_mutex)).ok();

    loop {
        // log::info!("Hello world!");
        Timer::after(Duration::from_millis(5_000)).await;
    }
}
