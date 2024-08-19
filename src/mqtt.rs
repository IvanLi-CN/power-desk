use embassy_futures::select::{select, select3, select4, Either, Either3, Either4};
use embassy_net::{tcp::TcpSocket, IpAddress, IpEndpoint, Stack};
use embassy_time::{Duration, Ticker, Timer};
use esp_wifi::wifi::{WifiDevice, WifiStaDevice};
use heapless::{String, Vec};
use rust_mqtt::{
    client::{client::MqttClient, client_config::ClientConfig},
    packet::v5::{publish_packet::QualityOfService, reason_codes::ReasonCode},
    utils::rng_generator::CountingRng,
};
use static_cell::make_static;
use sw3526::{AbnormalCaseResponse, ProtocolIndicationResponse, SystemStatusResponse};

use crate::bus::{
    ChargeChannelSeriesItem, WiFiConnectStatus, CHARGE_CHANNEL_SERIES_ITEM_CHANNELS, TEMPERATURE_CH, WIFI_CONNECT_STATUS
};

const MQTT_TOPIC_PREFIX: &str = "power-desk/test/";

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
    let send_topic = make_static!(String::<64>::new());

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
            let send_future = next_message(send_topic, send_message_buffer);

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
                        Ok(_) => {}
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

type NextMessageInfo<'a> = (&'a String<64>, &'a [u8], QualityOfService, bool);

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

pub async fn next_message<'a>(
    topic_name: &'a mut String<64>,
    msg_buffer: &'a mut [u8],
) -> NextMessageInfo<'a> {
    let temperature_future = TEMPERATURE_CH.receive();

    let ch0_future = CHARGE_CHANNEL_SERIES_ITEM_CHANNELS[0].receive();
    let ch1_future = CHARGE_CHANNEL_SERIES_ITEM_CHANNELS[1].receive();
    let ch2_future = CHARGE_CHANNEL_SERIES_ITEM_CHANNELS[2].receive();
    let ch3_future = CHARGE_CHANNEL_SERIES_ITEM_CHANNELS[3].receive();

    let channels_future = select4(ch0_future, ch1_future, ch2_future, ch3_future);

    match select(temperature_future, channels_future).await {
        Either::First(value) => serialize_temperature(value, topic_name, msg_buffer),
        Either::Second(channels) => match channels {
            Either4::First(ch) => serialize_charge_channel_series_item(ch, topic_name, msg_buffer, 0),
            Either4::Second(ch) => serialize_charge_channel_series_item(ch, topic_name, msg_buffer, 1),
            Either4::Third(ch) => serialize_charge_channel_series_item(ch, topic_name, msg_buffer, 2),
            Either4::Fourth(ch) => serialize_charge_channel_series_item(ch, topic_name, msg_buffer, 3),
        },
    }
}

fn get_channel_str(ch: u8) -> &'static str {
    match ch {
        0 => "ch0",
        1 => "ch1",
        2 => "ch2",
        3 => "ch3",
        _ => "unknown",
    }
}

#[inline(always)]
fn serialize_charge_channel_series_item<'a>(
    value: ChargeChannelSeriesItem ,
    topic_name: &'a mut String<64>,
    msg_buffer: &'a mut [u8],
    ch: u8,
) -> NextMessageInfo<'a> {
    let channel_name = get_channel_str(ch);
    topic_name.clear();
    topic_name.push_str(MQTT_TOPIC_PREFIX).unwrap();
    topic_name.push_str(channel_name).unwrap();
    topic_name.push_str("/series").unwrap();
    let message = value.to_bytes();
    let message = message.as_slice();
    let size = message.len();
    msg_buffer[..size].copy_from_slice(message);
    let qos = QualityOfService::QoS0;
    let retain = false;

    (topic_name, &msg_buffer[..size], qos, retain)
}

#[inline(always)]
fn serialize_temperature<'a>(
    value: f32,
    topic_name: &'a mut String<64>,
    msg_buffer: &'a mut [u8],
) -> NextMessageInfo<'a> {
    topic_name.clear();
    topic_name.push_str(MQTT_TOPIC_PREFIX).unwrap();
    topic_name.push_str("temperature").unwrap();
    let message = value.to_le_bytes();
    let message = message.as_slice();
    let size = message.len();
    msg_buffer[..size].copy_from_slice(message);
    let qos = QualityOfService::QoS0;
    let retain = false;

    (topic_name, &msg_buffer[..size], qos, retain)
}
