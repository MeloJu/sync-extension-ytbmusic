const { invoke } = window.__TAURI__.core;

// Acesso ao http do Tauri é resolvido só na hora da busca — se o plugin não
// estiver disponível, apenas a busca falha; o resto do painel (WS, fila,
// presença, transporte) continua funcionando.
function getTauriFetch() {
  const http = window.__TAURI__ && window.__TAURI__.http;
  if (!http || typeof http.fetch !== "function") {
    throw new Error("plugin http indisponível");
  }
  return http.fetch;
}

// Chave pública do cliente web do YT Music (mesma usada pela lib ytmusicapi).
// Não é segredo — é embutida na própria página do YT Music.
const YTM_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const YTM_CONTEXT = {
  client: { clientName: "WEB_REMIX", clientVersion: "1.20240101.01.00", hl: "pt" },
};

let socket = null;
let config = { workerUrl: "", roomCode: "", name: "", clientId: "" };
let amHost = false;
let isPlaying = false;

const el = (id) => document.getElementById(id);
const connEl = el("conn");

function setConn(text) {
  connEl.textContent = text;
}

// ---------- WebSocket ----------

function connect() {
  if (!config.workerUrl || !config.roomCode) {
    setConn("configure o app (Worker URL + sala) na janela de configurações");
    return;
  }
  if (socket) socket.close();
  const base = config.workerUrl.replace(/\/$/, "");
  socket = new WebSocket(`${base}/room/${encodeURIComponent(config.roomCode)}`);

  socket.addEventListener("open", () => {
    setConn(`sala: ${config.roomCode}`);
    sendRaw({ type: "hello", clientId: config.clientId, name: config.name, role: "panel" });
  });
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", () => {
    setConn("desconectado — tentando reconectar…");
    setTimeout(connect, 3000);
  });
  socket.addEventListener("error", () => socket && socket.close());
}

function sendRaw(obj) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(obj));
}

function onMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch (e) {
    return;
  }
  switch (msg.type) {
    case "sync":
      if (msg.members) renderMembers(msg.members, msg.hostId);
      if (msg.queue) renderQueue(msg.queue, msg.currentItemId);
      isPlaying = !!msg.isPlaying;
      break;
    case "presence":
      renderMembers(msg.members || [], msg.hostId);
      break;
    case "queue":
      renderQueue(msg.items || [], msg.currentItemId);
      break;
    case "play":
      isPlaying = true;
      break;
    case "pause":
      isPlaying = false;
      break;
  }
}

// ---------- Presença ----------

function renderMembers(members, hostId) {
  amHost = hostId && config.clientId && hostId === config.clientId;
  const ul = el("members");
  ul.innerHTML = "";
  if (members.length === 0) {
    ul.innerHTML = '<li class="empty">ninguém ainda</li>';
  } else {
    for (const m of members) {
      const li = document.createElement("li");
      li.className = "member" + (m.isHost ? " host" : "");
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = m.name + (m.clientId === config.clientId ? " (você)" : "");
      li.appendChild(who);
      if (!m.isHost) {
        const btn = document.createElement("button");
        btn.textContent = "tornar anfitrião";
        btn.addEventListener("click", () => sendRaw({ type: "set_host", clientId: m.clientId }));
        li.appendChild(btn);
      }
      ul.appendChild(li);
    }
  }
  updateTransport();
}

function updateTransport() {
  el("prev").disabled = !amHost;
  el("next").disabled = !amHost;
  el("playpause").disabled = !amHost;
  el("hostHint").textContent = amHost
    ? "você é o anfitrião — controla a reprodução"
    : "só o anfitrião controla play/pause/próxima";
}

// ---------- Fila ----------

function renderQueue(items, currentItemId) {
  const ul = el("queue");
  ul.innerHTML = "";
  if (!items || items.length === 0) {
    ul.innerHTML = '<li class="empty">fila vazia</li>';
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "row" + (item.id === currentItemId ? " current" : "");
    const meta = document.createElement("div");
    meta.className = "meta";
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = item.title;
    const a = document.createElement("div");
    a.className = "a";
    a.textContent = [item.artist, item.addedBy ? "· " + item.addedBy : ""].filter(Boolean).join(" ");
    meta.appendChild(t);
    meta.appendChild(a);
    const rm = document.createElement("button");
    rm.className = "act";
    rm.textContent = "remover";
    rm.addEventListener("click", () => sendRaw({ type: "queue_remove", itemId: item.id }));
    li.appendChild(meta);
    li.appendChild(rm);
    ul.appendChild(li);
  }
}

// ---------- Transporte ----------

el("next").addEventListener("click", () => sendRaw({ type: "next" }));
el("prev").addEventListener("click", () => sendRaw({ type: "prev" }));
el("playpause").addEventListener("click", () => {
  sendRaw({ type: isPlaying ? "pause" : "play", position: 0, timestamp: Date.now() });
  isPlaying = !isPlaying;
});

// ---------- Busca (endpoint interno do YT Music) ----------

async function search(query) {
  const tauriFetch = getTauriFetch();
  const resp = await tauriFetch(`https://music.youtube.com/youtubei/v1/search?key=${YTM_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Sem User-Agent de navegador + cookie de consentimento, o Google
      // responde com a página HTML de consentimento em vez do JSON.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Origin: "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
      Cookie: "SOCS=CAI; CONSENT=YES+1",
    },
    body: JSON.stringify({ context: YTM_CONTEXT, query }),
  });
  const data = await resp.json();
  return parseSearchResults(data);
}

function parseSearchResults(data) {
  const out = [];
  const seen = new Set();
  // Percorre a árvore procurando musicResponsiveListItemRenderer com videoId.
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.musicResponsiveListItemRenderer) {
      const item = node.musicResponsiveListItemRenderer;
      const videoId = findVideoId(item);
      if (videoId && !seen.has(videoId)) {
        seen.add(videoId);
        const texts = collectRunsText(item.flexColumns || []);
        out.push({
          videoId,
          title: texts[0] || "(sem título)",
          artist: cleanArtist(texts[1] || ""),
        });
      }
    }
    for (const k in node) walk(node[k]);
  };
  walk(data);
  return out.slice(0, 12);
}

function findVideoId(item) {
  // Vem em playlistItemData.videoId ou no watchEndpoint de algum overlay.
  if (item.playlistItemData && item.playlistItemData.videoId) return item.playlistItemData.videoId;
  let found = null;
  const walk = (n) => {
    if (found || !n || typeof n !== "object") return;
    if (n.watchEndpoint && n.watchEndpoint.videoId) {
      found = n.watchEndpoint.videoId;
      return;
    }
    for (const k in n) walk(n[k]);
  };
  walk(item);
  return found;
}

function cleanArtist(text) {
  // A 2ª coluna vem como "Música • Artista" ou "Vídeo • Artista • 2,6 mi...".
  // Fica com o trecho do meio (o artista), tirando o tipo e as métricas.
  const parts = text.split("•").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return parts[0] || "";
}

function collectRunsText(flexColumns) {
  const texts = [];
  for (const col of flexColumns) {
    const runs = col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    if (runs && runs.length) {
      texts.push(runs.map((r) => r.text).join(""));
    }
  }
  return texts;
}

async function doSearch() {
  const q = el("q").value.trim();
  if (!q) return;
  const results = el("results");
  results.innerHTML = '<li class="empty">buscando…</li>';
  try {
    const items = await search(q);
    results.innerHTML = "";
    if (items.length === 0) {
      results.innerHTML = '<li class="empty">nada encontrado</li>';
      return;
    }
    for (const item of items) {
      const li = document.createElement("li");
      li.className = "row";
      const meta = document.createElement("div");
      meta.className = "meta";
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = item.title;
      const a = document.createElement("div");
      a.className = "a";
      a.textContent = item.artist;
      meta.appendChild(t);
      meta.appendChild(a);
      const add = document.createElement("button");
      add.className = "act";
      add.textContent = "+ fila";
      add.addEventListener("click", () => {
        sendRaw({ type: "queue_add", videoId: item.videoId, title: item.title, artist: item.artist });
        add.textContent = "adicionado";
        add.disabled = true;
      });
      li.appendChild(meta);
      li.appendChild(add);
      results.appendChild(li);
    }
  } catch (e) {
    console.error("[panel] erro na busca", e);
    results.innerHTML = '<li class="empty">erro na busca (tente de novo)</li>';
  }
}

el("searchBtn").addEventListener("click", doSearch);
el("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});

// ---------- Boot ----------

async function boot() {
  config = await invoke("get_config");
  connect();
}
boot();
