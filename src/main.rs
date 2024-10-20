#![no_std]
#![no_main]
#![feature(type_alias_impl_trait)]
#![feature(impl_trait_in_assoc_type)]

use embassy_executor::Spawner;
use embassy_net::{Config, Stack, StackResources};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};
use embassy_time::{Duration, Timer};
use esp_backtrace as _;
use esp_hal::{
    gpio::{Flex, Io, Level, Pull},
    i2c::I2c,
    prelude::*,
    rng::Rng,
    timer::{
        systimer::{SystemTimer, Target},
        timg::TimerGroup,
    },
};
use esp_wifi::{wifi::WifiStaDevice, EspWifiInitFor};
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

extern crate alloc;
use esp_alloc as _;

#[main]
async fn main(spawner: Spawner) {
    esp_println::logger::init_logger_from_env();

    log::info!("starting");

    esp_alloc::heap_allocator!(72 * 1024);

    let peripherals = esp_hal::init(esp_hal::Config::default());

    let io: Io = Io::new(peripherals.GPIO, peripherals.IO_MUX);

    let systimer = SystemTimer::new(peripherals.SYSTIMER).split::<Target>();
    esp_hal_embassy::init(systimer.alarm0);
    let timg0 = TimerGroup::new(peripherals.TIMG0);

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

    // Wi-Fi

    let init = esp_wifi::init(
        EspWifiInitFor::Wifi,
        timg0.timer0,
        Rng::new(peripherals.RNG),
        peripherals.RADIO_CLK,
    )
    .unwrap();
    let wifi = peripherals.WIFI;
    let (wifi_interface, controller) =
        esp_wifi::wifi::new_with_mode(&init, wifi, WifiStaDevice).unwrap();
    let config = Config::dhcpv4(Default::default());
    let seed = 1234; // very random, very secure seed

    // Init network stack
    let stack = &*make_static!(Stack::new(
        wifi_interface,
        config,
        make_static!(StackResources::<3>::new()),
        seed
    ));

    // Init I2C driver
    let i2c = I2c::new_async(peripherals.I2C0, io.pins.gpio4, io.pins.gpio5, 400u32.kHz());

    let i2c_mutex = make_static!(Mutex::<CriticalSectionRawMutex, _>::new(i2c));

    spawner.spawn(connection(controller)).ok();
    spawner.spawn(net_task(&stack)).ok();
    spawner.spawn(get_ip_addr(&stack)).ok();

    spawner.spawn(mqtt_task(&stack)).ok();

    spawner.spawn(protector::task(i2c_mutex, vin_ctl_pin)).ok();

    spawner.spawn(charge_channel::task(i2c_mutex)).ok();

    loop {
        Timer::after(Duration::from_millis(5_000)).await;
    }
}
