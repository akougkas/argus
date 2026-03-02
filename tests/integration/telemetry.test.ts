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

/**
 * Helper: connect a probe, register it, and wait for hub to process.
 */
async function connectProbe(agentId: string): Promise<WebSocket> {
  const probe = new WebSocket(wsUrl(hub!, "/ws/probe"));
  openSockets.push(probe);
  await waitForOpen(probe);
  probe.send(JSON.stringify({ type: "register", agent_id: agentId }));
  await Bun.sleep(50);
  return probe;
}

/**
 * Helper: connect a dashboard, consume the init message, return ws.
 */
async function connectDashboard(): Promise<WebSocket> {
  const dash = new WebSocket(wsUrl(hub!, "/ws/dashboard"));
  openSockets.push(dash);
  await waitForMessage(dash); // consume init
  return dash;
}

/**
 * Helper: send a telemetry_update from probe.
 */
function sendTelemetry(
  probe: WebSocket,
  opts: {
    event_type: string;
    run_id: string;
    data?: Record<string, unknown>;
    context_percent?: number;
    active_runs?: number;
  },
) {
  probe.send(JSON.stringify({
    type: "telemetry_update",
    event_type: opts.event_type,
    run_id: opts.run_id,
    data: opts.data ?? {},
    telemetry: {
      context_percent: opts.context_percent ?? 42.5,
      active_runs: opts.active_runs ?? 1,
    },
  }));
}

/**
 * Helper: HTTP GET JSON from hub.
 */
async function fetchJSON(path: string): Promise<unknown> {
  const res = await fetch(`http://localhost:${hub!.server.port}${path}`);
  expect(res.status).toBe(200);
  return res.json();
}

describe("telemetry pipeline integration", () => {
  test("telemetry_update flows from probe to dashboard", async () => {
    hub = createHub(0, { dbPath: ":memory:" });

    const probe = await connectProbe("T-01");
    const dash = await connectDashboard();

    // Probe sends telemetry_update
    sendTelemetry(probe, {
      event_type: "tool_call",
      run_id: "run-001",
      data: { tool: "bash", args: "ls -la" },
      context_percent: 65.3,
      active_runs: 2,
    });

    // Dashboard receives it (raw relay)
    const msg = await waitForMessage(dash);
    expect(msg.type).toBe("telemetry_update");
    expect(msg.event_type).toBe("tool_call");
    expect(msg.run_id).toBe("run-001");
    expect((msg.data as Record<string, unknown>).tool).toBe("bash");
    expect((msg.data as Record<string, unknown>).args).toBe("ls -la");
    expect((msg.telemetry as Record<string, unknown>).context_percent).toBe(65.3);
    expect((msg.telemetry as Record<string, unknown>).active_runs).toBe(2);
  });

  test("telemetry_update stored in SQLite and queryable via HTTP", async () => {
    hub = createHub(0, { dbPath: ":memory:" });

    const probe = await connectProbe("T-02");

    // Send 3 events with different types and run IDs
    sendTelemetry(probe, {
      event_type: "tool_call",
      run_id: "run-A",
      data: { tool: "bash" },
      context_percent: 30,
      active_runs: 1,
    });
    await Bun.sleep(20);

    sendTelemetry(probe, {
      event_type: "llm_response",
      run_id: "run-A",
      data: { tokens: 512 },
      context_percent: 45,
      active_runs: 1,
    });
    await Bun.sleep(20);

    sendTelemetry(probe, {
      event_type: "tool_call",
      run_id: "run-B",
      data: { tool: "file_write" },
      context_percent: 60,
      active_runs: 2,
    });

    // Wait for all DB writes to complete
    await Bun.sleep(150);

    // Query all telemetry for T-02
    const events = (await fetchJSON("/api/agents/T-02/telemetry")) as Array<Record<string, unknown>>;
    expect(events.length).toBe(3);

    // DESC order — newest first
    expect(events[0].event_type).toBe("tool_call");
    expect(events[0].run_id).toBe("run-B");
    expect(events[0].context_percent).toBe(60);
    expect(events[0].active_runs).toBe(2);
    // data is stored as JSON string in DB
    const data0 = JSON.parse(events[0].data as string);
    expect(data0.tool).toBe("file_write");

    expect(events[1].event_type).toBe("llm_response");
    expect(events[1].run_id).toBe("run-A");
    const data1 = JSON.parse(events[1].data as string);
    expect(data1.tokens).toBe(512);

    expect(events[2].event_type).toBe("tool_call");
    expect(events[2].run_id).toBe("run-A");
  });

  test("telemetry HTTP API filters by run_id", async () => {
    hub = createHub(0, { dbPath: ":memory:" });

    const probe = await connectProbe("T-03");

    // Send 5 events: 3 with run-A, 2 with run-B
    for (let i = 0; i < 3; i++) {
      sendTelemetry(probe, {
        event_type: `event-A-${i}`,
        run_id: "run-A",
        data: { seq: i },
      });
      await Bun.sleep(10);
    }
    for (let i = 0; i < 2; i++) {
      sendTelemetry(probe, {
        event_type: `event-B-${i}`,
        run_id: "run-B",
        data: { seq: i },
      });
      await Bun.sleep(10);
    }

    await Bun.sleep(150);

    const runA = (await fetchJSON("/api/agents/T-03/telemetry?run_id=run-A")) as Array<Record<string, unknown>>;
    expect(runA.length).toBe(3);
    for (const ev of runA) {
      expect(ev.run_id).toBe("run-A");
    }

    const runB = (await fetchJSON("/api/agents/T-03/telemetry?run_id=run-B")) as Array<Record<string, unknown>>;
    expect(runB.length).toBe(2);
    for (const ev of runB) {
      expect(ev.run_id).toBe("run-B");
    }
  });

  test("telemetry HTTP API filters by since/before", async () => {
    hub = createHub(0, { dbPath: ":memory:" });

    const probe = await connectProbe("T-04");

    // Send first batch
    sendTelemetry(probe, { event_type: "early-1", run_id: "r1" });
    await Bun.sleep(10);
    sendTelemetry(probe, { event_type: "early-2", run_id: "r1" });

    // Wait for DB writes, capture midpoint
    await Bun.sleep(100);
    const midpoint = Date.now();
    await Bun.sleep(50);

    // Send second batch
    sendTelemetry(probe, { event_type: "late-1", run_id: "r1" });
    await Bun.sleep(10);
    sendTelemetry(probe, { event_type: "late-2", run_id: "r1" });

    await Bun.sleep(150);

    // Verify all 4 exist
    const all = (await fetchJSON("/api/agents/T-04/telemetry")) as Array<Record<string, unknown>>;
    expect(all.length).toBe(4);

    // since=midpoint should return only the late events
    const sinceEvents = (await fetchJSON(`/api/agents/T-04/telemetry?since=${midpoint}`)) as Array<Record<string, unknown>>;
    expect(sinceEvents.length).toBe(2);
    for (const ev of sinceEvents) {
      expect((ev.event_type as string).startsWith("late-")).toBe(true);
    }

    // before=midpoint should return only the early events
    const beforeEvents = (await fetchJSON(`/api/agents/T-04/telemetry?before=${midpoint}`)) as Array<Record<string, unknown>>;
    expect(beforeEvents.length).toBe(2);
    for (const ev of beforeEvents) {
      expect((ev.event_type as string).startsWith("early-")).toBe(true);
    }

    // Combine since + before for an empty window
    const emptyWindow = (await fetchJSON(`/api/agents/T-04/telemetry?since=${midpoint}&before=${midpoint}`)) as Array<Record<string, unknown>>;
    expect(emptyWindow.length).toBe(0);
  });

  test("multiple probes store telemetry independently", async () => {
    hub = createHub(0, { dbPath: ":memory:" });

    const probeA = await connectProbe("T-A");
    const probeB = await connectProbe("T-B");

    // Each sends distinct telemetry
    sendTelemetry(probeA, { event_type: "from-A-1", run_id: "rA" });
    sendTelemetry(probeA, { event_type: "from-A-2", run_id: "rA" });
    sendTelemetry(probeB, { event_type: "from-B-1", run_id: "rB" });

    await Bun.sleep(150);

    const eventsA = (await fetchJSON("/api/agents/T-A/telemetry")) as Array<Record<string, unknown>>;
    expect(eventsA.length).toBe(2);
    for (const ev of eventsA) {
      expect(ev.agent_id).toBe("T-A");
      expect((ev.event_type as string).startsWith("from-A")).toBe(true);
    }

    const eventsB = (await fetchJSON("/api/agents/T-B/telemetry")) as Array<Record<string, unknown>>;
    expect(eventsB.length).toBe(1);
    expect(eventsB[0].agent_id).toBe("T-B");
    expect(eventsB[0].event_type).toBe("from-B-1");
  });
});
