import { describe, test, expect, afterEach } from "bun:test";
import { createHub, type HubInstance } from "../../src/hub/hub";
import { wsUrl, waitForOpen } from "../helpers";
import { existsSync, unlinkSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let hub: HubInstance | null = null;
let hub2: HubInstance | null = null;
const tmpFiles: string[] = [];

afterEach(() => {
  hub?.stop();
  hub = null;
  hub2?.stop();
  hub2 = null;
  for (const f of tmpFiles) {
    if (existsSync(f)) unlinkSync(f);
  }
  tmpFiles.length = 0;
});

describe("SQLite persistence through hub", () => {
  test("hub with DB persists agent on register", async () => {
    hub = createHub(0, ":memory:");

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({
      type: "register",
      agent_id: "DB-01",
      metadata: { task: "run tests", command: "bun test", start_time: 1000 },
    }));

    await Bun.sleep(50);

    const rows = hub.db!.getAllAgents();
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("DB-01");
    expect(rows[0].state).toBe("PROGRESSING");
    expect(rows[0].confidence).toBe(100);
    expect(rows[0].task).toBe("run tests");
    expect(rows[0].command).toBe("bun test");
    expect(rows[0].start_time).toBe(1000);

    probe.close();
  });

  test("VLM updates persist as events", async () => {
    hub = createHub(0, ":memory:");

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "DB-02" }));
    await Bun.sleep(50);

    probe.send(JSON.stringify({
      type: "vlm_update",
      data: { agent_state: "STUCK", confidence_score: 30, reasoning: "Loop detected" },
    }));
    await Bun.sleep(50);

    probe.send(JSON.stringify({
      type: "vlm_update",
      data: { agent_state: "DANGEROUS", confidence_score: 10, reasoning: "rm -rf /" },
    }));
    await Bun.sleep(50);

    const events = hub.db!.getAgentHistory("DB-02");
    expect(events.length).toBe(2);
    // DESC order — latest first
    expect(events[0].state).toBe("DANGEROUS");
    expect(events[0].confidence).toBe(10);
    expect(events[0].reasoning).toBe("rm -rf /");
    expect(events[1].state).toBe("STUCK");
    expect(events[1].confidence).toBe(30);

    // Agent row reflects latest state
    const agents = hub.db!.getAllAgents();
    expect(agents[0].state).toBe("DANGEROUS");
    expect(agents[0].confidence).toBe(10);

    probe.close();
  });

  test("log updates persist", async () => {
    hub = createHub(0, ":memory:");

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "DB-03" }));
    await Bun.sleep(50);

    probe.send(JSON.stringify({
      type: "log_update",
      agent_id: "DB-03",
      log: { text: "Starting build", type: "stdout" },
    }));
    probe.send(JSON.stringify({
      type: "log_update",
      agent_id: "DB-03",
      log: { text: "Compiling...", type: "stdout" },
    }));
    probe.send(JSON.stringify({
      type: "log_update",
      agent_id: "DB-03",
      log: { text: "Error: missing dep", type: "stderr" },
    }));
    await Bun.sleep(50);

    const logs = hub.db!.getAgentLogs("DB-03");
    expect(logs.length).toBe(3);
    // DESC order — latest first
    expect(logs[0].text).toBe("Error: missing dep");
    expect(logs[0].type).toBe("stderr");
    expect(logs[2].text).toBe("Starting build");

    probe.close();
  });

  test("restart preloads agents from DB", async () => {
    const tmpPath = join(tmpdir(), `argus-test-${Date.now()}.sqlite`);
    tmpFiles.push(tmpPath);

    // Hub 1: register agent and update state
    hub = createHub(0, tmpPath);

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({
      type: "register",
      agent_id: "RESTART-01",
      metadata: { task: "deploy", command: "bash deploy.sh", start_time: 2000 },
    }));
    await Bun.sleep(50);

    probe.send(JSON.stringify({
      type: "vlm_update",
      data: { agent_state: "STUCK", confidence_score: 25, reasoning: "Timeout" },
    }));
    await Bun.sleep(50);

    probe.close();
    await Bun.sleep(50);
    hub.stop();
    hub = null;

    // Hub 2: same DB file — should preload
    hub2 = createHub(0, tmpPath);

    expect(hub2.agents.has("RESTART-01")).toBe(true);
    const agent = hub2.agents.get("RESTART-01")!;
    expect(agent.state).toBe("STUCK");
    expect(agent.confidence).toBe(25);
    expect(agent.reasoning).toBe("Timeout");
    expect(agent.task).toBe("deploy");
    expect(agent.command).toBe("bash deploy.sh");
    expect(agent.startTime).toBe(2000);
    expect(agent.connected).toBe(false);
  });

  test("HTTP GET /api/agents returns all agents", async () => {
    hub = createHub(0, ":memory:");
    const port = hub.server.port;

    const probe1 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe1);
    probe1.send(JSON.stringify({ type: "register", agent_id: "HTTP-01" }));

    const probe2 = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe2);
    probe2.send(JSON.stringify({ type: "register", agent_id: "HTTP-02" }));
    await Bun.sleep(50);

    const res = await fetch(`http://localhost:${port}/api/agents`);
    expect(res.status).toBe(200);
    const agents = await res.json();
    expect(agents.length).toBe(2);
    const ids = agents.map((a: { id: string }) => a.id).sort();
    expect(ids).toEqual(["HTTP-01", "HTTP-02"]);

    probe1.close();
    probe2.close();
  });

  test("HTTP GET /api/agents/:id/history with pagination", async () => {
    hub = createHub(0, ":memory:");
    const port = hub.server.port;

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "HIST-01" }));
    await Bun.sleep(50);

    // Send 5 VLM updates with distinct states
    for (let i = 1; i <= 5; i++) {
      probe.send(JSON.stringify({
        type: "vlm_update",
        data: { agent_state: `STATE-${i}`, confidence_score: i * 10, reasoning: `Reason ${i}` },
      }));
      await Bun.sleep(20);
    }
    await Bun.sleep(50);

    // Page 1: limit=2
    const res1 = await fetch(`http://localhost:${port}/api/agents/HIST-01/history?limit=2`);
    const page1 = await res1.json();
    expect(page1.length).toBe(2);
    // DESC order — STATE-5 first
    expect(page1[0].state).toBe("STATE-5");
    expect(page1[1].state).toBe("STATE-4");

    // Page 2: limit=2, offset=2
    const res2 = await fetch(`http://localhost:${port}/api/agents/HIST-01/history?limit=2&offset=2`);
    const page2 = await res2.json();
    expect(page2.length).toBe(2);
    expect(page2[0].state).toBe("STATE-3");
    expect(page2[1].state).toBe("STATE-2");

    probe.close();
  });

  test("HTTP GET /api/agents/:id/logs with type filter", async () => {
    hub = createHub(0, ":memory:");
    const port = hub.server.port;

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "LOGS-01" }));
    await Bun.sleep(50);

    probe.send(JSON.stringify({
      type: "log_update",
      agent_id: "LOGS-01",
      log: { text: "All good", type: "stdout" },
    }));
    probe.send(JSON.stringify({
      type: "log_update",
      agent_id: "LOGS-01",
      log: { text: "Something failed", type: "stderr" },
    }));
    probe.send(JSON.stringify({
      type: "log_update",
      agent_id: "LOGS-01",
      log: { text: "Another error", type: "stderr" },
    }));
    probe.send(JSON.stringify({
      type: "log_update",
      agent_id: "LOGS-01",
      log: { text: "Recovered", type: "stdout" },
    }));
    await Bun.sleep(50);

    // Filter stderr only
    const res = await fetch(`http://localhost:${port}/api/agents/LOGS-01/logs?type=stderr`);
    const logs = await res.json();
    expect(logs.length).toBe(2);
    expect(logs.every((l: { type: string }) => l.type === "stderr")).toBe(true);

    // Unfiltered — all 4
    const resAll = await fetch(`http://localhost:${port}/api/agents/LOGS-01/logs`);
    const allLogs = await resAll.json();
    expect(allLogs.length).toBe(4);

    probe.close();
  });

  test("HTTP API returns default response when no DB", async () => {
    hub = createHub(0); // no dbPath

    const port = hub.server.port;
    const res = await fetch(`http://localhost:${port}/api/agents`);
    // Without DB, the /api/agents route doesn't match — falls through to default
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("Argus Hub");
  });

  test("frame_update persists JPEG to disk and records metadata in DB", async () => {
    const tmpFrame = mkdtempSync(join(tmpdir(), "argus-frames-"));

    hub = createHub(0, { dbPath: ":memory:", framePath: tmpFrame, frameMode: "persist" });

    const probe = new WebSocket(wsUrl(hub, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "FRAME-01" }));
    await Bun.sleep(50);

    const fakeJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]); // JPEG magic bytes
    const beforeSend = Date.now();
    probe.send(JSON.stringify({
      type: "frame_update",
      agent_id: "FRAME-01",
      frame: fakeJpeg.toString("base64"),
      timestamp: 0, // hub overrides with Date.now()
    }));
    await Bun.sleep(200);

    // Verify DB metadata (hub assigns its own timestamp via Date.now())
    const dbFrames = hub.db!.getFrames("FRAME-01");
    expect(dbFrames.length).toBe(1);
    expect(dbFrames[0].agent_id).toBe("FRAME-01");
    expect(dbFrames[0].timestamp).toBeGreaterThanOrEqual(beforeSend);
    expect(dbFrames[0].timestamp).toBeLessThanOrEqual(Date.now());
    expect(dbFrames[0].size_bytes).toBe(fakeJpeg.length);

    // Verify file on disk
    expect(existsSync(dbFrames[0].path)).toBe(true);

    // Verify HTTP API for frames metadata
    const port = hub.server.port;
    const res = await fetch(`http://localhost:${port}/api/agents/FRAME-01/frames`);
    expect(res.status).toBe(200);
    const apiFrames = await res.json();
    expect(apiFrames.length).toBe(1);
    expect(apiFrames[0].timestamp).toBe(dbFrames[0].timestamp);

    // Verify serving actual JPEG
    const frameRes = await fetch(`http://localhost:${port}/api/frames/${encodeURIComponent(dbFrames[0].path)}`);
    expect(frameRes.status).toBe(200);
    expect(frameRes.headers.get("content-type")).toBe("image/jpeg");
    const body = Buffer.from(await frameRes.arrayBuffer());
    expect(body.length).toBe(fakeJpeg.length);

    probe.close();
    rmSync(tmpFrame, { recursive: true });
  });
});
