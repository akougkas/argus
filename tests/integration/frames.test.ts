import { describe, test, expect, afterEach } from "bun:test";
import { createHub, type HubInstance } from "../../src/hub/hub";
import { wsUrl, waitForOpen, waitForMessage } from "../helpers";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let hub: HubInstance | null = null;
let tmpDir: string | null = null;

afterEach(() => {
  hub?.stop();
  hub = null;
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

/**
 * Helper: connect a probe, register it, and wait for the hub to process.
 */
async function connectProbe(agentId: string): Promise<WebSocket> {
  const probe = new WebSocket(wsUrl(hub!, "/ws/probe"));
  await waitForOpen(probe);
  probe.send(JSON.stringify({ type: "register", agent_id: agentId }));
  await Bun.sleep(50);
  return probe;
}

/**
 * Helper: send a frame_update from a probe WebSocket.
 */
function sendFrame(probe: WebSocket, agentId: string, content: string, timestamp: number) {
  const jpegBuffer = Buffer.from(content);
  probe.send(JSON.stringify({
    type: "frame_update",
    agent_id: agentId,
    frame: jpegBuffer.toString("base64"),
    timestamp,
  }));
}

describe("frame persistence pipeline", () => {
  test("frame round-trip: store to disk → metadata API → JPEG serve", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "argus-frames-"));
    hub = createHub(0, { dbPath: ":memory:", framePath: tmpDir, frameMode: "persist" });
    const port = hub.server.port;

    const probe = await connectProbe("FRAME-01");
    const fakeJpeg = Buffer.from("fake-jpeg-content");
    const beforeSend = Date.now();

    probe.send(JSON.stringify({
      type: "frame_update",
      agent_id: "FRAME-01",
      frame: fakeJpeg.toString("base64"),
      timestamp: 0, // hub overrides with Date.now()
    }));
    await Bun.sleep(200);

    // Verify agent dir written to disk
    const agentDir = join(tmpDir, "FRAME-01");
    expect(existsSync(agentDir)).toBe(true);

    // GET /api/agents/:id/frames — metadata (hub-authoritative timestamp)
    const metaRes = await fetch(`http://localhost:${port}/api/agents/FRAME-01/frames`);
    expect(metaRes.status).toBe(200);
    const frames = await metaRes.json();
    expect(frames.length).toBe(1);
    expect(frames[0].agent_id).toBe("FRAME-01");
    // Hub assigns Date.now() — verify it's recent
    expect(frames[0].timestamp).toBeGreaterThanOrEqual(beforeSend);
    expect(frames[0].timestamp).toBeLessThanOrEqual(Date.now());
    expect(frames[0].size_bytes).toBe(fakeJpeg.length);
    // Verify file exists at the path the API reports
    expect(existsSync(frames[0].path)).toBe(true);

    // GET /api/frames/:encodedPath — actual JPEG bytes
    const encodedPath = encodeURIComponent(frames[0].path);
    const jpegRes = await fetch(`http://localhost:${port}/api/frames/${encodedPath}`);
    expect(jpegRes.status).toBe(200);
    expect(jpegRes.headers.get("Content-Type")).toBe("image/jpeg");
    const body = Buffer.from(await jpegRes.arrayBuffer());
    expect(body.equals(fakeJpeg)).toBe(true);

    probe.close();
  });

  test("multiple frames pagination: limit and DESC order", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "argus-frames-"));
    hub = createHub(0, { dbPath: ":memory:", framePath: tmpDir, frameMode: "persist" });
    const port = hub.server.port;

    const probe = await connectProbe("PAGE-01");

    // Send 5 frames with small delays so hub assigns distinct Date.now() timestamps
    for (let i = 0; i < 5; i++) {
      sendFrame(probe, "PAGE-01", `frame-${i}`, 0);
      await Bun.sleep(20); // ensure distinct hub timestamps
    }
    await Bun.sleep(250);

    // Query with limit=2 — should get newest first
    const res = await fetch(`http://localhost:${port}/api/agents/PAGE-01/frames?limit=2`);
    expect(res.status).toBe(200);
    const frames = await res.json();
    expect(frames.length).toBe(2);
    // DESC order: newest first (hub-authoritative timestamps)
    expect(frames[0].timestamp).toBeGreaterThan(frames[1].timestamp);

    // Query all — should return all 5 in DESC order
    const resAll = await fetch(`http://localhost:${port}/api/agents/PAGE-01/frames`);
    const allFrames = await resAll.json();
    expect(allFrames.length).toBe(5);
    // Verify strictly descending order
    for (let i = 0; i < allFrames.length - 1; i++) {
      expect(allFrames[i].timestamp).toBeGreaterThanOrEqual(allFrames[i + 1].timestamp);
    }

    probe.close();
  });

  test("frame since filter: only frames at or after timestamp", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "argus-frames-"));
    hub = createHub(0, { dbPath: ":memory:", framePath: tmpDir, frameMode: "persist" });
    const port = hub.server.port;

    const probe = await connectProbe("SINCE-01");

    // Send 3 frames with delays so hub assigns distinct Date.now() timestamps
    sendFrame(probe, "SINCE-01", "old-frame", 0);
    await Bun.sleep(30);
    sendFrame(probe, "SINCE-01", "mid-frame", 0);
    await Bun.sleep(30);
    sendFrame(probe, "SINCE-01", "new-frame", 0);
    await Bun.sleep(250);

    // Fetch all frames to get the hub-assigned timestamps
    const allRes = await fetch(`http://localhost:${port}/api/agents/SINCE-01/frames`);
    const allFrames = await allRes.json();
    expect(allFrames.length).toBe(3);
    // DESC order: newest first
    const newestTs = allFrames[0].timestamp;
    const midTs = allFrames[1].timestamp;
    const oldestTs = allFrames[2].timestamp;

    // since=midTs should return mid and new (>= semantics)
    const res = await fetch(
      `http://localhost:${port}/api/agents/SINCE-01/frames?since=${midTs}`,
    );
    expect(res.status).toBe(200);
    const frames = await res.json();
    expect(frames.length).toBe(2);
    expect(frames[0].timestamp).toBe(newestTs);
    expect(frames[1].timestamp).toBe(midTs);

    // since=newestTs+1 should return nothing
    const resNone = await fetch(
      `http://localhost:${port}/api/agents/SINCE-01/frames?since=${newestTs + 1}`,
    );
    const noFrames = await resNone.json();
    expect(noFrames.length).toBe(0);

    // Combine since + before for a window (exclude newest)
    const resWindow = await fetch(
      `http://localhost:${port}/api/agents/SINCE-01/frames?since=${oldestTs}&before=${newestTs}`,
    );
    const windowFrames = await resWindow.json();
    expect(windowFrames.length).toBe(2);
    expect(windowFrames[0].timestamp).toBe(midTs);
    expect(windowFrames[1].timestamp).toBe(oldestTs);

    probe.close();
  });

  test("frame 404: nonexistent path returns 404", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "argus-frames-"));
    hub = createHub(0, { dbPath: ":memory:", framePath: tmpDir, frameMode: "persist" });
    const port = hub.server.port;

    const fakePath = encodeURIComponent(join(tmpDir, "nonexistent", "999.jpg"));
    const res = await fetch(`http://localhost:${port}/api/frames/${fakePath}`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("Frame not found");
  });

  test("no frame persistence without storage config: frame_update still broadcasts", async () => {
    hub = createHub(0); // no storage config at all
    const port = hub.server.port;

    // Verify hub has no frame store
    expect(hub.frames).toBeNull();

    // Connect probe first, register it, then connect dashboard
    // This avoids race conditions with init messages
    const probe = new WebSocket(wsUrl(hub!, "/ws/probe"));
    await waitForOpen(probe);
    probe.send(JSON.stringify({ type: "register", agent_id: "NOSTORE-01" }));
    await Bun.sleep(50);

    // Connect dashboard — gets init with agent already registered
    const dash = new WebSocket(wsUrl(hub, "/ws/dashboard"));
    const initMsg = await waitForMessage(dash);
    expect(initMsg.type).toBe("init");

    // Send a frame_update — should broadcast to dashboard even without frame store
    const fakeJpeg = Buffer.from("ephemeral-frame");
    const ts = Date.now();
    probe.send(JSON.stringify({
      type: "frame_update",
      agent_id: "NOSTORE-01",
      frame: fakeJpeg.toString("base64"),
      timestamp: ts,
    }));

    const frameMsg = await waitForMessage(dash);
    expect(frameMsg.type).toBe("frame_update");
    expect(frameMsg.frame).toBe(fakeJpeg.toString("base64"));

    // HTTP frame endpoints should fall through (no frames store, no db)
    const metaRes = await fetch(`http://localhost:${port}/api/agents/NOSTORE-01/frames`);
    expect(metaRes.status).toBe(200);
    const metaText = await metaRes.text();
    expect(metaText).toBe("Argus Hub"); // Falls through to default response

    const serveRes = await fetch(`http://localhost:${port}/api/frames/anything`);
    expect(serveRes.status).toBe(200);
    const serveText = await serveRes.text();
    expect(serveText).toBe("Argus Hub"); // Falls through to default response

    probe.close();
    dash.close();
  });
});
