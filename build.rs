fn main() {
    println!("cargo:rustc-link-arg-bins=-Tlinkall.x");

    println!("cargo:rustc-link-arg-bins=-Trom_functions.x");


    // app config

    // println!("cargo:rustc-cfg=no_mux_0");
    // println!("cargo:rustc-cfg=no_mux_1");

    // println!("cargo:rustc-cfg=no_charge_channel_0");
    // println!("cargo:rustc-cfg=no_charge_channel_1");
    // println!("cargo:rustc-cfg=no_charge_channel_2");
    // println!("cargo:rustc-cfg=no_charge_channel_3");

}
