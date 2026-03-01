import type { Server, ServerWebSocket } from "bun";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WsData {
  type: "probe" | "dashboard";
  agentId?: string;
}

export interface AgentState {
  state: string;
  confidence: number;
  reasoning: string;
  logs: Array<{ text: string; type: string }>;
}

// ---------------------------------------------------------------------------
// Hub instance type
// ---------------------------------------------------------------------------

export interface HubInstance {
  server: Server<WsData>;
  agents: Map<string, AgentState>;
  probes: Map<string, ServerWebSocket<WsData>>;
  dashboards: Set<ServerWebSocket<WsData>>;
  stop(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHub(port: number): HubInstance {
  const agents = new Map<string, AgentState>();
  const probes = new Map<string, ServerWebSocket<WsData>>();
  const dashboards = new Set<ServerWebSocket<WsData>>();

  function broadcast(msg: string) {
    for (const d of dashboards) d.send(msg);
  }

  function broadcastJSON(payload: object) {
    broadcast(JSON.stringify(payload));
  }

  function handleProbeMessage(ws: ServerWebSocket<WsData>, msg: Record<string, unknown>) {
    if (msg.type === "register") {
      const id = msg.agent_id as string | undefined;
      if (!id) return;
      ws.data.agentId = id;
      probes.set(id, ws);
      agents.set(id, { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [] });
      console.log(`[hub] Probe registered: ${id}`);
      broadcastJSON({ type: "init", data: Object.fromEntries(agents) });
      return;
    }

    const agentId = ws.data.agentId;
    if (!agentId) {
      console.warn("[hub] Probe sent data before registering");
      return;
    }

    const agentState = agents.get(agentId);
    if (!agentState) return;

    if (msg.type === "vlm_update") {
      const data = msg.data as Record<string, unknown> | undefined;
      agentState.state = (data?.agent_state as string) || "PROGRESSING";
      agentState.confidence = (data?.confidence_score as number) ?? agentState.confidence;
      agentState.reasoning = (data?.reasoning as string) || "";
      broadcastJSON({ type: "update", agent_id: agentId, data: msg.data });
      return;
    }

    if (msg.type === "log_update") {
      const log = msg.log as { text: string; type: string };
      agentState.logs.push(log);
      if (agentState.logs.length > 50) agentState.logs.shift();
    }

    broadcast(JSON.stringify(msg));
  }

  function handleDashboardMessage(_ws: ServerWebSocket<WsData>, msg: Record<string, unknown>) {
    if (msg.type !== "command") return;

    const probeWs = probes.get(msg.agent_id as string);
    if (!probeWs) {
      console.warn(`[hub] No probe for agent ${msg.agent_id}`);
      return;
    }

    probeWs.send(JSON.stringify({
      type: "command",
      action: msg.action,
      content: msg.content,
    }));
  }

  const server = Bun.serve<WsData>({
    port,

    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws/probe") {
        return server.upgrade(req, { data: { type: "probe" } as WsData })
          ? undefined
          : new Response("Upgrade failed", { status: 500 });
      }
      if (url.pathname === "/ws/dashboard") {
        return server.upgrade(req, { data: { type: "dashboard" } as WsData })
          ? undefined
          : new Response("Upgrade failed", { status: 500 });
      }
      return new Response("Argus Hub", { status: 200 });
    },

    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        if (ws.data.type === "dashboard") {
          dashboards.add(ws);
          ws.send(JSON.stringify({ type: "init", data: Object.fromEntries(agents) }));
          console.log("[hub] Dashboard connected");
        }
        if (ws.data.type === "probe") {
          console.log("[hub] Probe connected (awaiting registration)");
        }
      },

      message(ws: ServerWebSocket<WsData>, raw) {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw as string);
        } catch {
          console.error("[hub] Invalid JSON from", ws.data.type);
          return;
        }

        if (ws.data.type === "probe") handleProbeMessage(ws, payload);
        else if (ws.data.type === "dashboard") handleDashboardMessage(ws, payload);
      },

      close(ws: ServerWebSocket<WsData>) {
        if (ws.data.type === "dashboard") {
          dashboards.delete(ws);
          console.log("[hub] Dashboard disconnected");
        }
        if (ws.data.type === "probe" && ws.data.agentId) {
          const id = ws.data.agentId;
          probes.delete(id);
          agents.delete(id);
          console.log(`[hub] Probe disconnected: ${id}`);
          broadcastJSON({ type: "agent_disconnected", agent_id: id });
        }
      },
    },
  });

  const instance: HubInstance = {
    server,
    agents,
    probes,
    dashboards,
    stop() {
      server.stop(true);
    },
  };

  return instance;
}

// ---------------------------------------------------------------------------
// Top-level — only when run directly
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const PORT = parseInt(process.env.ARGUS_HUB_PORT || "8000");
  createHub(PORT);
  console.log(`[hub] Argus Hub running on ws://localhost:${PORT}`);
}
