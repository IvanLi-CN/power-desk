use embedded_hal_async::i2c;
use pca9546a::{Channel, PCA9546A};

pub enum ChargeChannelIndex {
    Ch0 = 0,
    Ch1 = 1,
    Ch2 = 2,
    Ch3 = 3,
}

pub struct I2cMux<I2C> {
    mux_0: PCA9546A<I2C>,
    mux_1: PCA9546A<I2C>,
    mux_0_online: bool,
    mux_1_online: bool,
}

impl<I2C, E> I2cMux<I2C>
where
    I2C: i2c::I2c<Error = E> + 'static,
    E: i2c::Error + 'static,
{
    pub fn new(mux_0: PCA9546A<I2C>, mux_1: PCA9546A<I2C>) -> Self {
        Self {
            mux_0,
            mux_1,
            mux_0_online: false,
            mux_1_online: false,
        }
    }

    pub async fn init(&mut self) {
        #[cfg(no_mux_0)]
        {
            self.mux_0_online = false;
        }
        #[cfg(not(no_mux_0))]
        {
            self.mux_0_online = match self.mux_0.get_channel().await {
                Ok(_) => true,
                Err(_) => false,
            };
        }

        #[cfg(no_mux_1)]
        {
            self.mux_1_online = false;
        }
        #[cfg(not(no_mux_1))]
        {
            self.mux_1_online = match self.mux_1.get_channel().await {
                Ok(_) => true,
                Err(_) => false,
            };
        }
    }

    async fn set_channels_if_online(
        &mut self,
        mux_0_channel: Channel,
        mux_1_channel: Channel,
    ) -> Result<(), E> {
        if self.mux_0_online {
            self.mux_0.set_channel(mux_0_channel).await?;
        }

        if self.mux_1_online {
            self.mux_1.set_channel(mux_1_channel).await?;
        }

        Ok(())
    }

    pub async fn set_channel(&mut self, channel: ChargeChannelIndex) -> Result<(), E> {
        match channel {
            ChargeChannelIndex::Ch0 => {
                self.set_channels_if_online(Channel::Ch0, Channel::None)
                    .await?;
            }
            ChargeChannelIndex::Ch1 => {
                self.set_channels_if_online(Channel::None, Channel::Ch1)
                    .await?;
            }
            ChargeChannelIndex::Ch2 => {
                self.set_channels_if_online(Channel::Ch1, Channel::None)
                    .await?;
            }
            ChargeChannelIndex::Ch3 => {
                self.set_channels_if_online(Channel::None, Channel::Ch0)
                    .await?;
            }
        }

        Ok(())
    }

    pub fn get_channel_available(&mut self, channel: ChargeChannelIndex) -> bool {
        match channel {
            ChargeChannelIndex::Ch0 => self.mux_0_online,
            ChargeChannelIndex::Ch1 => self.mux_1_online,
            ChargeChannelIndex::Ch2 => self.mux_0_online,
            ChargeChannelIndex::Ch3 => self.mux_1_online,
        }
    }
}
