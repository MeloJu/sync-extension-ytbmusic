(function () {
  "use strict";

  const browserAPI = typeof browser !== "undefined" ? browser : chrome;
  const POSITION_DIFF_THRESHOLD_SECONDS = 2;
  const RECONNECT_DELAY_MS = 3000;
  const TRACK_POLL_MS = 1500;
  const VIDEO_ID_PATTERN = /^[\w-]{5,20}$/;

  let socket = null;
  let video = null;
  let isRemoteOrigin = false;
  let reconnectTimer = null;
  let lastVideoId = null;
  let config = { workerUrl: "", roomCode: "" };

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
      log("sem configuração (workerUrl/roomCode) — abra o popup da extensão");
      return;
    }
    if (socket) {
      socket.close();
    }

    const base = config.workerUrl.replace(/\/$/, "");
    const url = `${base}/room/${encodeURIComponent(config.roomCode)}`;
    socket = new WebSocket(url);

    socket.addEventListener("open", () => log("conectado à sala", config.roomCode));
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

  function send(type, position, videoId, listId) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const msg = { type, position, timestamp: Date.now() };
    if (videoId) msg.videoId = videoId;
    if (listId) msg.listId = listId;
    socket.send(JSON.stringify(msg));
  }

  function getCurrentVideoId() {
    if (!location.pathname.startsWith("/watch")) return null;
    return new URLSearchParams(location.search).get("v");
  }

  function getCurrentListId() {
    if (!location.pathname.startsWith("/watch")) return null;
    return new URLSearchParams(location.search).get("list");
  }

  function applyRemoteTrack(videoId, listId) {
    if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) return;
    if (getCurrentVideoId() === videoId) return;
    log("trocando pra música remota", videoId);
    // Levar o list junto faz os dois lados ganharem a MESMA fila (rádios do
    // YT Music são determinísticas por list id). Navegação recarrega a
    // página; o content script reinjeta, reconecta e recebe um sync novo.
    let url = "https://music.youtube.com/watch?v=" + videoId;
    if (listId && /^[\w-]{10,80}$/.test(listId)) {
      url += "&list=" + listId;
    }
    location.href = url;
  }

  function watchTrackChanges() {
    lastVideoId = getCurrentVideoId();
    setInterval(() => {
      const id = getCurrentVideoId();
      if (id && id !== lastVideoId) {
        lastVideoId = id;
        send("track", 0, id, getCurrentListId());
      }
    }, TRACK_POLL_MS);
  }

  function handleServerMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    // Sync de faixa acontece antes do check de <video>: navegar pra música
    // certa não depende do player já existir (ex: outro lado na homepage).
    if (msg.type === "track") {
      applyRemoteTrack(msg.videoId, msg.listId);
      return;
    }
    if (msg.type === "sync" && msg.videoId && getCurrentVideoId() !== msg.videoId) {
      applyRemoteTrack(msg.videoId, msg.listId);
      return;
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
      send("play", video.currentTime);
    });
    video.addEventListener("pause", () => {
      if (isRemoteOrigin) return;
      send("pause", video.currentTime);
    });
    video.addEventListener("seeked", () => {
      if (isRemoteOrigin) return;
      send("seek", video.currentTime);
    });
  }

  function loadConfigAndStart() {
    browserAPI.storage.local.get(["workerUrl", "roomCode"]).then((stored) => {
      config = { workerUrl: stored.workerUrl || "", roomCode: stored.roomCode || "" };
      connect();
    });
  }

  browserAPI.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes.workerUrl && !changes.roomCode) return;
    if (changes.workerUrl) config.workerUrl = changes.workerUrl.newValue || "";
    if (changes.roomCode) config.roomCode = changes.roomCode.newValue || "";
    connect();
  });

  findVideoElement(attachPlayerListeners);
  watchTrackChanges();
  loadConfigAndStart();
})();
