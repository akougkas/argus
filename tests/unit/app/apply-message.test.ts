import { describe, test, expect } from "bun:test";
import { applyMessage, type Agent } from "../../../src/app/useAgentSocket";

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
});
