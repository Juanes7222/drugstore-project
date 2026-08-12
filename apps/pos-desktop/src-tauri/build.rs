fn main() {
    println!("cargo:rerun-if-changed=capabilities");

    // `tauri-plugin-wdio` is an optional dependency gated behind the `wdio`
    // cargo feature (kept out of release builds). Its `wdio:default`
    // permission only exists when the plugin is compiled, so the wdio
    // capability file must only be parsed for builds that enable the
    // feature; otherwise tauri-build fails with "Permission wdio:default
    // not found".
    #[cfg(feature = "wdio")]
    let capabilities_pattern = "./capabilities/**/*";
    #[cfg(not(feature = "wdio"))]
    let capabilities_pattern = "./capabilities/default.json";

    tauri_build::try_build(
        tauri_build::Attributes::new().capabilities_path_pattern(capabilities_pattern),
    )
    .expect("failed to run tauri-build");
}
