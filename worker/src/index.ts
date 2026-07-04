import { Room } from "./room";

export interface Env {
  ROOMS: DurableObjectNamespace;
}

export { Room };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/([^/]+)$/);

    if (!match) {
      return new Response("not found", { status: 404 });
    }

    const roomCode = decodeURIComponent(match[1]);
    const id = env.ROOMS.idFromName(roomCode);
    const stub = env.ROOMS.get(id);

    return stub.fetch(request);
  },
};
