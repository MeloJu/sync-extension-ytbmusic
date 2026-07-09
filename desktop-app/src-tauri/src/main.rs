#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod providers;

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_ytm_key
        ])
        .setup(|app| {
            let handle = app.handle();
            let cfg = config::load(handle).unwrap_or_default();

            // Janela do painel (local, com IPC) — fila/host/busca.
            WebviewWindowBuilder::new(app, "panel", WebviewUrl::App("panel.html".into()))
                .title("YT Music Sync — Painel")
                .inner_size(420.0, 720.0)
                .build()?;

            // Janela do YT Music (site remoto) com o script de sync injetado.
            let def = &providers::ytmusic::DEF;
            let init_config_json = serde_json::to_string(&cfg)?;
            let init_script = format!(
                "window.__YTMS_INITIAL_CONFIG__ = {init_config_json};\n{}",
                def.inject_script
            );

            WebviewWindowBuilder::new(
                app,
                def.id,
                WebviewUrl::External(def.url.parse().expect("URL do provider inválida")),
            )
            .title(def.label)
            .inner_size(1200.0, 800.0)
            .initialization_script(&init_script)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao rodar o app YT Music Sync");
}
