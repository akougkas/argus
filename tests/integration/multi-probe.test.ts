import { describe, test, expect, afterEach } from "bun:test";
import { createHub, type HubInstance } from "../../hub";
import { wsUrl, waitForMessage, waitForOpen } from "../helpers";

let hub: HubInstance | null = null;

afterEach(() => {
  hub?.stop();
  hub = null;
});

describe("multi-probe orchestration", () => {
  test("interleaved screen updates arrive with correct agent_id", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // empty init

    const probe1 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe1);
    probe1.send(JSON.stringify({ type: "register", agent_id: "A-01" }));
    await waitForMessage(dash); // init

    const probe2 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe2);
    probe2.send(JSON.stringify({ type: "register", agent_id: "A-02" }));
    await waitForMessage(dash); // init

    // Interleave screen updates
    probe1.send(JSON.stringify({
      type: "terminal_screen_update", agent_id: "A-01", screen: "screen from A-01",
    }));
    probe2.send(JSON.stringify({
      type: "terminal_screen_update", agent_id: "A-02", screen: "screen from A-02",
    }));

    const msg1 = await waitForMessage(dash);
    const msg2 = await waitForMessage(dash);

    const screens = [msg1, msg2].sort((a, b) =>
      (a.agent_id as string).localeCompare(b.agent_id as string)
    );
    expect(screens[0].agent_id).toBe("A-01");
    expect(screens[0].screen).toBe("screen from A-01");
    expect(screens[1].agent_id).toBe("A-02");
    expect(screens[1].screen).toBe("screen from A-02");

    probe1.close(); probe2.close(); dash.close();
  });

  test("command to A-01 does NOT arrive at A-02", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // init

    const probe1 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe1);
    probe1.send(JSON.stringify({ type: "register", agent_id: "ISO-01" }));
    await waitForMessage(dash); // init

    const probe2 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe2);
    probe2.send(JSON.stringify({ type: "register", agent_id: "ISO-02" }));
    await waitForMessage(dash); // init

    // Send command to ISO-01 only
    dash.send(JSON.stringify({ type: "command", agent_id: "ISO-01", action: "pause" }));

    // Probe1 should receive it
    const cmd = await waitForMessage(probe1);
    expect(cmd.action).toBe("pause");

    // Probe2 should NOT receive anything (timeout expected)
    await expect(waitForMessage(probe2, 200)).rejects.toThrow("Timeout");

    probe1.close(); probe2.close(); dash.close();
  });

  test("probe disconnect and re-register — dashboard gets correct sequence", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // empty init

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "RECON-01" }));
    await waitForMessage(dash); // init with RECON-01

    // Send VLM state
    probe.send(JSON.stringify({
      type: "vlm_update",
      data: { agent_state: "STUCK", confidence_score: 40, reasoning: "build loop" },
    }));
    await waitForMessage(dash); // vlm update

    // Disconnect
    probe.close();
    const dcMsg = await waitForMessage(dash);
    expect(dcMsg.type).toBe("agent_disconnected");
    expect(dcMsg.agent_id).toBe("RECON-01");

    // Reconnect with new WS
    const probe2 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe2);
    probe2.send(JSON.stringify({ type: "register", agent_id: "RECON-01" }));

    const initMsg = await waitForMessage(dash);
    expect(initMsg.type).toBe("init");
    const data = initMsg.data as Record<string, Record<string, unknown>>;
    expect(data["RECON-01"]).toBeDefined();
    // Fresh hub state after disconnect (agent was deleted)
    expect(data["RECON-01"].state).toBe("PROGRESSING");

    probe2.close(); dash.close();
  });

  test("three probes — one disconnects, command routing works for remaining", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // init

    const probes: WebSocket[] = [];
    for (const id of ["TRI-01", "TRI-02", "TRI-03"]) {
      const p = new WebSocket(wsUrl(hub, "/ws/probe"));
      await waitForOpen(p);
      p.send(JSON.stringify({ type: "register", agent_id: id }));
      await waitForMessage(dash); // init broadcast
      probes.push(p);
    }

    expect(hub.agents.size).toBe(3);

    // Disconnect TRI-02
    probes[1].close();
    await waitForMessage(dash); // agent_disconnected

    expect(hub.agents.has("TRI-02")).toBe(false);
    expect(hub.agents.has("TRI-01")).toBe(true);
    expect(hub.agents.has("TRI-03")).toBe(true);

    // Route command to TRI-03
    dash.send(JSON.stringify({ type: "command", agent_id: "TRI-03", action: "kill" }));
    const cmd = await waitForMessage(probes[2]);
    expect(cmd.action).toBe("kill");

    // Route command to TRI-01
    dash.send(JSON.stringify({ type: "command", agent_id: "TRI-01", action: "resume" }));
    const cmd2 = await waitForMessage(probes[0]);
    expect(cmd2.action).toBe("resume");

    probes[0].close(); probes[2].close(); dash.close();
  });

  test("VLM updates from multiple probes arrive with correct agent_id", async () => {
    hub = createHub(0);

    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    await waitForMessage(dash); // init

    const probe1 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe1);
    probe1.send(JSON.stringify({ type: "register", agent_id: "VLM-01" }));
    await waitForMessage(dash);

    const probe2 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe2);
    probe2.send(JSON.stringify({ type: "register", agent_id: "VLM-02" }));
    await waitForMessage(dash);

    // Both send VLM updates
    probe1.send(JSON.stringify({
      type: "vlm_update",
      data: { agent_state: "STUCK", confidence_score: 25, reasoning: "stuck" },
    }));
    probe2.send(JSON.stringify({
      type: "vlm_update",
      data: { agent_state: "DANGEROUS", confidence_score: 90, reasoning: "rm -rf" },
    }));

    const upd1 = await waitForMessage(dash);
    const upd2 = await waitForMessage(dash);

    const updates = [upd1, upd2].sort((a, b) =>
      (a.agent_id as string).localeCompare(b.agent_id as string)
    );

    expect(updates[0].agent_id).toBe("VLM-01");
    expect((updates[0].data as Record<string, unknown>).agent_state).toBe("STUCK");
    expect(updates[1].agent_id).toBe("VLM-02");
    expect((updates[1].data as Record<string, unknown>).agent_state).toBe("DANGEROUS");

    // Verify hub internal state
    expect(hub.agents.get("VLM-01")?.state).toBe("STUCK");
    expect(hub.agents.get("VLM-02")?.state).toBe("DANGEROUS");

    probe1.close(); probe2.close(); dash.close();
  });
});
