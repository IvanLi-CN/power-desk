use embassy_futures::select::{select, select3, Either, Either3};
use embassy_net::{tcp::TcpSocket, IpAddress, IpEndpoint, Stack};
use embassy_sync::{blocking_mutex::raw::NoopRawMutex, mutex::Mutex};
use embassy_time::{Duration, Ticker, Timer};
use esp_wifi::wifi::{WifiDevice, WifiStaDevice};
use heapless::Vec;
use rust_mqtt::{
    client::{client::MqttClient, client_config::ClientConfig},
    packet::v5::{publish_packet::QualityOfService, reason_codes::ReasonCode},
    utils::rng_generator::CountingRng,
};
use static_cell::make_static;

use crate::bus::{WiFiConnectStatus, CHARGE_CHANNELS, TEMPERATURE_CH, WIFI_CONNECT_STATUS};

const MQTT_STATUS: Mutex<NoopRawMutex, MqttStatus> = Mutex::new(MqttStatus::Disconnected);

pub enum MqttStatus {
    Connected,
    Connecting,
    Disconnected,
}

#[embassy_executor::task]
pub async fn mqtt_task(stack: &'static Stack<WifiDevice<'static, WifiStaDevice>>) {
    waiting_wifi_connected().await;

    log::info!("start mqtt task");

    let mqtt_tx = make_static!([0u8; 128]);
    let mqtt_rx = make_static!([0u8; 128]);
    let socket_tx = make_static!([0u8; 1024]);
    let socket_rx = make_static!([0u8; 1024]);
    let topics = make_static!(Vec::<&str, 2>::from_slice(&["test/#", "hello"]).unwrap());

    let send_message_buffer: &mut [u8] = make_static!([0u8; 128]);

    loop {
        let mut ticker = Ticker::every(Duration::from_secs(5));

        let address = IpAddress::v4(192, 168, 31, 11);

        let remote_endpoint = IpEndpoint::new(address, 1883);

        let mut socket = TcpSocket::new(&stack, socket_rx, socket_tx);
        socket.set_timeout(Some(embassy_time::Duration::from_secs(10)));

        socket
            .connect(remote_endpoint)
            .await
            .expect("Cannot connect");

        let mut config = ClientConfig::new(
            rust_mqtt::client::client_config::MqttVersion::MQTTv5,
            CountingRng(20000),
        );
        config.add_max_subscribe_qos(rust_mqtt::packet::v5::publish_packet::QualityOfService::QoS1);
        config.add_client_id("");
        config.max_packet_size = 100;

        let mut client = MqttClient::<_, 5, _>::new(socket, mqtt_tx, 128, mqtt_rx, 128, config);

        match client.connect_to_broker().await {
            Ok(_) => {
                log::info!("Connected");
            }
            Err(err) => {
                log::error!("Cannot connect: {:?}", err);
                Timer::after_millis(1000).await;
                continue;
            }
        }

        match client.subscribe_to_topics(topics).await {
            Ok(_) => {
                log::info!("Subscribed");
            }
            Err(err) => {
                log::error!("Cannot subscribe: {:?}", err);
                Timer::after_millis(1000).await;
                continue;
            }
        }

        loop {
            let ticker_future = ticker.next();
            let recv_future = client.receive_message();
            let send_future = next_message(send_message_buffer);

            match select3(ticker_future, recv_future, send_future).await {
                Either3::First(_) => {
                    match client.send_ping().await {
                        Ok(_) => log::info!("Ping success"),
                        Err(_) => {
                            log::error!("Ping error");
                            break;
                        }
                    };
                }
                Either3::Second(msg) => {
                    ticker.reset();
                    match msg {
                        Ok(msg) => {
                            log::info!("Received: {:?}", msg);
                        }
                        Err(mqtt_error) => {
                            log::error!("Other MQTT Error: {:?}", mqtt_error);
                            break;
                        }
                    };
                }
                Either3::Third((topic_name, message, qos, retain)) => {
                    match client.send_message(topic_name, &message, qos, retain).await {
                        Ok(_) => log::info!("Sent"),
                        Err(err) => {
                            log::error!("Send error: {:?}", err);

                            if matches!(err, ReasonCode::NoMatchingSubscribers) {
                                continue;
                            }

                            break;
                        }
                    }
                }
            };
        }
    }
}

type NextMessageInfo<'a> = (&'a str, &'a [u8], QualityOfService, bool);

pub async fn waiting_wifi_connected() {
    loop {
        let wifi_connect_status = WIFI_CONNECT_STATUS.try_lock();
        if wifi_connect_status.is_err() {
            Timer::after_millis(100).await;
            continue;
        }

        if matches!(*wifi_connect_status.unwrap(), WiFiConnectStatus::Connected) {
            break;
        }

        Timer::after_millis(100).await;
    }
}

pub async fn next_message(msg_buffer: &mut [u8]) -> NextMessageInfo {
    let temperature_future = TEMPERATURE_CH.receive();

    let ch0_power_meter_future = select3(
        CHARGE_CHANNELS[0].millivolts.receive(),
        CHARGE_CHANNELS[0].amps.receive(),
        CHARGE_CHANNELS[0].watts.receive(),
    );
    let ch0_out_power_future = select3(
        CHARGE_CHANNELS[0].out_millivolts.receive(),
        CHARGE_CHANNELS[0].out_milliamps.receive(),
        CHARGE_CHANNELS[0].out_watts.receive(),
    );

    let ch0_future = select(ch0_power_meter_future, ch0_out_power_future);

    match select(temperature_future, ch0_future).await {
        Either::First(value) => serialize_temperature(value, msg_buffer),
        Either::Second(ch) => match ch {
            Either::First(power) => match power {
                Either3::First(value) => serialize_millivolts(value, msg_buffer, 0),
                Either3::Second(value) => serialize_amps(value, msg_buffer, 0),
                Either3::Third(value) => serialize_watts(value, msg_buffer, 0),
            },
            Either::Second(power) => match power {
                Either3::First(value) => serialize_out_millivolts(value, msg_buffer, 0),
                Either3::Second(value) => serialize_out_milliamps(value, msg_buffer, 0),
                Either3::Third(value) => serialize_out_watts(value, msg_buffer, 0),
            },
        },
    }
}

fn serialize_temperature(value: f32, msg_buffer: &mut [u8]) -> NextMessageInfo {
    let topic_name = "desk-power/test/temperature";
    let message = value.to_le_bytes();
    let message = message.as_slice();
    let size = message.len();
    msg_buffer[..size].copy_from_slice(message);
    let qos = QualityOfService::QoS1;
    let retain = false;

    (topic_name, &msg_buffer[..size], qos, retain)
}

fn serialize_millivolts(value: f64, msg_buffer: &mut [u8], ch: usize) -> NextMessageInfo {
    let topic_name = "desk-power/test/ch0/millivolts";
    let message = value.to_le_bytes();
    let message = message.as_slice();
    let size = message.len();
    msg_buffer[..size].copy_from_slice(message);
    let qos = QualityOfService::QoS1;
    let retain = false;

    (topic_name, &msg_buffer[..size], qos, retain)
}

fn serialize_amps(value: f64, msg_buffer: &mut [u8], ch: usize) -> NextMessageInfo {
    let topic_name = "desk-power/test/ch0/amps";
    let message = value.to_le_bytes();
    let message = message.as_slice();
    let size = message.len();
    msg_buffer[..size].copy_from_slice(message);
    let qos = QualityOfService::QoS1;
    let retain = false;

    (topic_name, &msg_buffer[..size], qos, retain)
}

fn serialize_watts(value: f64, msg_buffer: &mut [u8], ch: usize) -> NextMessageInfo {
    let topic_name = "desk-power/test/ch0/watts";
    let message = value.to_le_bytes();
    let message = message.as_slice();
    let size = message.len();
    msg_buffer[..size].copy_from_slice(message);
    let qos = QualityOfService::QoS1;
    let retain = false;

    (topic_name, &msg_buffer[..size], qos, retain)
}

fn serialize_out_millivolts(value: u16, msg_buffer: &mut [u8], ch: usize) -> NextMessageInfo {
    let topic_name = "desk-power/test/ch0/out-millivolts";
    let message = value.to_le_bytes();
    let message = message.as_slice();
    let size = message.len();
    msg_buffer[..size].copy_from_slice(message);
    let qos = QualityOfService::QoS1;
    let retain = false;

    (topic_name, &msg_buffer[..size], qos, retain)
}

fn serialize_out_milliamps(value: f32, msg_buffer: &mut [u8], ch: usize) -> NextMessageInfo {
    let topic_name = "desk-power/test/ch0/out-milliamps";
    let message = value.to_le_bytes();
    let message = message.as_slice();
    let size = message.len();
    msg_buffer[..size].copy_from_slice(message);
    let qos = QualityOfService::QoS1;
    let retain = false;

    (topic_name, &msg_buffer[..size], qos, retain)
}

fn serialize_out_watts(value: u16, msg_buffer: &mut [u8], ch: usize) -> NextMessageInfo {
    let topic_name = "desk-power/test/ch0/out-watts";
    let message = value.to_le_bytes();
    let message = message.as_slice();
    let size = message.len();
    msg_buffer[..size].copy_from_slice(message);
    let qos = QualityOfService::QoS1;
    let retain = false;

    (topic_name, &msg_buffer[..size], qos, retain)
}
