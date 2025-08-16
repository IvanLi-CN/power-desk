use embedded_hal_async::i2c;


#[derive(Debug)]
pub(crate) enum ChargeChannelError<I2cErr: i2c::Error> {
    I2CError(I2cErr),
    #[allow(dead_code)]
    SW3526Error(sw3526::OperationError<I2cErr>),
}