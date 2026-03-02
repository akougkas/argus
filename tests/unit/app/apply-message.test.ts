import { describe, test, expect } from "bun:test";
import {
  applyMessage,
  applyBatch,
  buildCommand,
  parseWsMessage,
  nextReconnectDelay,
  resolveSelectedId,
  findAgent,
  createAgent,
  isKnownMessageType,
  type Agent,
  type BatchResult,
} from "../../../src/app/useAgentSocket";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "A-01",
    name: "A-01",
    task: "",
    state: "PROGRESSING",
    logs: [],
    confidence: 100,
    ...overrides,
  };
}

describe("applyMessage", () => {
  test("init creates agents from empty state", () => {
    const result = applyMessage([], {
      type: "init",
      data: {
        "A-01": { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [] },
      },
    });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("A-01");
    expect(result[0].state).toBe("PROGRESSING");
  });

  test("init populates task from server data", () => {
    const result = applyMessage([], {
      type: "init",
      data: {
        "A-01": { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [], task: "Run benchmarks" },
      },
    });
    expect(result[0].task).toBe("Run benchmarks");
  });

  test("init merges with existing agents", () => {
    const existing = makeAgent({ confidence: 80 });
    const result = applyMessage([existing], {
      type: "init",
      data: {
        "A-01": { state: "STUCK", confidence: 50, reasoning: "loop", logs: [] },
      },
    });
    expect(result.length).toBe(1);
    expect(result[0].state).toBe("STUCK");
    expect(result[0].confidence).toBe(50);
  });

  test("agent_disconnected removes agent", () => {
    const agents = [makeAgent(), makeAgent({ id: "A-02", name: "A-02" })];
    const result = applyMessage(agents, { type: "agent_disconnected", agent_id: "A-01" });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("A-02");
  });

  test("frame_update sets frame on correct agent", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "frame_update",
      agent_id: "A-01",
      frame: "base64data",
    });
    expect(result[0].frame).toBe("base64data");
  });

  test("terminal_screen_update sets ptyScreen", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "terminal_screen_update",
      agent_id: "A-01",
      screen: "$ npm test",
    });
    expect(result[0].ptyScreen).toBe("$ npm test");
  });

  test("log_update appends log entry", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "log_update",
      agent_id: "A-01",
      log: { text: "hello", type: "info" },
    });
    expect(result[0].logs.length).toBe(1);
    expect(result[0].logs[0].text).toBe("hello");
  });

  test("log_update caps at 50 entries", () => {
    const agents = [makeAgent({ logs: Array.from({ length: 50 }, (_, i) => ({
      id: `log-${i}`, timestamp: "00:00:00", text: `line-${i}`, type: "info" as const,
    })) })];
    const result = applyMessage(agents, {
      type: "log_update",
      agent_id: "A-01",
      log: { text: "overflow", type: "info" },
    });
    expect(result[0].logs.length).toBe(50);
    expect(result[0].logs[49].text).toBe("overflow");
  });

  test("update (vlm_update) changes state and adds log", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "update",
      agent_id: "A-01",
      data: { agent_state: "STUCK", confidence_score: 42, reasoning: "loop detected" },
    });
    expect(result[0].state).toBe("STUCK");
    expect(result[0].confidence).toBe(42);
    expect(result[0].reasoning).toBe("loop detected");
    expect(result[0].logs.length).toBe(1);
    expect(result[0].logs[0].text).toContain("[VLM]");
  });

  test("unknown message type returns agents unchanged", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, { type: "unknown_type" });
    expect(result).toEqual(agents);
  });

  test("frame_update for non-existent agent is no-op", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "frame_update",
      agent_id: "NOPE",
      frame: "data",
    });
    expect(result[0].frame).toBeUndefined();
  });

  test("update to PAUSED state works", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "update",
      agent_id: "A-01",
      data: { agent_state: "PAUSED", confidence_score: 100, reasoning: "Agent paused by operator" },
    });
    expect(result[0].state).toBe("PAUSED");
    expect(result[0].confidence).toBe(100);
  });

  test("update to EXITED state works", () => {
    const agents = [makeAgent({ state: "STUCK" })];
    const result = applyMessage(agents, {
      type: "update",
      agent_id: "A-01",
      data: { agent_state: "EXITED", confidence_score: 100, reasoning: "Agent exited (code 137)" },
    });
    expect(result[0].state).toBe("EXITED");
    expect(result[0].reasoning).toBe("Agent exited (code 137)");
  });

  // ----- init with logs (lines 54-57) -----

  test("init creates agents with existing logs from server data", () => {
    const result = applyMessage([], {
      type: "init",
      data: {
        "A-01": {
          state: "PROGRESSING",
          confidence: 100,
          reasoning: "",
          logs: [
            { text: "Line 1", type: "info" },
            { text: "Line 2", type: "error" },
          ],
        },
      },
    });
    expect(result.length).toBe(1);
    expect(result[0].logs.length).toBe(2);
    expect(result[0].logs[0].text).toBe("Line 1");
    expect(result[0].logs[1].text).toBe("Line 2");
    expect(result[0].logs[0].id).toBeTruthy();
    expect(result[0].logs[0].timestamp).toBeTruthy();
    expect(result[0].logs[1].id).toBeTruthy();
    expect(result[0].logs[1].timestamp).toBeTruthy();
    expect(result[0].logs[0].id).not.toBe(result[0].logs[1].id);
  });

  test("init with empty logs array creates agent with no logs", () => {
    const result = applyMessage([], {
      type: "init",
      data: {
        "A-01": { state: "STUCK", confidence: 75, reasoning: "reason", logs: [] },
      },
    });
    expect(result[0].logs).toEqual([]);
  });

  test("init with undefined logs creates agent with no logs", () => {
    const result = applyMessage([], {
      type: "init",
      data: {
        "A-01": { state: "STUCK", confidence: 75, reasoning: "reason" },
      },
    });
    expect(result[0].logs).toEqual([]);
  });

  test("init with multiple agents at once", () => {
    const result = applyMessage([], {
      type: "init",
      data: {
        "A-01": { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [] },
        "A-02": { state: "STUCK", confidence: 30, reasoning: "loop", logs: [{ text: "err", type: "error" }] },
        "A-03": { state: "DANGEROUS", confidence: 10, reasoning: "rm -rf", logs: [] },
      },
    });
    expect(result.length).toBe(3);
    expect(result.map((a) => a.id).sort()).toEqual(["A-01", "A-02", "A-03"]);
    const a02 = result.find((a) => a.id === "A-02")!;
    expect(a02.state).toBe("STUCK");
    expect(a02.logs.length).toBe(1);
    expect(a02.logs[0].text).toBe("err");
  });

  test("init adds new agent to existing roster", () => {
    const existing = [makeAgent({ id: "A-01", name: "A-01" })];
    const result = applyMessage(existing, {
      type: "init",
      data: {
        "A-01": { state: "STUCK", confidence: 50, reasoning: "loop", logs: [] },
        "A-02": { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [{ text: "started", type: "info" }] },
      },
    });
    expect(result.length).toBe(2);
    const a01 = result.find((a) => a.id === "A-01")!;
    expect(a01.state).toBe("STUCK");
    expect(a01.confidence).toBe(50);
    const a02 = result.find((a) => a.id === "A-02")!;
    expect(a02.state).toBe("PROGRESSING");
    expect(a02.logs.length).toBe(1);
    expect(a02.logs[0].text).toBe("started");
  });

  // ----- update (vlm_update) additional branches -----

  test("update with PROGRESSING state creates info-type log", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "update",
      agent_id: "A-01",
      data: { agent_state: "PROGRESSING", confidence_score: 95, reasoning: "making progress" },
    });
    expect(result[0].state).toBe("PROGRESSING");
    expect(result[0].logs[0].type).toBe("info");
    expect(result[0].logs[0].text).toContain("making progress");
  });

  test("update with non-PROGRESSING state creates warn-type log", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "update",
      agent_id: "A-01",
      data: { agent_state: "HALLUCINATING", confidence_score: 20, reasoning: "fabricated output" },
    });
    expect(result[0].logs[0].type).toBe("warn");
  });

  test("update with empty reasoning falls back to state description", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "update",
      agent_id: "A-01",
      data: { agent_state: "DANGEROUS", confidence_score: 10, reasoning: "" },
    });
    expect(result[0].logs[0].text).toBe("[VLM] State updated to DANGEROUS");
  });

  test("update with zero confidence_score preserves existing confidence", () => {
    const agents = [makeAgent({ confidence: 88 })];
    const result = applyMessage(agents, {
      type: "update",
      agent_id: "A-01",
      data: { agent_state: "STUCK", confidence_score: 0, reasoning: "stuck" },
    });
    expect(result[0].confidence).toBe(88);
  });

  test("update for non-existent agent is no-op", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "update",
      agent_id: "NOPE",
      data: { agent_state: "STUCK", confidence_score: 10, reasoning: "loop" },
    });
    expect(result[0].state).toBe("PROGRESSING");
    expect(result[0].logs.length).toBe(0);
  });

  test("update caps logs at 20 entries", () => {
    const agents = [makeAgent({
      logs: Array.from({ length: 20 }, (_, i) => ({
        id: `log-${i}`, timestamp: "00:00:00", text: `vlm-${i}`, type: "warn" as const,
      })),
    })];
    const result = applyMessage(agents, {
      type: "update",
      agent_id: "A-01",
      data: { agent_state: "STUCK", confidence_score: 10, reasoning: "overflow" },
    });
    expect(result[0].logs.length).toBe(20);
    expect(result[0].logs[19].text).toContain("overflow");
    expect(result[0].logs[0].text).toBe("vlm-1");
  });

  // ----- log_update additional branches -----

  test("log_update with error type", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "log_update",
      agent_id: "A-01",
      log: { text: "fatal crash", type: "error" },
    });
    expect(result[0].logs[0].type).toBe("error");
  });

  test("log_update with system type", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "log_update",
      agent_id: "A-01",
      log: { text: "system boot", type: "system" },
    });
    expect(result[0].logs[0].type).toBe("system");
  });

  test("log_update with missing type defaults to info", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "log_update",
      agent_id: "A-01",
      log: { text: "no type field" },
    });
    expect(result[0].logs[0].type).toBe("info");
  });

  test("log_update for non-existent agent is no-op", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "log_update",
      agent_id: "NOPE",
      log: { text: "ghost", type: "info" },
    });
    expect(result[0].logs.length).toBe(0);
  });

  test("agent_disconnected for non-existent agent is no-op", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, { type: "agent_disconnected", agent_id: "NOPE" });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("A-01");
  });

  test("terminal_screen_update for non-existent agent is no-op", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "terminal_screen_update",
      agent_id: "NOPE",
      screen: "data",
    });
    expect(result[0].ptyScreen).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Dashboard frame pipeline coverage (v0.2.5)
  // ---------------------------------------------------------------------------

  describe("frame_update pipeline", () => {
    test("frame_update only updates the targeted agent in a multi-agent roster", () => {
      const agents = [
        makeAgent({ id: "A-01", name: "A-01" }),
        makeAgent({ id: "A-02", name: "A-02" }),
        makeAgent({ id: "A-03", name: "A-03" }),
      ];
      const result = applyMessage(agents, {
        type: "frame_update",
        agent_id: "A-02",
        frame: "jpeg-data-a02",
      });
      expect(result[0].frame).toBeUndefined();
      expect(result[1].frame).toBe("jpeg-data-a02");
      expect(result[2].frame).toBeUndefined();
    });

    test("frame_update with missing frame field sets undefined", () => {
      const agents = [makeAgent({ frame: "old-frame-data" })];
      const result = applyMessage(agents, {
        type: "frame_update",
        agent_id: "A-01",
      });
      expect(result[0].frame).toBeUndefined();
    });

    test("frame_update for unknown agent leaves all agents unchanged", () => {
      const agents = [
        makeAgent({ id: "A-01", name: "A-01", frame: "existing" }),
        makeAgent({ id: "A-02", name: "A-02" }),
      ];
      const result = applyMessage(agents, {
        type: "frame_update",
        agent_id: "GHOST",
        frame: "phantom-data",
      });
      expect(result.length).toBe(2);
      expect(result[0].frame).toBe("existing");
      expect(result[1].frame).toBeUndefined();
    });

    test("multiple rapid frame_updates keep only the latest frame", () => {
      let agents = [makeAgent()];
      const frames = ["frame-t0", "frame-t1", "frame-t2", "frame-t3", "frame-latest"];
      for (const f of frames) {
        agents = applyMessage(agents, {
          type: "frame_update",
          agent_id: "A-01",
          frame: f,
        });
      }
      expect(agents[0].frame).toBe("frame-latest");
    });

    test("frame_update and terminal_screen_update are independent", () => {
      let agents = [makeAgent()];

      agents = applyMessage(agents, { type: "frame_update", agent_id: "A-01", frame: "jpeg-base64" });
      expect(agents[0].frame).toBe("jpeg-base64");
      expect(agents[0].ptyScreen).toBeUndefined();

      agents = applyMessage(agents, { type: "terminal_screen_update", agent_id: "A-01", screen: "$ ls -la" });
      expect(agents[0].frame).toBe("jpeg-base64");
      expect(agents[0].ptyScreen).toBe("$ ls -la");

      agents = applyMessage(agents, { type: "frame_update", agent_id: "A-01", frame: "jpeg-base64-v2" });
      expect(agents[0].frame).toBe("jpeg-base64-v2");
      expect(agents[0].ptyScreen).toBe("$ ls -la");
    });

    test("interleaved frame + screen + vlm updates are all independent", () => {
      let agents = [makeAgent()];
      agents = applyMessage(agents, { type: "frame_update", agent_id: "A-01", frame: "f1" });
      agents = applyMessage(agents, { type: "terminal_screen_update", agent_id: "A-01", screen: "screen1" });
      agents = applyMessage(agents, {
        type: "update",
        agent_id: "A-01",
        data: { agent_state: "STUCK", confidence_score: 30, reasoning: "loop" },
      });
      expect(agents[0].frame).toBe("f1");
      expect(agents[0].ptyScreen).toBe("screen1");
      expect(agents[0].state).toBe("STUCK");
      expect(agents[0].confidence).toBe(30);
    });

    test("frame_update preserves other agent fields", () => {
      const agents = [makeAgent({
        state: "STUCK",
        confidence: 42,
        reasoning: "spinning",
        logs: [{ id: "log-1", timestamp: "12:00:00", text: "hello", type: "info" }],
      })];
      const result = applyMessage(agents, { type: "frame_update", agent_id: "A-01", frame: "new-frame" });
      expect(result[0].frame).toBe("new-frame");
      expect(result[0].state).toBe("STUCK");
      expect(result[0].confidence).toBe(42);
      expect(result[0].reasoning).toBe("spinning");
      expect(result[0].logs.length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// applyBatch — extracted batch processor
// ---------------------------------------------------------------------------

describe("applyBatch", () => {
  test("applies multiple messages in sequence", () => {
    const result = applyBatch([], [
      { type: "init", data: { "A-01": { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [] } } },
      { type: "log_update", agent_id: "A-01", log: { text: "hello", type: "info" } },
      { type: "log_update", agent_id: "A-01", log: { text: "world", type: "info" } },
    ]);
    expect(result.agents.length).toBe(1);
    expect(result.agents[0].logs.length).toBe(2);
  });

  test("returns selectFirst=true when batch contains init and agents exist", () => {
    const result = applyBatch([], [
      { type: "init", data: { "A-01": { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [] } } },
    ]);
    expect(result.selectFirst).toBe(true);
    expect(result.deselectId).toBeNull();
  });

  test("returns selectFirst=false when batch has no init", () => {
    const agents = [makeAgent()];
    const result = applyBatch(agents, [
      { type: "log_update", agent_id: "A-01", log: { text: "hello", type: "info" } },
    ]);
    expect(result.selectFirst).toBe(false);
  });

  test("returns selectFirst=false when init results in empty agents", () => {
    const result = applyBatch([], [{ type: "init", data: {} }]);
    expect(result.selectFirst).toBe(false);
    expect(result.agents.length).toBe(0);
  });

  test("returns deselectId when batch contains agent_disconnected", () => {
    const agents = [makeAgent(), makeAgent({ id: "A-02", name: "A-02" })];
    const result = applyBatch(agents, [{ type: "agent_disconnected", agent_id: "A-01" }]);
    expect(result.deselectId).toBe("A-01");
    expect(result.agents.length).toBe(1);
  });

  test("empty batch returns agents unchanged", () => {
    const agents = [makeAgent()];
    const result = applyBatch(agents, []);
    expect(result.agents).toEqual(agents);
    expect(result.selectFirst).toBe(false);
    expect(result.deselectId).toBeNull();
  });

  test("batch with both init and disconnect", () => {
    const result = applyBatch([], [
      {
        type: "init",
        data: {
          "A-01": { state: "PROGRESSING", confidence: 100, reasoning: "", logs: [] },
          "A-02": { state: "STUCK", confidence: 50, reasoning: "loop", logs: [] },
        },
      },
      { type: "agent_disconnected", agent_id: "A-01" },
    ]);
    expect(result.agents.length).toBe(1);
    expect(result.agents[0].id).toBe("A-02");
    expect(result.selectFirst).toBe(true);
    expect(result.deselectId).toBe("A-01");
  });
});

// ---------------------------------------------------------------------------
// buildCommand — extracted command builder
// ---------------------------------------------------------------------------

describe("buildCommand", () => {
  test("builds pause command", () => {
    expect(buildCommand("pause", "A-01")).toEqual({ type: "command", agent_id: "A-01", action: "pause" });
  });

  test("builds inject command with content", () => {
    expect(buildCommand("inject", "A-01", "fix the bug")).toEqual({
      type: "command", agent_id: "A-01", action: "inject", content: "fix the bug",
    });
  });

  test("returns null when agentId is empty", () => {
    expect(buildCommand("pause", "")).toBeNull();
  });

  test("includes content even if empty string", () => {
    const msg = buildCommand("inject", "A-01", "");
    expect(msg).not.toBeNull();
    expect(msg!.content).toBe("");
  });

  test("omits content when undefined", () => {
    const msg = buildCommand("pause", "A-01", undefined);
    expect("content" in msg!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseWsMessage — JSON parse with error handling
// ---------------------------------------------------------------------------

describe("parseWsMessage", () => {
  test("parses valid JSON", () => {
    expect(parseWsMessage('{"type":"init","data":{}}')).toEqual({ type: "init", data: {} });
  });

  test("returns null for invalid JSON", () => {
    expect(parseWsMessage("not json")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseWsMessage("")).toBeNull();
  });

  test("returns null for truncated JSON", () => {
    expect(parseWsMessage('{"type":"init"')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// nextReconnectDelay — exponential backoff
// ---------------------------------------------------------------------------

describe("nextReconnectDelay", () => {
  test("doubles the delay", () => {
    expect(nextReconnectDelay(1000)).toBe(2000);
  });

  test("caps at default max (30000)", () => {
    expect(nextReconnectDelay(16000)).toBe(30000);
  });

  test("caps at custom max", () => {
    expect(nextReconnectDelay(5000, 8000)).toBe(8000);
  });
});

// ---------------------------------------------------------------------------
// resolveSelectedId — selection logic after batch
// ---------------------------------------------------------------------------

describe("resolveSelectedId", () => {
  test("selects first agent when selectFirst=true and prevId is empty", () => {
    const result: BatchResult = { agents: [makeAgent()], selectFirst: true, deselectId: null };
    expect(resolveSelectedId("", result)).toBe("A-01");
  });

  test("keeps prevId when selectFirst=true but prevId already set", () => {
    const result: BatchResult = {
      agents: [makeAgent(), makeAgent({ id: "A-02" })],
      selectFirst: true, deselectId: null,
    };
    expect(resolveSelectedId("A-02", result)).toBe("A-02");
  });

  test("clears selection when deselectId matches prevId", () => {
    const result: BatchResult = { agents: [makeAgent({ id: "A-02" })], selectFirst: false, deselectId: "A-01" };
    expect(resolveSelectedId("A-01", result)).toBe("");
  });

  test("keeps prevId when deselectId does not match", () => {
    const result: BatchResult = { agents: [makeAgent()], selectFirst: false, deselectId: "A-03" };
    expect(resolveSelectedId("A-01", result)).toBe("A-01");
  });

  test("selectFirst then deselect same agent clears selection", () => {
    const result: BatchResult = { agents: [makeAgent()], selectFirst: true, deselectId: "A-01" };
    expect(resolveSelectedId("", result)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// findAgent — agent lookup helper
// ---------------------------------------------------------------------------

describe("findAgent", () => {
  test("finds agent by id", () => {
    const agents = [makeAgent(), makeAgent({ id: "A-02", name: "A-02" })];
    expect(findAgent(agents, "A-02")?.id).toBe("A-02");
  });

  test("returns undefined for non-existent id", () => {
    expect(findAgent([makeAgent()], "NOPE")).toBeUndefined();
  });

  test("returns undefined for empty array", () => {
    expect(findAgent([], "A-01")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createAgent — agent factory
// ---------------------------------------------------------------------------

describe("createAgent", () => {
  test("creates agent with default values", () => {
    const agent = createAgent("A-01");
    expect(agent.id).toBe("A-01");
    expect(agent.name).toBe("A-01");
    expect(agent.state).toBe("PROGRESSING");
    expect(agent.confidence).toBe(100);
    expect(agent.logs).toEqual([]);
  });

  test("creates agent with overrides", () => {
    const agent = createAgent("A-02", { state: "STUCK", confidence: 30 });
    expect(agent.state).toBe("STUCK");
    expect(agent.confidence).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// isKnownMessageType — type guard
// ---------------------------------------------------------------------------

describe("isKnownMessageType", () => {
  for (const type of ["init", "agent_disconnected", "frame_update", "terminal_screen_update", "log_update", "update"]) {
    test(`recognizes ${type}`, () => {
      expect(isKnownMessageType({ type })).toBe(true);
    });
  }

  test("rejects unknown type", () => {
    expect(isKnownMessageType({ type: "foobar" })).toBe(false);
  });

  test("rejects missing type", () => {
    expect(isKnownMessageType({})).toBe(false);
  });

  test("rejects non-string type", () => {
    expect(isKnownMessageType({ type: 42 })).toBe(false);
  });

  test("recognizes telemetry_update", () => {
    expect(isKnownMessageType({ type: "telemetry_update" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildCommand — stoprun and steer actions (v0.2.6)
// ---------------------------------------------------------------------------

describe("buildCommand — stoprun and steer", () => {
  test("builds stoprun command with content", () => {
    expect(buildCommand("stoprun", "A-01", "run-123")).toEqual({
      type: "command",
      agent_id: "A-01",
      action: "stoprun",
      content: "run-123",
    });
  });

  test("builds steer command with content", () => {
    expect(buildCommand("steer", "A-01", "focus on tests")).toEqual({
      type: "command",
      agent_id: "A-01",
      action: "steer",
      content: "focus on tests",
    });
  });
});

// ---------------------------------------------------------------------------
// telemetry_update handling (v0.2.6)
// ---------------------------------------------------------------------------

describe("telemetry_update handling", () => {
  test("telemetry_update sets telemetry on correct agent", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "tool_execution_start",
      run_id: "run-123",
      data: { tool_name: "bash", args: { cmd: "ls" } },
      telemetry: { context_percent: 42.5, active_runs: 2 },
    });
    expect(result[0].telemetry).toBeDefined();
    expect(result[0].telemetry!.eventType).toBe("tool_execution_start");
    expect(result[0].telemetry!.runId).toBe("run-123");
    expect(result[0].telemetry!.contextPercent).toBe(42.5);
    expect(result[0].telemetry!.activeRuns).toBe(2);
  });

  test("telemetry_update with tool_execution_start populates toolName", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "tool_execution_start",
      run_id: "run-1",
      data: { tool_name: "bash", args: { cmd: "npm test" } },
      telemetry: { context_percent: 50, active_runs: 1 },
    });
    expect(result[0].telemetry!.toolName).toBe("bash");
  });

  test("telemetry_update without tool_name leaves toolName undefined", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "agent_start",
      run_id: "run-1",
      data: {},
      telemetry: { context_percent: 10, active_runs: 1 },
    });
    expect(result[0].telemetry!.toolName).toBeUndefined();
  });

  test("telemetry_update with args truncates to 80 chars", () => {
    const longArgs = { cmd: "a".repeat(200) };
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "tool_execution_start",
      run_id: "run-1",
      data: { tool_name: "bash", args: longArgs },
      telemetry: { context_percent: 20, active_runs: 1 },
    });
    expect(result[0].telemetry!.toolArgs).toBeDefined();
    expect(result[0].telemetry!.toolArgs!.length).toBe(80);
  });

  test("telemetry_update with no args leaves toolArgs undefined", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "tool_execution_end",
      run_id: "run-1",
      data: { tool_name: "bash" },
      telemetry: { context_percent: 30, active_runs: 1 },
    });
    expect(result[0].telemetry!.toolArgs).toBeUndefined();
  });

  test("telemetry_update for non-existent agent is no-op", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "GHOST",
      event_type: "tool_execution_start",
      run_id: "run-1",
      data: { tool_name: "bash" },
      telemetry: { context_percent: 50, active_runs: 1 },
    });
    expect(result[0].telemetry).toBeUndefined();
  });

  test("telemetry_update preserves other agent fields (state, confidence, frame, logs)", () => {
    const agents = [makeAgent({
      state: "STUCK",
      confidence: 42,
      reasoning: "spinning",
      frame: "jpeg-data",
      logs: [{ id: "log-1", timestamp: "12:00:00", text: "hello", type: "info" }],
    })];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "tool_execution_start",
      run_id: "run-1",
      data: { tool_name: "bash" },
      telemetry: { context_percent: 50, active_runs: 1 },
    });
    expect(result[0].state).toBe("STUCK");
    expect(result[0].confidence).toBe(42);
    expect(result[0].reasoning).toBe("spinning");
    expect(result[0].frame).toBe("jpeg-data");
    expect(result[0].logs.length).toBe(1);
    expect(result[0].telemetry).toBeDefined();
  });

  test("telemetry_update only updates targeted agent in multi-agent roster", () => {
    const agents = [
      makeAgent({ id: "A-01", name: "A-01" }),
      makeAgent({ id: "A-02", name: "A-02" }),
      makeAgent({ id: "A-03", name: "A-03" }),
    ];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-02",
      event_type: "tool_execution_start",
      run_id: "run-99",
      data: { tool_name: "python" },
      telemetry: { context_percent: 80, active_runs: 3 },
    });
    expect(result[0].telemetry).toBeUndefined();
    expect(result[1].telemetry).toBeDefined();
    expect(result[1].telemetry!.runId).toBe("run-99");
    expect(result[2].telemetry).toBeUndefined();
  });

  test("multiple telemetry_updates keep only latest telemetry", () => {
    let agents = [makeAgent()];
    agents = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "tool_execution_start",
      run_id: "run-1",
      data: { tool_name: "bash" },
      telemetry: { context_percent: 10, active_runs: 1 },
    });
    agents = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "tool_execution_end",
      run_id: "run-2",
      data: { tool_name: "python" },
      telemetry: { context_percent: 90, active_runs: 5 },
    });
    expect(agents[0].telemetry!.eventType).toBe("tool_execution_end");
    expect(agents[0].telemetry!.runId).toBe("run-2");
    expect(agents[0].telemetry!.toolName).toBe("python");
    expect(agents[0].telemetry!.contextPercent).toBe(90);
    expect(agents[0].telemetry!.activeRuns).toBe(5);
  });

  test("telemetry_update with context_percent=0 stores 0 (not fallback)", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "agent_start",
      run_id: "run-1",
      data: {},
      telemetry: { context_percent: 0, active_runs: 1 },
    });
    expect(result[0].telemetry!.contextPercent).toBe(0);
  });

  test("telemetry_update with missing telemetry object defaults to 0", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "agent_start",
      run_id: "run-1",
      data: {},
    });
    expect(result[0].telemetry!.contextPercent).toBe(0);
    expect(result[0].telemetry!.activeRuns).toBe(0);
  });

  test("telemetry_update after vlm_update preserves VLM state", () => {
    let agents = [makeAgent()];
    agents = applyMessage(agents, {
      type: "update",
      agent_id: "A-01",
      data: { agent_state: "STUCK", confidence_score: 30, reasoning: "loop detected" },
    });
    expect(agents[0].state).toBe("STUCK");
    expect(agents[0].confidence).toBe(30);

    agents = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "tool_execution_start",
      run_id: "run-1",
      data: { tool_name: "bash" },
      telemetry: { context_percent: 50, active_runs: 1 },
    });
    expect(agents[0].state).toBe("STUCK");
    expect(agents[0].confidence).toBe(30);
    expect(agents[0].reasoning).toBe("loop detected");
    expect(agents[0].telemetry).toBeDefined();
    expect(agents[0].telemetry!.toolName).toBe("bash");
  });

  test("telemetry_update sets non-empty lastUpdated string", () => {
    const agents = [makeAgent()];
    const result = applyMessage(agents, {
      type: "telemetry_update",
      agent_id: "A-01",
      event_type: "turn_start",
      run_id: "run-1",
      data: {},
      telemetry: { context_percent: 25, active_runs: 1 },
    });
    expect(result[0].telemetry!.lastUpdated).toBeTruthy();
    expect(typeof result[0].telemetry!.lastUpdated).toBe("string");
    expect(result[0].telemetry!.lastUpdated.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// applyBatch — telemetry (v0.2.6)
// ---------------------------------------------------------------------------

describe("applyBatch — telemetry", () => {
  test("batch with telemetry_update applies correctly", () => {
    const agents = [makeAgent()];
    const result = applyBatch(agents, [
      {
        type: "telemetry_update",
        agent_id: "A-01",
        event_type: "tool_execution_start",
        run_id: "run-1",
        data: { tool_name: "bash", args: { cmd: "ls" } },
        telemetry: { context_percent: 42.5, active_runs: 2 },
      },
    ]);
    expect(result.agents[0].telemetry).toBeDefined();
    expect(result.agents[0].telemetry!.eventType).toBe("tool_execution_start");
    expect(result.agents[0].telemetry!.runId).toBe("run-1");
    expect(result.agents[0].telemetry!.toolName).toBe("bash");
  });

  test("interleaved telemetry + vlm + frame updates are independent", () => {
    const agents = [makeAgent()];
    const result = applyBatch(agents, [
      {
        type: "telemetry_update",
        agent_id: "A-01",
        event_type: "tool_execution_start",
        run_id: "run-1",
        data: { tool_name: "bash" },
        telemetry: { context_percent: 50, active_runs: 1 },
      },
      {
        type: "update",
        agent_id: "A-01",
        data: { agent_state: "STUCK", confidence_score: 30, reasoning: "loop" },
      },
      {
        type: "frame_update",
        agent_id: "A-01",
        frame: "jpeg-data",
      },
    ]);
    expect(result.agents[0].telemetry!.toolName).toBe("bash");
    expect(result.agents[0].state).toBe("STUCK");
    expect(result.agents[0].confidence).toBe(30);
    expect(result.agents[0].frame).toBe("jpeg-data");
  });

  test("telemetry_update in batch does not trigger selectFirst or deselectId", () => {
    const agents = [makeAgent()];
    const result = applyBatch(agents, [
      {
        type: "telemetry_update",
        agent_id: "A-01",
        event_type: "agent_start",
        run_id: "run-1",
        data: {},
        telemetry: { context_percent: 10, active_runs: 1 },
      },
    ]);
    expect(result.selectFirst).toBe(false);
    expect(result.deselectId).toBeNull();
  });
});
