import type { ServerWebSocket } from "bun";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WsData {
  type: "probe" | "dashboard";
  agentId?: string;
}

interface AgentState {
  state: string;
  confidence: number;
  reasoning: string;
  logs: Array<{ text: string; type: string }>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.ARGUS_HUB_PORT || "8000");
const agents = new Map<string, AgentState>();
const probes = new Map<string, ServerWebSocket<WsData>>(); // agentId → ws
const dashboards = new Set<ServerWebSocket<WsData>>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function broadcast(msg: string) {
  for (const d of dashboards) d.send(msg);
}

function broadcastJSON(payload: object) {
  broadcast(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

function handleProbeMessage(ws: ServerWebSocket<WsData>, msg: any) {
  // Registration — must be first message from a probe
  if (msg.type === "register") {
    const id = msg.agent_id;
    if (!id) return;
    ws.data.agentId = id;
    probes.set(id, ws);
    agents.set(id, { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [] });
    console.log(`[hub] Probe registered: ${id}`);
    // Notify all dashboards of updated agent roster
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
    agentState.state = msg.data?.agent_state || "PROGRESSING";
    agentState.confidence = msg.data?.confidence_score ?? agentState.confidence;
    agentState.reasoning = msg.data?.reasoning || "";
    broadcastJSON({ type: "update", agent_id: agentId, data: msg.data });
    return;
  }

  if (msg.type === "log_update") {
    agentState.logs.push(msg.log);
    if (agentState.logs.length > 50) agentState.logs.shift();
  }

  // Forward everything else (log_update, terminal_screen_update, frame_update) to dashboards
  broadcast(JSON.stringify(msg));
}

function handleDashboardMessage(_ws: ServerWebSocket<WsData>, msg: any) {
  if (msg.type !== "command") return;

  const probeWs = probes.get(msg.agent_id);
  if (!probeWs) {
    console.warn(`[hub] No probe for agent ${msg.agent_id}`);
    return;
  }

  // Forward command to the probe (action + content for inject)
  probeWs.send(JSON.stringify({
    type: "command",
    action: msg.action,
    content: msg.content,
  }));
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

Bun.serve<WsData>({
  port: PORT,

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
      let payload: any;
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

console.log(`[hub] Argus Hub running on ws://localhost:${PORT}`);
