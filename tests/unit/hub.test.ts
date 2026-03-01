import { describe, test, expect, afterEach } from "bun:test";
import { createHub, type HubInstance } from "../../hub";

let hub: HubInstance | null = null;

afterEach(() => {
  hub?.stop();
  hub = null;
});

function wsUrl(hub: HubInstance, path: string): string {
  return `ws://localhost:${hub.server.port}${path}`;
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (e) => {
      resolve(JSON.parse(e.data as string));
    }, { once: true });
  });
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.addEventListener("open", () => resolve(), { once: true });
  });
}

describe("createHub", () => {
  test("starts on specified port", () => {
    hub = createHub(0); // random port
    expect(hub.server.port).toBeGreaterThan(0);
  });

  test("responds 200 on root HTTP", async () => {
    hub = createHub(0);
    const res = await fetch(`http://localhost:${hub.server.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Argus Hub");
  });

  test("dashboard receives init on connect", async () => {
    hub = createHub(0);
    const ws = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe("init");
    expect(msg.data).toEqual({});
    ws.close();
  });

  test("probe register triggers init broadcast to dashboards", async () => {
    hub = createHub(0);

    // Connect dashboard
    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // consume initial empty init

    // Connect and register probe
    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "test-01" }));

    // Dashboard should receive updated init
    const msg = await waitForMessage(dash);
    expect(msg.type).toBe("init");
    const data = msg.data as Record<string, unknown>;
    expect(data["test-01"]).toBeDefined();

    probe.close();
    dash.close();
  });

  test("hub routes command from dashboard to probe", async () => {
    hub = createHub(0);

    // Connect and register probe
    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "cmd-test" }));

    // Connect dashboard
    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // init

    // Send command from dashboard
    dash.send(JSON.stringify({ type: "command", agent_id: "cmd-test", action: "pause" }));

    // Probe should receive it
    const cmd = await waitForMessage(probe);
    expect(cmd.type).toBe("command");
    expect(cmd.action).toBe("pause");

    probe.close();
    dash.close();
  });

  test("probe disconnect sends agent_disconnected to dashboards", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // init

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "dc-test" }));
    await waitForMessage(dash); // init with agent

    // Now disconnect probe
    probe.close();

    const msg = await waitForMessage(dash);
    expect(msg.type).toBe("agent_disconnected");
    expect(msg.agent_id).toBe("dc-test");

    expect(hub.agents.has("dc-test")).toBe(false);

    dash.close();
  });

  test("vlm_update updates agent state and broadcasts", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // init

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "vlm-test" }));
    await waitForMessage(dash); // init

    // Send VLM update from probe
    probe.send(JSON.stringify({
      type: "vlm_update",
      data: { agent_state: "STUCK", confidence_score: 50, reasoning: "stuck in loop" },
    }));

    const update = await waitForMessage(dash);
    expect(update.type).toBe("update");
    expect(update.agent_id).toBe("vlm-test");

    const agentState = hub.agents.get("vlm-test");
    expect(agentState?.state).toBe("STUCK");
    expect(agentState?.confidence).toBe(50);

    probe.close();
    dash.close();
  });

  test("forwards log_update and terminal_screen_update to dashboards", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // init

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "fwd-test" }));
    await waitForMessage(dash); // init

    // Send log
    probe.send(JSON.stringify({
      type: "log_update",
      agent_id: "fwd-test",
      log: { text: "hello", type: "info" },
    }));

    const logMsg = await waitForMessage(dash);
    expect(logMsg.type).toBe("log_update");

    // Send screen update
    probe.send(JSON.stringify({
      type: "terminal_screen_update",
      agent_id: "fwd-test",
      screen: "$ npm test",
    }));

    const screenMsg = await waitForMessage(dash);
    expect(screenMsg.type).toBe("terminal_screen_update");

    probe.close();
    dash.close();
  });

  test("ignores probe messages before registration", async () => {
    hub = createHub(0);

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);

    // Send data without registering first
    probe.send(JSON.stringify({
      type: "log_update",
      agent_id: "no-reg",
      log: { text: "should be ignored", type: "info" },
    }));

    // Give it a moment to process
    await Bun.sleep(50);

    // No agent should be registered
    expect(hub.agents.size).toBe(0);

    probe.close();
  });

  test("ignores register without agent_id", async () => {
    hub = createHub(0);

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register" })); // no agent_id

    await Bun.sleep(50);
    expect(hub.agents.size).toBe(0);

    probe.close();
  });

  test("re-register preserves existing agent state", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // empty init

    // Register probe and update state
    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "rereg-01" }));
    await waitForMessage(dash); // init

    probe.send(JSON.stringify({
      type: "vlm_update",
      data: { agent_state: "STUCK", confidence_score: 30, reasoning: "looping" },
    }));
    await waitForMessage(dash); // vlm update

    // Verify state before re-register
    expect(hub.agents.get("rereg-01")?.state).toBe("STUCK");

    // Simulate re-registration (same probe, same ID)
    probe.send(JSON.stringify({ type: "register", agent_id: "rereg-01" }));
    const initMsg = await waitForMessage(dash);
    expect(initMsg.type).toBe("init");

    // State should be preserved, not reset to PROGRESSING
    const agent = hub.agents.get("rereg-01");
    expect(agent?.state).toBe("STUCK");
    expect(agent?.confidence).toBe(30);

    probe.close();
    dash.close();
  });

  test("new agent registration creates fresh state", async () => {
    hub = createHub(0);

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "new-agent" }));

    await Bun.sleep(50);

    const agent = hub.agents.get("new-agent");
    expect(agent?.state).toBe("PROGRESSING");
    expect(agent?.confidence).toBe(100);
    expect(agent?.logs).toEqual([]);

    probe.close();
  });

  test("GET /health returns status with agent/dashboard counts", async () => {
    hub = createHub(0);

    // No agents yet
    let res = await fetch(`http://localhost:${hub.server.port}/health`);
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.agents).toBe(0);
    expect(body.dashboards).toBe(0);
    expect(typeof body.uptime).toBe("number");

    // Register a probe and connect a dashboard
    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "health-test" }));

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // init

    await Bun.sleep(50);

    res = await fetch(`http://localhost:${hub.server.port}/health`);
    body = await res.json();
    expect(body.agents).toBe(1);
    expect(body.dashboards).toBe(1);

    probe.close();
    dash.close();
  });
});
