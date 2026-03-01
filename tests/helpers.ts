import type { HubInstance } from "../src/hub/hub";

export function wsUrl(hub: HubInstance, path: string): string {
  return `ws://localhost:${hub.server.port}${path}`;
}

export function waitForMessage(ws: WebSocket, timeout = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for message")), timeout);
    ws.addEventListener("message", (e) => {
      clearTimeout(timer);
      resolve(JSON.parse(e.data as string));
    }, { once: true });
  });
}

export function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.addEventListener("open", () => resolve(), { once: true });
  });
}
