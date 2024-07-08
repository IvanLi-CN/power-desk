#![no_std]
#![no_main]
#![feature(type_alias_impl_trait)]

use core::{borrow::Borrow, cell::RefCell};

use charge_channel::ChargeChannel;
use embassy_embedded_hal::shared_bus::asynch::i2c::I2cDevice;
use embassy_executor::Spawner;
use embassy_net::{Stack, StackResources};
use embassy_sync::{
    blocking_mutex::raw::{CriticalSectionRawMutex, RawMutex},
    mutex::Mutex,
};
use embassy_time::{Duration, Timer};
use esp_backtrace as _;
use esp_hal::{
    clock::ClockControl,
    gpio::Io,
    i2c::I2C,
    peripherals::{Peripherals, I2C0},
    prelude::*,
    system::SystemControl,
    timer::timg::TimerGroup,
    Async,
};
use esp_wifi::wifi::WifiStaDevice;
use mqtt::mqtt_task;
use static_cell::make_static;
use wifi::{connection, get_ip_addr, net_task};

mod bus;
mod charge_channel;
mod mqtt;
mod temperature;
mod wifi;

#[main]
async fn main(spawner: Spawner) {
    esp_println::logger::init_logger_from_env();

    log::info!("starting");

    let peripherals = Peripherals::take();
    let system = SystemControl::new(peripherals.SYSTEM);
    let clocks = ClockControl::max(system.clock_control).freeze();

    let timg0 = TimerGroup::new_async(peripherals.TIMG0, &clocks);
    esp_hal_embassy::init(&clocks, timg0);

    let timer = esp_hal::timer::systimer::SystemTimer::new(peripherals.SYSTIMER).alarm0;
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

    let io = Io::new(peripherals.GPIO, peripherals.IO_MUX);

    // Init I2C driver
    let i2c = I2C::new_async(
        peripherals.I2C0,
        io.pins.gpio4,
        io.pins.gpio5,
        100u32.kHz(),
        &clocks,
    );

    let i2c_mutex = make_static!(Mutex::<CriticalSectionRawMutex, _>::new(i2c));

    let temperature_i2c_dev = I2cDevice::new(i2c_mutex);
    let channel_i2c_dev = I2cDevice::new(i2c_mutex);
    let temperature_i2c_dev = make_static!(temperature_i2c_dev);
    let channel_i2c_dev = make_static!(channel_i2c_dev);

    spawner.spawn(connection(controller)).ok();
    spawner.spawn(net_task(&stack)).ok();
    spawner.spawn(get_ip_addr(&stack)).ok();

    spawner.spawn(mqtt_task(&stack)).ok();

    spawner.spawn(temperature::task(temperature_i2c_dev)).ok();

    spawner
        .spawn(charge_channel::task(channel_i2c_dev))
        .ok();

    loop {
        // log::info!("Hello world!");
        Timer::after(Duration::from_millis(5_000)).await;
    }
}
