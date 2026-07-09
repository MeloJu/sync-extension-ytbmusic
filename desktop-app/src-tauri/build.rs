fn main() {
    // Lê o .env (se existir) e embute o YTM_KEY no binário via env!() no código.
    // Assim a chave fica fora do código-fonte versionado, mas o app compilado
    // já a carrega — não precisa distribuir o .env junto do executável.
    let _ = dotenvy::dotenv();
    let ytm_key = std::env::var("YTM_KEY").unwrap_or_default();
    println!("cargo:rustc-env=YTM_KEY={ytm_key}");
    println!("cargo:rerun-if-changed=.env");

    tauri_build::build()
}
