use embassy_sync::mutex::Mutex;
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
}

impl<I2C, E> I2cMux<I2C>
where
    I2C: i2c::I2c<Error = E> + 'static,
    E: i2c::Error + 'static,
{
    pub fn new(mux_0: PCA9546A<I2C>, mux_1: PCA9546A<I2C>) -> Self {
        Self { mux_0, mux_1 }
    }

    pub async fn set_channel(&mut self, channel: ChargeChannelIndex) -> Result<(), E> {
        match channel {
            ChargeChannelIndex::Ch0 => {
                self.mux_0.set_channel(Channel::Ch0).await?;
                self.mux_1.set_channel(Channel::None).await?;
            }
            ChargeChannelIndex::Ch1 => {
                self.mux_0.set_channel(Channel::Ch1).await?;
                self.mux_1.set_channel(Channel::None).await?;
            }
            ChargeChannelIndex::Ch2 => {
                self.mux_0.set_channel(Channel::None).await?;
                self.mux_1.set_channel(Channel::Ch0).await?;
            }
            ChargeChannelIndex::Ch3 => {
                self.mux_0.set_channel(Channel::None).await?;
                self.mux_1.set_channel(Channel::Ch1).await?;
            }
        }

        Ok(())
    }
}
