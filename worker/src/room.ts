interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  addedBy: string;
}

export interface RoomState {
  hostId: string | null;
  queue: QueueItem[];
  currentItemId: string | null;
  isPlaying: boolean;
  positionSeconds: number;
  lastUpdate: number;
  videoId?: string;
  listId?: string;
}

interface Member {
  clientId: string;
  name: string;
  role: "player" | "panel";
}

interface IncomingMessage {
  type:
    | "hello"
    | "play"
    | "pause"
    | "seek"
    | "sync"
    | "track"
    | "queue_add"
    | "queue_remove"
    | "set_host"
    | "next"
    | "prev";
  position?: number;
  timestamp?: number;
  videoId?: string;
  listId?: string;
  title?: string;
  artist?: string;
  itemId?: string;
  clientId?: string;
  name?: string;
  role?: "player" | "panel";
}

// IDs de vídeo do YouTube são 11 chars [A-Za-z0-9_-]; margem pra variações.
const VIDEO_ID_PATTERN = /^[\w-]{5,20}$/;
// IDs de playlist/rádio (PL..., RDAMVM..., OLAK5uy_...) são mais longos.
const LIST_ID_PATTERN = /^[\w-]{10,80}$/;
const CLIENT_ID_PATTERN = /^[\w-]{6,64}$/;

const POSITION_DIFF_THRESHOLD_SECONDS = 2;
const MAX_QUEUE = 200;

function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

export class Room {
  private state: RoomState = {
    hostId: null,
    queue: [],
    currentItemId: null,
    isPlaying: false,
    positionSeconds: 0,
    lastUpdate: Date.now(),
  };
  private ready: Promise<void>;

  constructor(private ctx: DurableObjectState, private env: unknown) {
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<RoomState>("state");
      if (stored) this.state = { ...this.state, ...stored };
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    this.sendSync(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    let msg: IncomingMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    switch (msg.type) {
      case "hello":
        return this.handleHello(ws, msg);
      case "queue_add":
        return this.handleQueueAdd(ws, msg);
      case "queue_remove":
        return this.handleQueueRemove(msg);
      case "set_host":
        return this.handleSetHost(msg);
      case "next":
        return this.handleAdvance(ws, 1);
      case "prev":
        return this.handleAdvance(ws, -1);
      case "track":
        return this.handleTrack(ws, msg);
      case "play":
      case "pause":
      case "seek":
        return this.handleTransport(ws, msg);
      case "sync":
        return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // já fechado
    }
    // A conexão que está fechando ainda aparece em getWebSockets() aqui;
    // recalcular presença/host ignorando-a.
    await this.recomputeAfterLeave(ws);
  }

  async webSocketError(): Promise<void> {}

  // --- Handlers ---

  private handleHello(ws: WebSocket, msg: IncomingMessage): void {
    const clientId = msg.clientId;
    if (typeof clientId !== "string" || !CLIENT_ID_PATTERN.test(clientId)) return;
    const member: Member = {
      clientId,
      name: sanitizeText(msg.name, 40) || "Anônimo",
      role: msg.role === "panel" ? "panel" : "player",
    };
    ws.serializeAttachment(member);

    // Primeiro membro (nenhum host ainda) vira host.
    if (!this.state.hostId) {
      this.state.hostId = clientId;
      void this.persist();
    }

    this.sendSync(ws);
    this.broadcastPresence();
  }

  private handleQueueAdd(ws: WebSocket, msg: IncomingMessage): void {
    if (typeof msg.videoId !== "string" || !VIDEO_ID_PATTERN.test(msg.videoId)) return;
    if (this.state.queue.length >= MAX_QUEUE) return;
    const me = this.memberOf(ws);
    const item: QueueItem = {
      id: crypto.randomUUID(),
      videoId: msg.videoId,
      title: sanitizeText(msg.title, 200) || "(sem título)",
      artist: sanitizeText(msg.artist, 200),
      addedBy: me?.name ?? "Anônimo",
    };
    this.state.queue.push(item);
    // Se nada tocando ainda, essa vira a música atual.
    if (!this.state.currentItemId) {
      this.state.currentItemId = item.id;
      this.setCurrentTrack(item);
      this.broadcastTrack(item);
    }
    void this.persist();
    this.broadcastQueue();
  }

  private handleQueueRemove(msg: IncomingMessage): void {
    if (typeof msg.itemId !== "string") return;
    const idx = this.state.queue.findIndex((q) => q.id === msg.itemId);
    if (idx === -1) return;
    const wasCurrent = this.state.queue[idx].id === this.state.currentItemId;
    this.state.queue.splice(idx, 1);
    if (wasCurrent) {
      const next = this.state.queue[idx] ?? this.state.queue[idx - 1] ?? null;
      this.state.currentItemId = next?.id ?? null;
      if (next) {
        this.setCurrentTrack(next);
        this.broadcastTrack(next);
      }
    }
    void this.persist();
    this.broadcastQueue();
  }

  private handleSetHost(msg: IncomingMessage): void {
    const target = msg.clientId;
    if (typeof target !== "string") return;
    if (!this.presentClientIds().has(target)) return;
    this.state.hostId = target;
    void this.persist();
    this.broadcastPresence();
  }

  private handleAdvance(ws: WebSocket, direction: 1 | -1): void {
    if (!this.isHost(ws)) return;
    if (this.state.queue.length === 0) return;
    const curIdx = this.state.queue.findIndex((q) => q.id === this.state.currentItemId);
    const nextIdx = curIdx === -1 ? 0 : curIdx + direction;
    if (nextIdx < 0 || nextIdx >= this.state.queue.length) return;
    const item = this.state.queue[nextIdx];
    this.state.currentItemId = item.id;
    this.setCurrentTrack(item);
    void this.persist();
    this.broadcastTrack(item);
    this.broadcastQueue();
  }

  private handleTrack(ws: WebSocket, msg: IncomingMessage): void {
    if (!this.isHost(ws)) return;
    if (typeof msg.videoId !== "string" || !VIDEO_ID_PATTERN.test(msg.videoId)) return;
    if (msg.videoId === this.state.videoId) return;
    const me = this.memberOf(ws);
    const listId =
      typeof msg.listId === "string" && LIST_ID_PATTERN.test(msg.listId) ? msg.listId : undefined;
    // Música tocada manualmente pelo host entra na fila e vira a atual.
    const item: QueueItem = {
      id: crypto.randomUUID(),
      videoId: msg.videoId,
      title: sanitizeText(msg.title, 200) || "(tocando agora)",
      artist: sanitizeText(msg.artist, 200),
      addedBy: me?.name ?? "Anônimo",
    };
    this.state.queue.push(item);
    this.state.currentItemId = item.id;
    this.state.isPlaying = true;
    this.state.positionSeconds = 0;
    this.state.lastUpdate = Date.now();
    this.state.videoId = msg.videoId;
    this.state.listId = listId;
    void this.persist();
    this.broadcastTrack(item);
    this.broadcastQueue();
  }

  private handleTransport(ws: WebSocket, msg: IncomingMessage): void {
    const position = typeof msg.position === "number" ? msg.position : 0;

    // Compat: conexões antigas (extensão) sem hello/host — retransmite direto.
    const hasHost = this.state.hostId !== null;
    if (hasHost && !this.isHost(ws)) return;

    if (msg.type === "seek") {
      const diff = Math.abs(position - this.currentEstimatedPosition());
      if (diff < POSITION_DIFF_THRESHOLD_SECONDS) return;
    }

    this.state.isPlaying = msg.type === "pause" ? false : msg.type === "play" ? true : this.state.isPlaying;
    this.state.positionSeconds = position;
    this.state.lastUpdate = Date.now();
    void this.persist();

    const payload = JSON.stringify({ type: msg.type, position, timestamp: this.state.lastUpdate });
    this.broadcastExcept(ws, payload);
  }

  // --- Helpers de estado ---

  private setCurrentTrack(item: QueueItem): void {
    this.state.videoId = item.videoId;
    this.state.listId = undefined;
    this.state.isPlaying = true;
    this.state.positionSeconds = 0;
    this.state.lastUpdate = Date.now();
  }

  private async recomputeAfterLeave(closing: WebSocket): Promise<void> {
    const present = this.presentClientIds(closing);
    if (this.state.hostId && !present.has(this.state.hostId)) {
      this.state.hostId = present.size > 0 ? [...present][0] : null;
      await this.persist();
    }
    this.broadcastPresence(closing);
  }

  private memberOf(ws: WebSocket): Member | null {
    return (ws.deserializeAttachment() as Member | null) ?? null;
  }

  private isHost(ws: WebSocket): boolean {
    const me = this.memberOf(ws);
    return !!me && me.clientId === this.state.hostId;
  }

  private presentClientIds(exclude?: WebSocket): Set<string> {
    const ids = new Set<string>();
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === exclude) continue;
      const m = this.memberOf(sock);
      if (m) ids.add(m.clientId);
    }
    return ids;
  }

  private members(exclude?: WebSocket): Member[] {
    const seen = new Map<string, Member>();
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === exclude) continue;
      const m = this.memberOf(sock);
      if (m && !seen.has(m.clientId)) seen.set(m.clientId, m);
    }
    return [...seen.values()];
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  private currentEstimatedPosition(): number {
    if (!this.state.isPlaying) return this.state.positionSeconds;
    const elapsedSeconds = (Date.now() - this.state.lastUpdate) / 1000;
    return this.state.positionSeconds + elapsedSeconds;
  }

  // --- Envio ---

  private broadcastExcept(ws: WebSocket, payload: string): void {
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      try {
        other.send(payload);
      } catch {
        // conexão morta; ignora
      }
    }
  }

  private broadcastAll(payload: string, exclude?: WebSocket): void {
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === exclude) continue;
      try {
        sock.send(payload);
      } catch {
        // ignora
      }
    }
  }

  private broadcastTrack(item: QueueItem): void {
    this.broadcastAll(
      JSON.stringify({
        type: "track",
        videoId: item.videoId,
        listId: null,
        position: 0,
        timestamp: this.state.lastUpdate,
      })
    );
  }

  private broadcastQueue(exclude?: WebSocket): void {
    this.broadcastAll(
      JSON.stringify({
        type: "queue",
        items: this.state.queue,
        currentItemId: this.state.currentItemId,
      }),
      exclude
    );
  }

  private broadcastPresence(exclude?: WebSocket): void {
    const members = this.members(exclude).map((m) => ({
      clientId: m.clientId,
      name: m.name,
      isHost: m.clientId === this.state.hostId,
    }));
    this.broadcastAll(
      JSON.stringify({ type: "presence", members, hostId: this.state.hostId }),
      exclude
    );
  }

  private sendSync(ws: WebSocket): void {
    const members = this.members().map((m) => ({
      clientId: m.clientId,
      name: m.name,
      isHost: m.clientId === this.state.hostId,
    }));
    ws.send(
      JSON.stringify({
        type: "sync",
        position: this.currentEstimatedPosition(),
        isPlaying: this.state.isPlaying,
        videoId: this.state.videoId ?? null,
        listId: this.state.listId ?? null,
        queue: this.state.queue,
        currentItemId: this.state.currentItemId,
        members,
        hostId: this.state.hostId,
        timestamp: this.state.lastUpdate,
      })
    );
  }
}
