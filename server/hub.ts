import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerEvent, Snapshot } from '../shared/types';
import { flowRecorder } from './flows';

/** Pushes the ship's events to every open browser tab over a WebSocket at /ws. */
export class Hub {
  private wss: WebSocketServer | null = null;

  /**
   * `refuse` says why a connection isn't let in (another site's page, a tagged tailnet device, say), or nothing to let
   * it in. It's asked of every upgrade, Vite's HMR's too, which listens after this and finds a refused one closed.
   */
  attach(server: Server, snapshot: () => Promise<Snapshot>, refuse: (req: IncomingMessage) => string | undefined = () => undefined): void {
    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;
    server.on('upgrade', (req, socket, head) => {
      const why = refuse(req);
      if (why) {
        console.warn(`Refused a connection to ${req.url ?? '/'}: ${why}`);
        return void socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      }
      if (req.url !== '/ws') return; // leave other upgrades (Vite HMR) alone
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    wss.on('connection', (ws) => {
      void snapshot().then((s) => ws.send(JSON.stringify({ type: 'snapshot', snapshot: s } satisfies ServerEvent)));
    });
  }

  send(event: ServerEvent): void {
    if (!this.wss) return;
    flowRecorder?.ws(event.type);
    const data = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  /** `projectId` names the project a toast without an agent is about, so it stays quiet while that project is hidden. */
  toast(level: 'info' | 'success' | 'error', text: string, agentId?: string, projectId?: string): void {
    this.send({ type: 'toast', level, text, agentId, projectId });
  }
}
