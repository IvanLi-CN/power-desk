#![no_std]
#![no_main]
#![feature(type_alias_impl_trait)]
#![feature(impl_trait_in_assoc_type)]

use embassy_executor::Spawner;
use embassy_net::{Config, StackResources};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};
use embassy_time::{Duration, Timer};
use esp_backtrace as _;
use esp_hal::{
    gpio::{Io, Level, Output},
    i2c::master::{I2c, Config as I2cConfig},
    rng::Rng,
    timer::{
        systimer::SystemTimer,
        timg::TimerGroup,
    },
};
// WifiDevice import removed as it's no longer needed
use mqtt::mqtt_task;
use static_cell::make_static;
use wifi::{connection, get_ip_addr, net_task};

mod bus;
mod charge_channel;
mod config;
mod error;
mod helper;
mod i2c_mux;
mod mqtt;
mod protector;
mod wifi;

extern crate alloc;
use esp_alloc as _;

// ESP-IDF App Descriptor
esp_bootloader_esp_idf::esp_app_desc!();

#[esp_hal_embassy::main]
async fn main(spawner: Spawner) {
    esp_println::logger::init_logger_from_env();

    log::info!("starting");

    esp_alloc::heap_allocator!(size: 72 * 1024);

    let peripherals = esp_hal::init(esp_hal::Config::default());

    let _io: Io = Io::new(peripherals.IO_MUX);

    let systimer = SystemTimer::new(peripherals.SYSTIMER);
    esp_hal_embassy::init(systimer.alarm0);
    let timg0 = TimerGroup::new(peripherals.TIMG0);

    let vin_ctl_pin = Output::new(peripherals.GPIO7, Level::Low, esp_hal::gpio::OutputConfig::default());

    log::info!("vin_ctl_pin: {:?}", vin_ctl_pin.is_set_high());

    if vin_ctl_pin.is_set_high() {
        log::error!("vin_ctl_pin cannot set to low");

        Timer::after_millis(5000).await;
        return;
    }

    // Wi-Fi

    static INIT: static_cell::StaticCell<esp_wifi::EspWifiController<'static>> = static_cell::StaticCell::new();
    let init = INIT.init(esp_wifi::init(
        timg0.timer0,
        Rng::new(peripherals.RNG),
        peripherals.RADIO_CLK,
    )
    .unwrap());
    let wifi = peripherals.WIFI;
    let (controller, interfaces) = esp_wifi::wifi::new(init, wifi).unwrap();
    let wifi_interface = interfaces.sta;
    let config = Config::dhcpv4(Default::default());
    let seed = 1234; // very random, very secure seed

    // Init network stack
    static STACK_RESOURCES: static_cell::StaticCell<StackResources<3>> = static_cell::StaticCell::new();
    let stack_resources = STACK_RESOURCES.init(StackResources::<3>::new());

    static STACK: static_cell::StaticCell<embassy_net::Stack<'static>> = static_cell::StaticCell::new();
    static RUNNER: static_cell::StaticCell<embassy_net::Runner<'static, esp_wifi::wifi::WifiDevice<'static>>> = static_cell::StaticCell::new();
    let (stack, runner) = embassy_net::new(
        wifi_interface,
        config,
        stack_resources,
        seed
    );
    let stack = STACK.init(stack);
    let runner = RUNNER.init(runner);

    // Init I2C driver
    let i2c = I2c::new(peripherals.I2C0, I2cConfig::default())
        .unwrap()
        .with_sda(peripherals.GPIO4)
        .with_scl(peripherals.GPIO5)
        .into_async();

    let i2c_mutex = make_static!(Mutex::<CriticalSectionRawMutex, _>::new(i2c));

    spawner.spawn(connection(controller)).ok();
    spawner.spawn(net_task(runner)).ok();
    spawner.spawn(get_ip_addr(stack)).ok();

    spawner.spawn(mqtt_task(stack)).ok();

    spawner.spawn(protector::task(i2c_mutex, vin_ctl_pin)).ok();

    spawner.spawn(charge_channel::task(i2c_mutex)).ok();

    loop {
        Timer::after(Duration::from_millis(5_000)).await;
    }
}
