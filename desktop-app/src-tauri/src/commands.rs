use tauri::{AppHandle, Manager};

use crate::config::{self, Config};

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<Config, String> {
    config::load(&app)
}

#[tauri::command]
pub fn save_config(
    app: AppHandle,
    worker_url: String,
    room_code: String,
    name: String,
) -> Result<(), String> {
    // Preserva o clientId já existente (identidade estável da pessoa).
    let existing = config::load(&app).unwrap_or_default();
    let cfg = Config {
        worker_url,
        room_code,
        name,
        client_id: existing.client_id,
    };
    config::save(&app, &cfg)?;
    push_config_to_ytmusic_window(&app, &cfg);
    Ok(())
}

fn push_config_to_ytmusic_window(app: &AppHandle, cfg: &Config) {
    if let Some(window) = app.get_webview_window(crate::providers::ytmusic::DEF.id) {
        if let Ok(json) = serde_json::to_string(cfg) {
            let script = format!("window.__ytmsApplyConfig && window.__ytmsApplyConfig({json});");
            let _ = window.eval(&script);
        }
    }
}
