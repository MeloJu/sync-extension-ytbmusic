# YT Music Sync

Extensão de navegador (Chrome e Firefox) que sincroniza a reprodução do
YouTube Music entre duas pessoas em tempo real — play, pause e seek de um
lado refletem automaticamente no outro. Feito para uso pessoal, com 2
usuários fixos por sala.

## Estrutura

```
/extension    → extensão do navegador (Manifest V3, Chrome + Firefox)
/worker       → backend (Cloudflare Worker + Durable Object)
```

## Como rodar

### 1. Backend (Cloudflare Worker)

```bash
cd worker
npm install
npx wrangler login     # autoriza o Wrangler CLI na sua conta Cloudflare
npx wrangler dev        # roda localmente, dá uma URL tipo ws://localhost:8787
npx wrangler deploy     # publica de verdade, dá uma URL wss://...workers.dev
```

Roda inteiramente no plano **Free** da Cloudflare (Durable Objects com
armazenamento SQLite) — não precisa cartão de crédito.

### 2. Extensão

1. Carregar sem compactação:
   - **Chrome**: `chrome://extensions` → ativar "Modo do desenvolvedor" →
     "Carregar sem compactação" → selecionar a pasta `/extension`.
   - **Firefox**: `about:debugging` → "Este Firefox" → "Carregar extensão
     temporária" → selecionar `extension/manifest.json`.
2. Abrir o popup da extensão e preencher:
   - **Worker URL**: a URL `wss://...` gerada pelo `wrangler dev`/`deploy`.
   - **Código da sala**: qualquer string combinada entre as duas pessoas.
3. Repetir nas duas instalações (as duas pessoas), abrir
   `music.youtube.com` e testar play/pause/seek de um lado refletindo no
   outro.

## Limitações conhecidas (v1)

- Só 2 conexões simultâneas por sala.
- Sem autenticação — o código da sala é o único controle de acesso.
- Sem histórico de sessões — o estado só existe enquanto o Durable Object
  está ativo.
