(function () {
  "use strict";

  if (!location.hostname.endsWith("music.youtube.com")) {
    // initialization_script roda em toda navegação top-level dessa janela,
    // inclusive nas páginas intermediárias do login (accounts.google.com).
    return;
  }

  const POSITION_DIFF_THRESHOLD_SECONDS = 2;
  const RECONNECT_DELAY_MS = 3000;
  const TRACK_POLL_MS = 1500;
  const VIDEO_ID_PATTERN = /^[\w-]{5,20}$/;

  let socket = null;
  let video = null;
  let isRemoteOrigin = false;
  let reconnectTimer = null;
  let lastVideoId = null;
  let isHost = false;
  let config = window.__YTMS_INITIAL_CONFIG__ || { workerUrl: "", roomCode: "", name: "", clientId: "" };

  function log(...args) {
    console.log("[YT Music Sync]", ...args);
  }

  function findVideoElement(callback) {
    const existing = document.querySelector("video");
    if (existing) {
      callback(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const el = document.querySelector("video");
      if (el) {
        observer.disconnect();
        callback(el);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function connect() {
    if (!config.workerUrl || !config.roomCode) {
      log("sem configuração (workerUrl/roomCode) — abra a janela de configurações");
      return;
    }
    if (socket) {
      socket.close();
    }

    const base = config.workerUrl.replace(/\/$/, "");
    const url = `${base}/room/${encodeURIComponent(config.roomCode)}`;
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      log("conectado à sala", config.roomCode);
      socket.send(
        JSON.stringify({
          type: "hello",
          clientId: config.clientId || "",
          name: config.name || "",
          role: "player",
        })
      );
    });
    socket.addEventListener("message", handleServerMessage);
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => socket && socket.close());
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function sendRaw(obj) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(obj));
  }

  function sendTransport(type, position) {
    // Só o anfitrião controla a reprodução; os demais apenas seguem.
    if (!isHost) return;
    sendRaw({ type, position, timestamp: Date.now() });
  }

  function getCurrentVideoId() {
    if (!location.pathname.startsWith("/watch")) return null;
    return new URLSearchParams(location.search).get("v");
  }

  function getNowPlayingMeta() {
    const bar = document.querySelector("ytmusic-player-bar");
    const title = bar?.querySelector(".title")?.textContent?.trim() || "";
    const artist = bar?.querySelector(".byline")?.textContent?.trim().split("•")[0].trim() || "";
    return { title, artist };
  }

  function applyRemoteTrack(videoId) {
    if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) return;
    if (getCurrentVideoId() === videoId) return;
    log("indo pra música da fila", videoId);
    // Navega direto pro vídeo (sem list): a fila compartilhada é nossa, não a
    // do YT Music. Navegação recarrega a página; o script reinjeta e reconecta.
    location.href = "https://music.youtube.com/watch?v=" + videoId;
  }

  function watchTrackChanges() {
    lastVideoId = getCurrentVideoId();
    setInterval(() => {
      const id = getCurrentVideoId();
      if (id && id !== lastVideoId) {
        lastVideoId = id;
        // Só o anfitrião propaga trocas manuais de música (viram item da fila).
        if (isHost) {
          const meta = getNowPlayingMeta();
          sendRaw({ type: "track", videoId: id, title: meta.title, artist: meta.artist, timestamp: Date.now() });
        }
      }
    }, TRACK_POLL_MS);
  }

  function disableNativeAutoplay() {
    // Best-effort: desliga o "Reprodução automática" do YT Music pra ele não
    // pular pra fila dele. A nossa fila compartilhada é quem avança.
    try {
      const toggle = document.querySelector(
        'ytmusic-player-bar tp-yt-paper-toggle-button[aria-pressed="true"], #autoplay tp-yt-paper-toggle-button[aria-pressed="true"]'
      );
      if (toggle) toggle.click();
    } catch (e) {
      /* ignora */
    }
  }

  function handleServerMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    if (msg.type === "presence") {
      isHost = msg.hostId && config.clientId && msg.hostId === config.clientId;
      return;
    }
    if (msg.type === "queue") {
      return; // a janela do YT Music não renderiza a fila; o painel cuida disso
    }

    // Navegar pra música certa não depende do <video> já existir.
    if (msg.type === "track") {
      applyRemoteTrack(msg.videoId);
      return;
    }
    if (msg.type === "sync") {
      if (typeof msg.hostId !== "undefined") {
        isHost = msg.hostId && config.clientId && msg.hostId === config.clientId;
      }
      if (msg.videoId && getCurrentVideoId() !== msg.videoId) {
        applyRemoteTrack(msg.videoId);
        return;
      }
    }

    if (!video) return;

    isRemoteOrigin = true;
    switch (msg.type) {
      case "sync":
        applyRemotePosition(msg.position, msg.isPlaying);
        break;
      case "play":
        applyRemotePosition(msg.position, true);
        break;
      case "pause":
        applyRemotePosition(msg.position, false);
        break;
      case "seek":
        applyRemotePosition(msg.position, !video.paused);
        break;
    }
    // Os handlers locais (play/pause/seeked) do <video> disparam de forma
    // assíncrona quando aplicamos a mudança acima; libera a flag só depois
    // desse ciclo pra eles verem isRemoteOrigin=true e não reemitirem o evento.
    setTimeout(() => {
      isRemoteOrigin = false;
    }, 0);
  }

  function applyRemotePosition(position, shouldPlay) {
    if (typeof position === "number" && Math.abs(video.currentTime - position) > POSITION_DIFF_THRESHOLD_SECONDS) {
      video.currentTime = position;
    }
    if (shouldPlay && video.paused) {
      video.play().catch(() => {});
    } else if (!shouldPlay && !video.paused) {
      video.pause();
    }
  }

  function attachPlayerListeners(el) {
    video = el;
    video.addEventListener("play", () => {
      if (isRemoteOrigin) return;
      sendTransport("play", video.currentTime);
    });
    video.addEventListener("pause", () => {
      if (isRemoteOrigin) return;
      sendTransport("pause", video.currentTime);
    });
    video.addEventListener("seeked", () => {
      if (isRemoteOrigin) return;
      sendTransport("seek", video.currentTime);
    });
    video.addEventListener("ended", () => {
      // Só o anfitrião comanda o avanço da fila compartilhada.
      if (isHost) sendRaw({ type: "next" });
    });
  }

  // Recebe atualizações de config via WebviewWindow::eval() do lado Rust
  // quando o usuário salva novos valores na janela de configurações.
  window.__ytmsApplyConfig = function (newConfig) {
    config = newConfig || { workerUrl: "", roomCode: "", name: "", clientId: "" };
    connect();
  };

  function boot() {
    findVideoElement(attachPlayerListeners);
    watchTrackChanges();
    setTimeout(disableNativeAutoplay, 4000);
    connect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
