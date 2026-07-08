export interface RoomState {
  isPlaying: boolean;
  positionSeconds: number;
  lastUpdate: number;
  videoId?: string;
  listId?: string;
}

interface IncomingMessage {
  type: "play" | "pause" | "seek" | "sync" | "track";
  position: number;
  timestamp: number;
  videoId?: string;
  listId?: string;
}

// IDs de vídeo do YouTube são 11 chars [A-Za-z0-9_-]; margem pra variações.
const VIDEO_ID_PATTERN = /^[\w-]{5,20}$/;
// IDs de playlist/rádio (PL..., RDAMVM..., OLAK5uy_...) são mais longos.
const LIST_ID_PATTERN = /^[\w-]{10,80}$/;

const POSITION_DIFF_THRESHOLD_SECONDS = 2;

export class Room {
  private state: RoomState = { isPlaying: false, positionSeconds: 0, lastUpdate: Date.now() };
  private ready: Promise<void>;

  constructor(private ctx: DurableObjectState, private env: unknown) {
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<RoomState>("state");
      if (stored) this.state = stored;
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

    let parsed: IncomingMessage;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    if (parsed.type === "sync") return;

    if (parsed.type === "track") {
      if (typeof parsed.videoId !== "string" || !VIDEO_ID_PATTERN.test(parsed.videoId)) return;
      if (parsed.videoId === this.state.videoId) return;
      const listId =
        typeof parsed.listId === "string" && LIST_ID_PATTERN.test(parsed.listId)
          ? parsed.listId
          : undefined;
      this.state = {
        isPlaying: true,
        positionSeconds: 0,
        lastUpdate: Date.now(),
        videoId: parsed.videoId,
        listId,
      };
      await this.ctx.storage.put("state", this.state);
      const trackPayload = JSON.stringify({
        type: "track",
        videoId: this.state.videoId,
        listId: this.state.listId ?? null,
        position: 0,
        timestamp: this.state.lastUpdate,
      });
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        other.send(trackPayload);
      }
      return;
    }

    if (parsed.type === "seek") {
      const diff = Math.abs(parsed.position - this.currentEstimatedPosition());
      if (diff < POSITION_DIFF_THRESHOLD_SECONDS) return;
    }

    this.state = {
      isPlaying: parsed.type === "pause" ? false : parsed.type === "play" ? true : this.state.isPlaying,
      positionSeconds: parsed.position,
      lastUpdate: Date.now(),
      videoId: this.state.videoId,
      listId: this.state.listId,
    };
    await this.ctx.storage.put("state", this.state);

    const payload = JSON.stringify({
      type: parsed.type,
      position: this.state.positionSeconds,
      timestamp: this.state.lastUpdate,
    });
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      other.send(payload);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // já fechado
    }
  }

  async webSocketError(): Promise<void> {}

  private currentEstimatedPosition(): number {
    if (!this.state.isPlaying) return this.state.positionSeconds;
    const elapsedSeconds = (Date.now() - this.state.lastUpdate) / 1000;
    return this.state.positionSeconds + elapsedSeconds;
  }

  private sendSync(ws: WebSocket): void {
    ws.send(
      JSON.stringify({
        type: "sync",
        position: this.currentEstimatedPosition(),
        isPlaying: this.state.isPlaying,
        videoId: this.state.videoId ?? null,
        listId: this.state.listId ?? null,
        timestamp: this.state.lastUpdate,
      })
    );
  }
}
