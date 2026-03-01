import { describe, test, expect, afterEach } from "bun:test";
import { createHub, type HubInstance } from "../../src/hub/hub";
import { wsUrl, waitForMessage, waitForOpen } from "../helpers";

let hub: HubInstance | null = null;

afterEach(() => {
  hub?.stop();
  hub = null;
});

describe("full pipeline integration", () => {
  test("register → screen update → command → disconnect lifecycle", async () => {
    hub = createHub(0);

    // 1. Connect dashboard, get empty init
    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    const initMsg = await waitForMessage(dash);
    expect(initMsg.type).toBe("init");
    expect(initMsg.data).toEqual({});

    // 2. Connect probe and register
    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "INT-01" }));

    // Dashboard gets updated init with agent
    const initWithAgent = await waitForMessage(dash);
    expect(initWithAgent.type).toBe("init");
    expect((initWithAgent.data as Record<string, unknown>)["INT-01"]).toBeDefined();

    // 3. Probe sends screen update
    probe.send(JSON.stringify({
      type: "terminal_screen_update",
      agent_id: "INT-01",
      screen: "$ bun test\nAll tests passed",
    }));

    const screenMsg = await waitForMessage(dash);
    expect(screenMsg.type).toBe("terminal_screen_update");
    expect(screenMsg.screen).toBe("$ bun test\nAll tests passed");

    // 4. Probe sends log
    probe.send(JSON.stringify({
      type: "log_update",
      agent_id: "INT-01",
      log: { text: "Tests passed", type: "info" },
    }));

    const logMsg = await waitForMessage(dash);
    expect(logMsg.type).toBe("log_update");

    // 5. Dashboard sends command to probe
    dash.send(JSON.stringify({
      type: "command",
      agent_id: "INT-01",
      action: "pause",
    }));

    const cmdMsg = await waitForMessage(probe);
    expect(cmdMsg.type).toBe("command");
    expect(cmdMsg.action).toBe("pause");

    // 6. Dashboard sends inject command
    dash.send(JSON.stringify({
      type: "command",
      agent_id: "INT-01",
      action: "inject",
      content: "try again",
    }));

    const injectMsg = await waitForMessage(probe);
    expect(injectMsg.type).toBe("command");
    expect(injectMsg.action).toBe("inject");
    expect(injectMsg.content).toBe("try again");

    // 7. Probe sends VLM update
    probe.send(JSON.stringify({
      type: "vlm_update",
      data: {
        agent_state: "STUCK",
        confidence_score: 30,
        reasoning: "Build loop detected",
      },
    }));

    const vlmMsg = await waitForMessage(dash);
    expect(vlmMsg.type).toBe("update");
    expect(vlmMsg.agent_id).toBe("INT-01");

    // Verify hub state
    const agentState = hub.agents.get("INT-01");
    expect(agentState?.state).toBe("STUCK");
    expect(agentState?.confidence).toBe(30);

    // 8. Disconnect probe → dashboard gets agent_disconnected
    probe.close();

    const dcMsg = await waitForMessage(dash);
    expect(dcMsg.type).toBe("agent_disconnected");
    expect(dcMsg.agent_id).toBe("INT-01");

    // Verify cleanup
    expect(hub.agents.has("INT-01")).toBe(false);
    expect(hub.probes.has("INT-01")).toBe(false);

    dash.close();
  });

  test("multiple probes register independently", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // empty init

    // Register two probes
    const probe1 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe1);
    probe1.send(JSON.stringify({ type: "register", agent_id: "MULTI-01" }));
    await waitForMessage(dash); // init with MULTI-01

    const probe2 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe2);
    probe2.send(JSON.stringify({ type: "register", agent_id: "MULTI-02" }));

    const initMsg = await waitForMessage(dash); // init with both
    const data = initMsg.data as Record<string, unknown>;
    expect(data["MULTI-01"]).toBeDefined();
    expect(data["MULTI-02"]).toBeDefined();

    // Command routing — send to MULTI-02 specifically
    dash.send(JSON.stringify({ type: "command", agent_id: "MULTI-02", action: "kill" }));

    const cmd = await waitForMessage(probe2);
    expect(cmd.action).toBe("kill");

    // Disconnect one, other stays
    probe1.close();
    const dcMsg = await waitForMessage(dash);
    expect(dcMsg.agent_id).toBe("MULTI-01");

    expect(hub.agents.has("MULTI-01")).toBe(false);
    expect(hub.agents.has("MULTI-02")).toBe(true);

    probe2.close();
    dash.close();
  });

  test("dashboard connects after probes already registered", async () => {
    hub = createHub(0);

    // Register probe first
    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "LATE-DASH" }));

    // Wait for registration to process
    await Bun.sleep(50);

    // Now connect dashboard — should get init with existing agent
    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    const initMsg = await waitForMessage(dash);
    expect(initMsg.type).toBe("init");
    expect((initMsg.data as Record<string, unknown>)["LATE-DASH"]).toBeDefined();

    probe.close();
    dash.close();
  });
});
