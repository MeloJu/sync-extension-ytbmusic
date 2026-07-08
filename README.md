# YT Music Sync

Sincroniza a reprodução do YouTube Music entre duas pessoas em tempo real —
play, pause e seek de um lado refletem automaticamente no outro. Feito para
uso pessoal, com 2 usuários fixos por sala.

Tem dois jeitos de usar do lado do cliente: um **app desktop** (Tauri, em
teste, vai virar o principal) e uma **extensão de navegador** (Chrome +
Firefox, ainda funcional). Os dois falam com o mesmo backend.

## Estrutura

```
/desktop-app  → cliente desktop (Tauri) — Windows/macOS/Linux
/extension    → extensão de navegador (Manifest V3, Chrome + Firefox)
/worker       → backend (Cloudflare Worker + Durable Object)
```

## Como rodar

### 1. Backend (Cloudflare Worker)

**Opção A — local com Node:**

```bash
cd worker
npm install
npx wrangler dev        # roda localmente, dá uma URL tipo ws://localhost:8787
```

**Opção B — local com Docker (não precisa Node instalado):**

```bash
docker compose up worker   # sobe em ws://localhost:8787
```

**Deploy de verdade (Cloudflare, precisa de conta):**

```bash
cd worker
npx wrangler login       # autoriza o Wrangler CLI na sua conta Cloudflare
npx wrangler deploy      # publica, dá uma URL wss://...workers.dev
```

Roda inteiramente no plano **Free** da Cloudflare (Durable Objects com
armazenamento SQLite) — não precisa cartão de crédito.

### 2. Cliente desktop (Tauri) — recomendado

Pré-requisitos (só pra compilar/rodar em modo desenvolvimento):
- [Rust](https://rustup.rs/)
- Windows: Visual C++ Build Tools (workload "Desktop development with C++")
- macOS: Xcode Command Line Tools
- Linux: `webkit2gtk`, `libayatana-appindicator3` (ver [docs do Tauri](https://tauri.app/start/prerequisites/))

```bash
cd desktop-app
npm install
npm run dev      # abre a janela de configurações + a janela do YT Music
```

Na janela de configurações, preencha **Worker URL** (`wss://...`) e
**Código da sala**, e salve. Repita nas duas máquinas com os mesmos
valores.

Pra gerar um instalador:

```bash
npm run build     # gera .msi/.exe (Windows) em src-tauri/target/release/bundle/
```

### 3. Extensão de navegador (legado)

1. Carregar sem compactação:
   - **Chrome**: `chrome://extensions` → ativar "Modo do desenvolvedor" →
     "Carregar sem compactação" → selecionar a pasta `/extension`.
   - **Firefox**: `about:debugging` → "Este Firefox" → "Carregar extensão
     temporária" → selecionar `extension/manifest.json`.
2. Abrir o popup da extensão e preencher **Worker URL** + **Código da
   sala** (mesmos valores usados no app desktop / na outra pessoa).
3. Abrir `music.youtube.com` e testar play/pause/seek de um lado
   refletindo no outro.

## Limitações conhecidas (v1)

- Só 2 conexões simultâneas por sala.
- Sem autenticação — o código da sala é o único controle de acesso.
- Sem histórico de sessões — o estado só existe enquanto o Durable Object
  está ativo.
- O Docker Compose só cobre o **backend** (`/worker`). O app desktop
  depende do toolchain nativo do SO (Rust + WebView do sistema) pra
  compilar um binário de verdade, então não faz sentido rodar dentro de
  container.
