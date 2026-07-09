use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub worker_url: String,
    pub room_code: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub client_id: String,
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

pub fn load(app: &AppHandle) -> Result<Config, String> {
    let path = config_path(app)?;
    let mut cfg: Config = if path.exists() {
        let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&contents).map_err(|e| e.to_string())?
    } else {
        Config::default()
    };

    // Garante um clientId estável por instalação (identifica a pessoa na sala).
    if cfg.client_id.is_empty() {
        cfg.client_id = uuid::Uuid::new_v4().to_string();
        save(app, &cfg)?;
    }
    Ok(cfg)
}

pub fn save(app: &AppHandle, config: &Config) -> Result<(), String> {
    let path = config_path(app)?;
    let contents = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, contents).map_err(|e| e.to_string())
}
