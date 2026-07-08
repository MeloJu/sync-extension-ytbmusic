pub mod ytmusic;

/// Descreve um serviço que roda numa janela dedicada com um script de sync
/// injetado. Hoje só existe o provider do YT Music; a ideia é que um
/// provider futuro (ex: Spotify) não precise mudar como a janela é criada
/// — só registrar um novo `ProviderDef`. Spotify usa Web Playback SDK +
/// OAuth (não é "DOM scraping" como o YT Music), então o protocolo de sync
/// em si não é unificado por essa struct, só a criação da janela.
pub struct ProviderDef {
    pub id: &'static str,
    pub label: &'static str,
    pub url: &'static str,
    pub inject_script: &'static str,
}
