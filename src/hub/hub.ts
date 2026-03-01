import type { Server, ServerWebSocket } from "bun";
import { createDb, type DbInstance } from "./db";

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
  task: string;
  command: string;
  startTime: number;
  lastSeen: number;
  connected: boolean;
}

// ---------------------------------------------------------------------------
// Hub instance type
// ---------------------------------------------------------------------------

export interface HubInstance {
  server: Server<WsData>;
  agents: Map<string, AgentState>;
  probes: Map<string, ServerWebSocket<WsData>>;
  dashboards: Set<ServerWebSocket<WsData>>;
  db: DbInstance | null;
  stop(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHub(port: number, dbPath?: string): HubInstance {
  const agents = new Map<string, AgentState>();
  const probes = new Map<string, ServerWebSocket<WsData>>();
  const dashboards = new Set<ServerWebSocket<WsData>>();
  const startTime = Date.now();
  const db = dbPath !== undefined ? createDb(dbPath) : null;

  // Preload agents from DB (survives restarts)
  if (db) {
    for (const row of db.getAllAgents()) {
      agents.set(row.id, {
        state: row.state,
        confidence: row.confidence,
        reasoning: row.reasoning,
        logs: [],
        task: row.task,
        command: row.command,
        startTime: row.start_time,
        lastSeen: row.last_seen,
        connected: false,
      });
    }
    if (agents.size > 0) {
      console.log(`[hub] Preloaded ${agents.size} agent(s) from DB`);
    }
  }

  function broadcast(msg: string) {
    for (const d of dashboards) d.send(msg);
  }

  function broadcastJSON(payload: object) {
    broadcast(JSON.stringify(payload));
  }

  function connectedAgents(): Map<string, AgentState> {
    const result = new Map<string, AgentState>();
    for (const [id, a] of agents) {
      if (a.connected) result.set(id, a);
    }
    return result;
  }

  function handleProbeMessage(ws: ServerWebSocket<WsData>, msg: Record<string, unknown>) {
    if (msg.type === "register") {
      const id = msg.agent_id as string | undefined;
      if (!id) return;
      ws.data.agentId = id;
      probes.set(id, ws);
      const now = Date.now();
      const metadata = msg.metadata as Record<string, unknown> | undefined;
      const existing = agents.get(id);
      if (existing) {
        // Re-register: preserve state, update connection + metadata
        existing.connected = true;
        existing.lastSeen = now;
        if (metadata?.task) existing.task = metadata.task as string;
        if (metadata?.command) existing.command = metadata.command as string;
        if (metadata?.start_time) existing.startTime = metadata.start_time as number;
      } else {
        agents.set(id, {
          state: "PROGRESSING",
          confidence: 100,
          reasoning: "",
          logs: [],
          task: (metadata?.task as string) || "",
          command: (metadata?.command as string) || "",
          startTime: (metadata?.start_time as number) || now,
          lastSeen: now,
          connected: true,
        });
      }
      // Persist to DB
      const a = agents.get(id)!;
      db?.insertAgent(id, a.state, a.confidence, a.reasoning, a.task, a.command, a.startTime, a.lastSeen);

      console.log(`[hub] Probe registered: ${id}`);
      broadcastJSON({ type: "init", data: Object.fromEntries(connectedAgents()) });
      return;
    }

    const agentId = ws.data.agentId;
    if (!agentId) {
      console.warn("[hub] Probe sent data before registering");
      return;
    }

    const agentState = agents.get(agentId);
    if (!agentState) return;
    agentState.lastSeen = Date.now();

    if (msg.type === "vlm_update") {
      const data = msg.data as Record<string, unknown> | undefined;
      agentState.state = (data?.agent_state as string) || "PROGRESSING";
      agentState.confidence = (data?.confidence_score as number) ?? agentState.confidence;
      agentState.reasoning = (data?.reasoning as string) || "";
      const now = Date.now();
      db?.insertVlmEvent(agentId, agentState.state, agentState.confidence, agentState.reasoning, now);
      db?.updateAgentState(agentId, agentState.state, agentState.confidence, agentState.reasoning, now);
      broadcastJSON({ type: "update", agent_id: agentId, data: msg.data });
      return;
    }

    if (msg.type === "log_update") {
      const log = msg.log as { text: string; type: string };
      agentState.logs.push(log);
      if (agentState.logs.length > 50) agentState.logs.shift();
      db?.insertLog(agentId, log.text, log.type, Date.now());
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
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({
          status: "ok",
          agents: connectedAgents().size,
          dashboards: dashboards.size,
          uptime: Math.floor((Date.now() - startTime) / 1000),
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // REST API (requires DB)
      if (db && url.pathname === "/api/agents" && req.method === "GET") {
        return Response.json(db.getAllAgents());
      }

      const historyMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/history$/);
      if (db && historyMatch && req.method === "GET") {
        const agentId = decodeURIComponent(historyMatch[1]);
        const limit = parseInt(url.searchParams.get("limit") || "100");
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const sinceRaw = url.searchParams.get("since");
        const since = sinceRaw ? parseInt(sinceRaw) : undefined;
        return Response.json(db.getAgentHistory(agentId, { limit, offset, since }));
      }

      const logsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/logs$/);
      if (db && logsMatch && req.method === "GET") {
        const agentId = decodeURIComponent(logsMatch[1]);
        const limit = parseInt(url.searchParams.get("limit") || "100");
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const sinceRaw = url.searchParams.get("since");
        const since = sinceRaw ? parseInt(sinceRaw) : undefined;
        const type = url.searchParams.get("type") || undefined;
        return Response.json(db.getAgentLogs(agentId, { limit, offset, since, type }));
      }

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
          ws.send(JSON.stringify({ type: "init", data: Object.fromEntries(connectedAgents()) }));
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
          const agent = agents.get(id);
          if (agent) {
            agent.connected = false;
            agent.lastSeen = Date.now();
          }
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
    db,
    stop() {
      server.stop(true);
      db?.close();
    },
  };

  return instance;
}

// ---------------------------------------------------------------------------
// Top-level — only when run directly
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const PORT = parseInt(process.env.ARGUS_HUB_PORT || "8000");
  const DB_PATH = process.env.ARGUS_DB_PATH || undefined;
  const hub = createHub(PORT, DB_PATH);
  console.log(`[hub] Argus Hub running on ws://localhost:${PORT}`);
  if (DB_PATH) console.log(`[hub] SQLite persistence: ${DB_PATH}`);

  function shutdown() {
    console.log("[hub] Shutting down...");
    hub.stop();
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
