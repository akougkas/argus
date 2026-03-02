import { describe, test, expect, afterEach } from "bun:test";
import { createHub, type HubInstance } from "../../src/hub/hub";
import { wsUrl, waitForMessage, waitForOpen } from "../helpers";

let hub: HubInstance | null = null;
const openSockets: WebSocket[] = [];

afterEach(() => {
  for (const ws of openSockets) ws.close();
  openSockets.length = 0;
  hub?.stop();
  hub = null;
});

async function connectProbe(agentId: string): Promise<WebSocket> {
  const probe = new WebSocket(wsUrl(hub!, "/ws/probe"));
  openSockets.push(probe);
  await waitForOpen(probe);
  probe.send(JSON.stringify({ type: "register", agent_id: agentId }));
  await Bun.sleep(50);
  return probe;
}

async function connectDashboard(): Promise<WebSocket> {
  const dash = new WebSocket(wsUrl(hub!, "/ws/dashboard"));
  openSockets.push(dash);
  await waitForMessage(dash); // consume init
  return dash;
}

describe("steering command integration", () => {
  test("stoprun command routes from dashboard through hub to probe", async () => {
    hub = createHub(0);

    const probe = await connectProbe("S-01");
    const dash = await connectDashboard();

    // Dashboard sends stoprun command
    dash.send(JSON.stringify({
      type: "command",
      agent_id: "S-01",
      action: "stoprun",
      content: "run-42",
    }));

    // Probe receives the command
    const cmd = await waitForMessage(probe);
    expect(cmd.type).toBe("command");
    expect(cmd.action).toBe("stoprun");
    expect(cmd.content).toBe("run-42");
  });

  test("steer command routes from dashboard through hub to probe", async () => {
    hub = createHub(0);

    const probe = await connectProbe("S-02");
    const dash = await connectDashboard();

    // Dashboard sends steer command
    dash.send(JSON.stringify({
      type: "command",
      agent_id: "S-02",
      action: "steer",
      content: "Stop working on the backend, focus on tests",
    }));

    // Probe receives the command
    const cmd = await waitForMessage(probe);
    expect(cmd.type).toBe("command");
    expect(cmd.action).toBe("steer");
    expect(cmd.content).toBe("Stop working on the backend, focus on tests");
  });

  test("existing command types still work (pause, resume, inject)", async () => {
    hub = createHub(0);

    const probe = await connectProbe("S-03");
    const dash = await connectDashboard();

    // Pause
    dash.send(JSON.stringify({
      type: "command",
      agent_id: "S-03",
      action: "pause",
    }));
    const pauseCmd = await waitForMessage(probe);
    expect(pauseCmd.action).toBe("pause");

    // Resume
    dash.send(JSON.stringify({
      type: "command",
      agent_id: "S-03",
      action: "resume",
    }));
    const resumeCmd = await waitForMessage(probe);
    expect(resumeCmd.action).toBe("resume");

    // Inject
    dash.send(JSON.stringify({
      type: "command",
      agent_id: "S-03",
      action: "inject",
      content: "ls -la",
    }));
    const injectCmd = await waitForMessage(probe);
    expect(injectCmd.action).toBe("inject");
    expect(injectCmd.content).toBe("ls -la");
  });

  test("command to non-existent probe is silently dropped", async () => {
    hub = createHub(0);

    const dash = await connectDashboard();

    // Send command to agent that doesn't exist
    dash.send(JSON.stringify({
      type: "command",
      agent_id: "GHOST",
      action: "stoprun",
      content: "run-1",
    }));

    // Wait a bit — no crash, no response
    await Bun.sleep(100);

    // Hub is still alive
    const health = await fetch(`http://localhost:${hub.server.port}/health`);
    expect(health.status).toBe(200);
  });

  test("multiple steering commands to different probes", async () => {
    hub = createHub(0);

    const probeA = await connectProbe("S-A");
    const probeB = await connectProbe("S-B");
    const dash = await connectDashboard();

    // Send stoprun to A
    dash.send(JSON.stringify({
      type: "command",
      agent_id: "S-A",
      action: "stoprun",
      content: "run-alpha",
    }));

    const cmdA = await waitForMessage(probeA);
    expect(cmdA.action).toBe("stoprun");
    expect(cmdA.content).toBe("run-alpha");

    // Send steer to B
    dash.send(JSON.stringify({
      type: "command",
      agent_id: "S-B",
      action: "steer",
      content: "Focus on CSS",
    }));

    const cmdB = await waitForMessage(probeB);
    expect(cmdB.action).toBe("steer");
    expect(cmdB.content).toBe("Focus on CSS");
  });
});
