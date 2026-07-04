export interface RoomState {
  isPlaying: boolean;
  positionSeconds: number;
  lastUpdate: number;
}

interface IncomingMessage {
  type: "play" | "pause" | "seek" | "sync";
  position: number;
  timestamp: number;
}

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

    if (parsed.type === "seek") {
      const diff = Math.abs(parsed.position - this.currentEstimatedPosition());
      if (diff < POSITION_DIFF_THRESHOLD_SECONDS) return;
    }

    this.state = {
      isPlaying: parsed.type === "pause" ? false : parsed.type === "play" ? true : this.state.isPlaying,
      positionSeconds: parsed.position,
      lastUpdate: Date.now(),
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
        timestamp: this.state.lastUpdate,
      })
    );
  }
}
