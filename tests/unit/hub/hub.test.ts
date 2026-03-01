import { describe, test, expect, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import { createHub, type HubInstance } from "../../../src/hub/hub";

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

    // Agent preserved in map but marked disconnected
    expect(hub.agents.has("dc-test")).toBe(true);
    expect(hub.agents.get("dc-test")?.connected).toBe(false);

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
    expect(agent?.connected).toBe(true);
    expect(agent?.task).toBe("");
    expect(typeof agent?.startTime).toBe("number");

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

  test("register with metadata populates agent fields", async () => {
    hub = createHub(0);

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({
      type: "register",
      agent_id: "meta-01",
      metadata: { task: "Run tests", command: "bun test", start_time: 1700000000000 },
    }));

    await Bun.sleep(50);

    const agent = hub.agents.get("meta-01");
    expect(agent?.task).toBe("Run tests");
    expect(agent?.command).toBe("bun test");
    expect(agent?.startTime).toBe(1700000000000);
    expect(agent?.connected).toBe(true);

    probe.close();
  });

  test("re-register after disconnect restores connection", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // empty init

    // Register, update state, disconnect
    const probe1 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe1);
    probe1.send(JSON.stringify({ type: "register", agent_id: "reconn-01" }));
    await waitForMessage(dash); // init

    probe1.send(JSON.stringify({
      type: "vlm_update",
      data: { agent_state: "STUCK", confidence_score: 30, reasoning: "looping" },
    }));
    await waitForMessage(dash); // vlm update

    probe1.close();
    await waitForMessage(dash); // agent_disconnected

    expect(hub.agents.get("reconn-01")?.connected).toBe(false);
    expect(hub.agents.get("reconn-01")?.state).toBe("STUCK");

    // Re-register from new connection
    const probe2 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe2);
    probe2.send(JSON.stringify({
      type: "register",
      agent_id: "reconn-01",
      metadata: { task: "Resumed work" },
    }));
    const initMsg = await waitForMessage(dash);
    expect(initMsg.type).toBe("init");

    // State preserved, connection restored, metadata updated
    const agent = hub.agents.get("reconn-01");
    expect(agent?.connected).toBe(true);
    expect(agent?.state).toBe("STUCK");
    expect(agent?.task).toBe("Resumed work");

    probe2.close();
    dash.close();
  });

  test("health counts only connected agents", async () => {
    hub = createHub(0);

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "hc-01" }));
    await Bun.sleep(50);

    let res = await fetch(`http://localhost:${hub.server.port}/health`);
    let body = await res.json();
    expect(body.agents).toBe(1);

    probe.close();
    await Bun.sleep(50);

    // Agent still in map but disconnected — health should show 0
    expect(hub.agents.has("hc-01")).toBe(true);
    res = await fetch(`http://localhost:${hub.server.port}/health`);
    body = await res.json();
    expect(body.agents).toBe(0);
  });

  test("init only includes connected agents", async () => {
    hub = createHub(0);

    // Register and disconnect a probe
    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "ghost-01" }));
    await Bun.sleep(50);
    probe.close();
    await Bun.sleep(50);

    // Agent is preserved but disconnected
    expect(hub.agents.has("ghost-01")).toBe(true);

    // New dashboard connects — should NOT see the disconnected agent
    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    const initMsg = await waitForMessage(dash);
    expect(initMsg.type).toBe("init");
    const data = initMsg.data as Record<string, unknown>;
    expect(data["ghost-01"]).toBeUndefined();

    dash.close();
  });

  test("frame_update with frames store writes JPEG and broadcasts", async () => {
    // Create hub with frame storage using a temp directory
    const tmpDir = join(tmpdir(), `argus-hub-frames-${Date.now()}`);
    hub = createHub(0, { dbPath: ":memory:", framePath: tmpDir, frameMode: "persist" });

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // init

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "frame-test" }));
    await waitForMessage(dash); // init

    // Send frame_update with base64 JPEG
    const fakeJpeg = Buffer.from("fake-jpeg-data");
    const base64 = fakeJpeg.toString("base64");
    const ts = Date.now();
    probe.send(JSON.stringify({
      type: "frame_update",
      agent_id: "frame-test",
      frame: base64,
      timestamp: ts,
    }));

    const frameMsg = await waitForMessage(dash);
    expect(frameMsg.type).toBe("frame_update");
    expect(frameMsg.frame).toBe(base64);

    // Verify frame was stored (async write, hub uses its own timestamp)
    await Bun.sleep(200);
    const frames = hub.frames!.getFrames("frame-test");
    expect(frames.length).toBe(1);
    expect(frames[0].agent_id).toBe("frame-test");
    expect(frames[0].timestamp).toBeGreaterThanOrEqual(ts);

    probe.close();
    dash.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
