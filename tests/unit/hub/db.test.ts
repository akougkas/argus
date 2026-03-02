import { describe, test, expect, afterEach } from "bun:test";
import { createDb, type DbInstance } from "../../../src/hub/db";

let db: DbInstance | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("createDb", () => {
  test("returns instance with all methods", () => {
    db = createDb();
    expect(db.insertAgent).toBeFunction();
    expect(db.updateAgentState).toBeFunction();
    expect(db.insertLog).toBeFunction();
    expect(db.insertVlmEvent).toBeFunction();
    expect(db.getAllAgents).toBeFunction();
    expect(db.getAgentHistory).toBeFunction();
    expect(db.getAgentLogs).toBeFunction();
    expect(db.close).toBeFunction();
  });

  test("insertAgent + getAllAgents", () => {
    db = createDb();
    db.insertAgent("A-01", "PROGRESSING", 0.95, "looks good", "fix bug", "python3 agent.py", 1000, 2000);
    const agents = db.getAllAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("A-01");
    expect(agents[0].state).toBe("PROGRESSING");
    expect(agents[0].confidence).toBe(0.95);
    expect(agents[0].reasoning).toBe("looks good");
    expect(agents[0].task).toBe("fix bug");
    expect(agents[0].command).toBe("python3 agent.py");
    expect(agents[0].start_time).toBe(1000);
    expect(agents[0].last_seen).toBe(2000);
  });

  test("insertAgent upsert overwrites on same ID", () => {
    db = createDb();
    db.insertAgent("A-01", "PROGRESSING", 0.9, "initial", "task1", "cmd1", 1000, 2000);
    db.insertAgent("A-01", "STUCK", 0.3, "stuck now", "task2", "cmd2", 1000, 3000);
    const agents = db.getAllAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].state).toBe("STUCK");
    expect(agents[0].confidence).toBe(0.3);
    expect(agents[0].reasoning).toBe("stuck now");
    expect(agents[0].task).toBe("task2");
    expect(agents[0].last_seen).toBe(3000);
  });

  test("updateAgentState", () => {
    db = createDb();
    db.insertAgent("A-01", "PROGRESSING", 0.9, "ok", "task", "cmd", 1000, 2000);
    db.updateAgentState("A-01", "DANGEROUS", 0.1, "rm -rf detected", 5000);
    const agents = db.getAllAgents();
    expect(agents[0].state).toBe("DANGEROUS");
    expect(agents[0].confidence).toBe(0.1);
    expect(agents[0].reasoning).toBe("rm -rf detected");
    expect(agents[0].last_seen).toBe(5000);
    // task and command unchanged
    expect(agents[0].task).toBe("task");
    expect(agents[0].command).toBe("cmd");
  });

  test("insertLog + getAgentLogs", () => {
    db = createDb();
    db.insertLog("A-01", "starting up", "stdout", 1000);
    db.insertLog("A-01", "error occurred", "stderr", 2000);
    const logs = db.getAgentLogs("A-01");
    expect(logs).toHaveLength(2);
    // DESC order — newest first
    expect(logs[0].text).toBe("error occurred");
    expect(logs[0].type).toBe("stderr");
    expect(logs[0].timestamp).toBe(2000);
    expect(logs[1].text).toBe("starting up");
    expect(logs[1].timestamp).toBe(1000);
  });

  test("insertVlmEvent + getAgentHistory", () => {
    db = createDb();
    db.insertVlmEvent("A-01", "PROGRESSING", 0.9, "looks fine", 1000);
    db.insertVlmEvent("A-01", "STUCK", 0.3, "loop detected", 2000);
    const history = db.getAgentHistory("A-01");
    expect(history).toHaveLength(2);
    // DESC order — newest first
    expect(history[0].state).toBe("STUCK");
    expect(history[0].confidence).toBe(0.3);
    expect(history[0].reasoning).toBe("loop detected");
    expect(history[0].timestamp).toBe(2000);
    expect(history[1].state).toBe("PROGRESSING");
  });

  test("getAgentLogs pagination (limit, offset)", () => {
    db = createDb();
    for (let i = 0; i < 10; i++) {
      db.insertLog("A-01", `line ${i}`, "stdout", 1000 + i);
    }
    // Default limit=100 returns all
    expect(db.getAgentLogs("A-01")).toHaveLength(10);

    // Limit to 3
    const page1 = db.getAgentLogs("A-01", { limit: 3 });
    expect(page1).toHaveLength(3);
    expect(page1[0].timestamp).toBe(1009); // newest first

    // Offset 3, limit 3 — next page
    const page2 = db.getAgentLogs("A-01", { limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
    expect(page2[0].timestamp).toBe(1006);
  });

  test("getAgentHistory pagination (limit, offset)", () => {
    db = createDb();
    for (let i = 0; i < 10; i++) {
      db.insertVlmEvent("A-01", "PROGRESSING", 0.9, `event ${i}`, 1000 + i);
    }
    const page1 = db.getAgentHistory("A-01", { limit: 5 });
    expect(page1).toHaveLength(5);
    expect(page1[0].timestamp).toBe(1009);

    const page2 = db.getAgentHistory("A-01", { limit: 5, offset: 5 });
    expect(page2).toHaveLength(5);
    expect(page2[0].timestamp).toBe(1004);
  });

  test("getAgentLogs since filter", () => {
    db = createDb();
    db.insertLog("A-01", "old", "stdout", 1000);
    db.insertLog("A-01", "new", "stdout", 2000);
    db.insertLog("A-01", "newest", "stdout", 3000);
    const logs = db.getAgentLogs("A-01", { since: 2000 });
    expect(logs).toHaveLength(2);
    expect(logs[0].text).toBe("newest");
    expect(logs[1].text).toBe("new");
  });

  test("getAgentLogs type filter", () => {
    db = createDb();
    db.insertLog("A-01", "normal output", "stdout", 1000);
    db.insertLog("A-01", "error!", "stderr", 2000);
    db.insertLog("A-01", "more output", "stdout", 3000);
    const stderr = db.getAgentLogs("A-01", { type: "stderr" });
    expect(stderr).toHaveLength(1);
    expect(stderr[0].text).toBe("error!");
  });

  test("getAgentHistory chronological ordering (DESC)", () => {
    db = createDb();
    // Insert out of order
    db.insertVlmEvent("A-01", "STUCK", 0.3, "stuck", 5000);
    db.insertVlmEvent("A-01", "PROGRESSING", 0.9, "ok", 1000);
    db.insertVlmEvent("A-01", "DANGEROUS", 0.1, "danger", 3000);
    const history = db.getAgentHistory("A-01");
    expect(history[0].timestamp).toBe(5000);
    expect(history[1].timestamp).toBe(3000);
    expect(history[2].timestamp).toBe(1000);
  });

  test("close() does not throw", () => {
    db = createDb();
    expect(() => db!.close()).not.toThrow();
    db = null; // prevent afterEach from double-closing
  });

  describe("frame methods", () => {
    test("insertFrame + getFrames returns frames in DESC order", () => {
      db = createDb();
      db.insertFrame("A-01", 1000, "/tmp/frame1.jpg", 5000);
      db.insertFrame("A-01", 2000, "/tmp/frame2.jpg", 6000);
      db.insertFrame("A-01", 3000, "/tmp/frame3.jpg", 7000);
      const frames = db.getFrames("A-01");
      expect(frames).toHaveLength(3);
      expect(frames[0].timestamp).toBe(3000);
      expect(frames[1].timestamp).toBe(2000);
      expect(frames[2].timestamp).toBe(1000);
    });

    test("getFrames with limit", () => {
      db = createDb();
      for (let i = 0; i < 10; i++) {
        db.insertFrame("A-01", 1000 + i, `/tmp/frame${i}.jpg`, 5000 + i);
      }
      const frames = db.getFrames("A-01", { limit: 3 });
      expect(frames).toHaveLength(3);
      expect(frames[0].timestamp).toBe(1009); // newest first
      expect(frames[2].timestamp).toBe(1007);
    });

    test("getFrames with since filter", () => {
      db = createDb();
      db.insertFrame("A-01", 1000, "/tmp/old.jpg", 5000);
      db.insertFrame("A-01", 2000, "/tmp/mid.jpg", 6000);
      db.insertFrame("A-01", 3000, "/tmp/new.jpg", 7000);
      const frames = db.getFrames("A-01", { since: 2000 });
      expect(frames).toHaveLength(2);
      expect(frames[0].timestamp).toBe(3000);
      expect(frames[1].timestamp).toBe(2000);
    });

    test("getFrames with before filter", () => {
      db = createDb();
      db.insertFrame("A-01", 1000, "/tmp/old.jpg", 5000);
      db.insertFrame("A-01", 2000, "/tmp/mid.jpg", 6000);
      db.insertFrame("A-01", 3000, "/tmp/new.jpg", 7000);
      const frames = db.getFrames("A-01", { before: 3000 });
      expect(frames).toHaveLength(2);
      expect(frames[0].timestamp).toBe(2000);
      expect(frames[1].timestamp).toBe(1000);
    });

    test("getFrames combined since + before", () => {
      db = createDb();
      db.insertFrame("A-01", 1000, "/tmp/f1.jpg", 5000);
      db.insertFrame("A-01", 2000, "/tmp/f2.jpg", 6000);
      db.insertFrame("A-01", 3000, "/tmp/f3.jpg", 7000);
      db.insertFrame("A-01", 4000, "/tmp/f4.jpg", 8000);
      const frames = db.getFrames("A-01", { since: 2000, before: 4000 });
      expect(frames).toHaveLength(2);
      expect(frames[0].timestamp).toBe(3000);
      expect(frames[1].timestamp).toBe(2000);
    });

    test("deleteFramesBefore removes old frames and returns count", () => {
      db = createDb();
      db.insertFrame("A-01", 1000, "/tmp/f1.jpg", 5000);
      db.insertFrame("A-01", 2000, "/tmp/f2.jpg", 6000);
      db.insertFrame("A-01", 3000, "/tmp/f3.jpg", 7000);
      const deleted = db.deleteFramesBefore("A-01", 2500);
      expect(deleted).toBe(2);
      const remaining = db.getFrames("A-01");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].timestamp).toBe(3000);
    });

    test("deleteFramesBefore returns 0 when nothing to delete", () => {
      db = createDb();
      db.insertFrame("A-01", 5000, "/tmp/f1.jpg", 5000);
      const deleted = db.deleteFramesBefore("A-01", 1000);
      expect(deleted).toBe(0);
      expect(db.getFrames("A-01")).toHaveLength(1);
    });

    test("getFrames returns correct fields", () => {
      db = createDb();
      db.insertFrame("A-01", 1234, "/dev/shm/argus-frames/A-01/frame-1234.jpg", 98765);
      const frames = db.getFrames("A-01");
      expect(frames).toHaveLength(1);
      expect(frames[0].path).toBe("/dev/shm/argus-frames/A-01/frame-1234.jpg");
      expect(frames[0].agent_id).toBe("A-01");
      expect(frames[0].timestamp).toBe(1234);
      expect(frames[0].size_bytes).toBe(98765);
    });
  });

  describe("telemetry methods", () => {
    test("insertTelemetryEvent stores events correctly", () => {
      db = createDb();
      db.insertTelemetryEvent("A-01", "tool_call", "run-1", '{"tool":"bash"}', 42.5, 3, 1000);
      const events = db.getTelemetryEvents("A-01");
      expect(events).toHaveLength(1);
      expect(events[0].agent_id).toBe("A-01");
      expect(events[0].event_type).toBe("tool_call");
      expect(events[0].run_id).toBe("run-1");
      expect(events[0].data).toBe('{"tool":"bash"}');
      expect(events[0].context_percent).toBe(42.5);
      expect(events[0].active_runs).toBe(3);
      expect(events[0].timestamp).toBe(1000);
    });

    test("getTelemetryEvents returns events in DESC order", () => {
      db = createDb();
      db.insertTelemetryEvent("A-01", "tool_call", "run-1", "{}", 10, 1, 1000);
      db.insertTelemetryEvent("A-01", "token_usage", "run-1", "{}", 20, 1, 2000);
      db.insertTelemetryEvent("A-01", "error", "run-1", "{}", 30, 1, 3000);
      const events = db.getTelemetryEvents("A-01");
      expect(events).toHaveLength(3);
      expect(events[0].timestamp).toBe(3000);
      expect(events[1].timestamp).toBe(2000);
      expect(events[2].timestamp).toBe(1000);
    });

    test("getTelemetryEvents filters by since", () => {
      db = createDb();
      db.insertTelemetryEvent("A-01", "tool_call", "run-1", "{}", 10, 1, 1000);
      db.insertTelemetryEvent("A-01", "tool_call", "run-1", "{}", 20, 1, 2000);
      db.insertTelemetryEvent("A-01", "tool_call", "run-1", "{}", 30, 1, 3000);
      const events = db.getTelemetryEvents("A-01", { since: 2000 });
      expect(events).toHaveLength(2);
      expect(events[0].timestamp).toBe(3000);
      expect(events[1].timestamp).toBe(2000);
    });

    test("getTelemetryEvents filters by before", () => {
      db = createDb();
      db.insertTelemetryEvent("A-01", "tool_call", "run-1", "{}", 10, 1, 1000);
      db.insertTelemetryEvent("A-01", "tool_call", "run-1", "{}", 20, 1, 2000);
      db.insertTelemetryEvent("A-01", "tool_call", "run-1", "{}", 30, 1, 3000);
      const events = db.getTelemetryEvents("A-01", { before: 3000 });
      expect(events).toHaveLength(2);
      expect(events[0].timestamp).toBe(2000);
      expect(events[1].timestamp).toBe(1000);
    });

    test("getTelemetryEvents filters by run_id", () => {
      db = createDb();
      db.insertTelemetryEvent("A-01", "tool_call", "run-1", "{}", 10, 1, 1000);
      db.insertTelemetryEvent("A-01", "tool_call", "run-2", "{}", 20, 2, 2000);
      db.insertTelemetryEvent("A-01", "error", "run-1", "{}", 30, 1, 3000);
      const events = db.getTelemetryEvents("A-01", { run_id: "run-1" });
      expect(events).toHaveLength(2);
      expect(events[0].run_id).toBe("run-1");
      expect(events[1].run_id).toBe("run-1");
    });

    test("getTelemetryEvents pagination (limit, offset)", () => {
      db = createDb();
      for (let i = 0; i < 10; i++) {
        db.insertTelemetryEvent("A-01", "tool_call", "run-1", "{}", i * 10, 1, 1000 + i);
      }
      const page1 = db.getTelemetryEvents("A-01", { limit: 3 });
      expect(page1).toHaveLength(3);
      expect(page1[0].timestamp).toBe(1009); // newest first

      const page2 = db.getTelemetryEvents("A-01", { limit: 3, offset: 3 });
      expect(page2).toHaveLength(3);
      expect(page2[0].timestamp).toBe(1006);
    });
  });
});
