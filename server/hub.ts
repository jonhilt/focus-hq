import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerEvent, Snapshot } from '../shared/types';

/** Pushes office events to every open browser tab over a WebSocket at /ws. */
export class Hub {
  private wss: WebSocketServer | null = null;

  attach(server: Server, snapshot: () => Promise<Snapshot>): void {
    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/ws') return; // leave other upgrades (Vite HMR) alone
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.wss!.emit('connection', ws, req));
    });
    this.wss.on('connection', (ws) => {
      void snapshot().then((s) => ws.send(JSON.stringify({ type: 'snapshot', snapshot: s } satisfies ServerEvent)));
    });
  }

  send(event: ServerEvent): void {
    if (!this.wss) return;
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
