use embassy_net::StaticConfigV4;

use crate::bus::{WiFiConnectStatus, WIFI_CONNECT_STATUS};
use crate::config;
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};
use embassy_time::{Duration, Timer};
use esp_backtrace as _;
use esp_wifi::wifi::{ClientConfiguration, Configuration, WifiController, WifiEvent, WifiState};

// 获取WiFi配置的函数
fn get_wifi_credentials() -> (&'static str, &'static str) {
    match config::get_wifi_config() {
        (Some(ssid), Some(password)) => (ssid, password),
        _ => {
            log::error!("No valid WiFi configuration found!");
            ("", "") // 返回空字符串作为错误情况
        }
    }
}

// global variable ip address
pub static NETWORK_CONFIG: Mutex<CriticalSectionRawMutex, Option<StaticConfigV4>> =
    Mutex::new(None);

#[embassy_executor::task]
pub async fn connection(mut controller: WifiController<'static>) {
    log::info!("start connection task");

    let (ssid, password) = get_wifi_credentials();
    log::info!("SSID : {ssid}");
    log::info!("Device capabilities: {:?}", controller.capabilities());

    // 检查配置是否有效
    if ssid.is_empty() || password.is_empty() {
        log::error!("Invalid WiFi configuration - SSID or password is empty!");
        return;
    }

    loop {
        if esp_wifi::wifi::wifi_state() == WifiState::StaConnected {
            // wait until we're no longer connected
            controller.wait_for_event(WifiEvent::StaDisconnected).await;
            Timer::after(Duration::from_millis(5000)).await
        }
        if !matches!(controller.is_started(), Ok(true)) {
            let client_config = Configuration::Client(ClientConfiguration {
                ssid: ssid.into(),
                password: password.into(),
                ..Default::default()
            });
            controller.set_configuration(&client_config).unwrap();
            log::info!("Starting wifi");
            controller.start().unwrap();
            log::info!("Wifi started!");
        }
        log::info!("About to connect...");

        match controller.connect() {
            Ok(_) => log::info!("Wifi connected!"),
            Err(e) => {
                log::info!("Failed to connect to wifi: {e:?}");
                Timer::after(Duration::from_millis(5000)).await
            }
        }
    }
}

#[embassy_executor::task]
pub async fn get_ip_addr(stack: &'static embassy_net::Stack<'static>) {
    loop {
        let mut network_config_guard = NETWORK_CONFIG.lock().await;
        if stack.is_link_up() && network_config_guard.is_none() {
            log::info!("Waiting to get IP address...");
            loop {
                if let Some(config) = stack.config_v4() {
                    log::info!("Got IP: {}", config.address);
                    *network_config_guard = Some(config);

                    let mut connect_status = WIFI_CONNECT_STATUS.lock().await;
                    *connect_status = WiFiConnectStatus::Connected;
                    break;
                }
                Timer::after(Duration::from_millis(500)).await;
            }
        }

        if !stack.is_link_up() && network_config_guard.is_some() {
            log::info!("Link down or config down, reset NETWORK_CONFIG to None");
            *network_config_guard = None;
        }

        if network_config_guard.is_none() {
            let mut connect_status = WIFI_CONNECT_STATUS.lock().await;
            *connect_status = WiFiConnectStatus::Connecting;
        }

        Timer::after(Duration::from_millis(100)).await;
    }
}

#[embassy_executor::task]
pub async fn net_task(
    runner: &'static mut embassy_net::Runner<'static, esp_wifi::wifi::WifiDevice<'static>>,
) {
    runner.run().await
}
