import { serve } from "bun";

interface AgentState {
  state: string;
  confidence: number;
  reasoning: string;
  logs: any[];
}

const agents = new Map<string, AgentState>();
const dashboards = new Set<any>();
const probes = new Set<any>();

agents.set("A-01", { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [] });

serve({
  port: 8000,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws/probe") {
      const upgraded = server.upgrade(req, { data: { type: "probe" } });
      return upgraded ? undefined : new Response("Upgrade failed", { status: 500 });
    }
    if (url.pathname === "/ws/dashboard") {
      const upgraded = server.upgrade(req, { data: { type: "dashboard" } });
      return upgraded ? undefined : new Response("Upgrade failed", { status: 500 });
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      if (ws.data.type === "probe") {
        probes.add(ws);
        console.log("Probe connected.");
      }
      if (ws.data.type === "dashboard") {
        dashboards.add(ws);
        console.log("Dashboard connected.");
        ws.send(JSON.stringify({ type: "init", data: Object.fromEntries(agents) }));
      }
    },
    message(ws, message) {
      if (ws.data.type === "probe") {
        const payload = JSON.parse(message as string);
        const agentId = payload.agent_id;
        
        if (agentId && !agents.has(agentId)) {
          agents.set(agentId, { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [] });
        }
        const agentState = agents.get(agentId)!;

        if (payload.type === "vlm_update") {
          agentState.state = payload.data.agent_state || "PROGRESSING";
          agentState.confidence = payload.data.confidence_score || 100;
          agentState.reasoning = payload.data.reasoning || "";
          if (payload.data.reasoning) {
            agentState.logs.push({
              id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
              timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
              type: "system",
              text: `[VLM Analysis]: ${payload.data.reasoning}`
            });
            if (agentState.logs.length > 50) agentState.logs.shift();
          }
          
          const dashboardPayload = { type: "update", agent_id: agentId, data: payload.data };
          for (const dashboard of dashboards) dashboard.send(JSON.stringify(dashboardPayload));
          return;
        } else if (payload.type === "log_update") {
          agentState.logs.push(payload.log);
          if (agentState.logs.length > 50) agentState.logs.shift();
        }

        // Broadcast everything from probe to dashboards
        for (const dashboard of dashboards) {
          dashboard.send(message);
        }
      }
    },
    close(ws) {
      if (ws.data.type === "probe") probes.delete(ws);
      if (ws.data.type === "dashboard") dashboards.delete(ws);
    }
  }
});

console.log("Bun Hub Server running on ws://localhost:8000");