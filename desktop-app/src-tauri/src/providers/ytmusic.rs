use super::ProviderDef;

pub const DEF: ProviderDef = ProviderDef {
    id: "ytmusic",
    label: "YT Music Sync",
    url: "https://music.youtube.com/",
    inject_script: include_str!("../../inject/ytmusic-sync.js"),
};
