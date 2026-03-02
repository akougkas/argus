import { describe, test, expect, mock } from "bun:test";
import { handleCommand, type ChildProcessLike } from "../../../src/probe/probe-utils";

function makeMockProc(pid = 12345): ChildProcessLike & { killed: boolean; written: string[] } {
  const proc = {
    pid,
    stdin: {
      write: mock((data: string) => { proc.written.push(data); }),
    },
    kill: mock(() => { proc.killed = true; }),
    killed: false,
    written: [] as string[],
  };
  return proc;
}

function makeSendLog() {
  const calls: Array<{ text: string; type?: string }> = [];
  return {
    fn: (text: string, type?: string) => { calls.push({ text, type }); },
    calls,
  };
}

function makeSendState() {
  const calls: Array<{ state: string; confidence: number; reasoning: string }> = [];
  return {
    fn: (state: string, confidence: number, reasoning: string) => { calls.push({ state, confidence, reasoning }); },
    calls,
  };
}

describe("handleCommand", () => {
  test("pause sends SIGSTOP and PAUSED state", () => {
    const proc = makeMockProc();
    const log = makeSendLog();
    const state = makeSendState();
    const origKill = process.kill;
    const killCalls: Array<{ pid: number; signal: string }> = [];
    process.kill = ((pid: number, signal: string) => { killCalls.push({ pid, signal }); }) as typeof process.kill;

    handleCommand({ type: "command", action: "pause" }, proc, log.fn, state.fn);

    expect(killCalls.length).toBe(1);
    expect(killCalls[0].signal).toBe("SIGSTOP");
    expect(killCalls[0].pid).toBe(12345);
    expect(log.calls.length).toBe(1);
    expect(log.calls[0].text).toContain("paused");
    expect(state.calls.length).toBe(1);
    expect(state.calls[0].state).toBe("PAUSED");

    process.kill = origKill;
  });

  test("resume sends SIGCONT and PROGRESSING state", () => {
    const proc = makeMockProc();
    const log = makeSendLog();
    const state = makeSendState();
    const origKill = process.kill;
    const killCalls: Array<{ pid: number; signal: string }> = [];
    process.kill = ((pid: number, signal: string) => { killCalls.push({ pid, signal }); }) as typeof process.kill;

    handleCommand({ type: "command", action: "resume" }, proc, log.fn, state.fn);

    expect(killCalls[0].signal).toBe("SIGCONT");
    expect(log.calls[0].text).toContain("resumed");
    expect(state.calls[0].state).toBe("PROGRESSING");

    process.kill = origKill;
  });

  test("kill calls proc.kill(9) — no state sent (exit handler does that)", () => {
    const proc = makeMockProc();
    const log = makeSendLog();
    const state = makeSendState();

    handleCommand({ type: "command", action: "kill" }, proc, log.fn, state.fn);

    expect(proc.kill).toHaveBeenCalledWith(9);
    expect(log.calls[0].text).toContain("killed");
    // EXITED state is sent by child exit handler, not here
    expect(state.calls.length).toBe(0);
  });

  test("inject writes to stdin", () => {
    const proc = makeMockProc();
    const log = makeSendLog();
    const state = makeSendState();

    handleCommand({ type: "command", action: "inject", content: "fix it" }, proc, log.fn, state.fn);

    expect(proc.written).toEqual(["fix it\n"]);
    expect(log.calls[0].text).toContain("fix it");
  });

  test("inject with no content does nothing", () => {
    const proc = makeMockProc();
    const log = makeSendLog();
    const state = makeSendState();

    handleCommand({ type: "command", action: "inject" }, proc, log.fn, state.fn);

    expect(proc.written).toEqual([]);
    expect(log.calls.length).toBe(0);
  });

  test("no-op when childProc is null", () => {
    const log = makeSendLog();
    const state = makeSendState();
    handleCommand({ type: "command", action: "kill" }, null, log.fn, state.fn);
    expect(log.calls.length).toBe(0);
    expect(state.calls.length).toBe(0);
  });

  test("inject with null stdin does nothing", () => {
    const proc = { pid: 1, stdin: null, kill: mock(() => {}), killed: false, written: [] };
    const log = makeSendLog();
    const state = makeSendState();

    handleCommand({ type: "command", action: "inject", content: "hello" }, proc, log.fn, state.fn);

    expect(log.calls.length).toBe(0);
  });

  // --- Steering commands (v0.2.6) ---

  test("stoprun with valid content writes /stoprun to stdin", () => {
    const proc = makeMockProc();
    const log = makeSendLog();
    const state = makeSendState();

    handleCommand({ type: "command", action: "stoprun", content: "run-abc-123" }, proc, log.fn, state.fn);

    expect(proc.written).toEqual(["/stoprun run-abc-123\n"]);
    expect(log.calls.length).toBe(1);
    expect(log.calls[0].text).toBe("Steering: /stoprun run-abc-123");
    expect(log.calls[0].type).toBe("system");
  });

  test("steer with valid content writes /steer to stdin", () => {
    const proc = makeMockProc();
    const log = makeSendLog();
    const state = makeSendState();

    handleCommand({ type: "command", action: "steer", content: "focus on tests" }, proc, log.fn, state.fn);

    expect(proc.written).toEqual(["/steer focus on tests\n"]);
    expect(log.calls.length).toBe(1);
    expect(log.calls[0].text).toBe("Steering: /steer focus on tests");
    expect(log.calls[0].type).toBe("system");
  });

  test("stoprun with empty content does NOT write to stdin", () => {
    const proc = makeMockProc();
    const log = makeSendLog();
    const state = makeSendState();

    handleCommand({ type: "command", action: "stoprun", content: "" }, proc, log.fn, state.fn);

    expect(proc.written).toEqual([]);
    expect(log.calls.length).toBe(0);
  });

  test("steer with no content does NOT write to stdin", () => {
    const proc = makeMockProc();
    const log = makeSendLog();
    const state = makeSendState();

    handleCommand({ type: "command", action: "steer" }, proc, log.fn, state.fn);

    expect(proc.written).toEqual([]);
    expect(log.calls.length).toBe(0);
  });

  test("stoprun sends system log with steering command", () => {
    const proc = makeMockProc();
    const log = makeSendLog();
    const state = makeSendState();

    handleCommand({ type: "command", action: "stoprun", content: "run-xyz" }, proc, log.fn, state.fn);

    expect(log.calls.length).toBe(1);
    expect(log.calls[0].type).toBe("system");
    expect(log.calls[0].text).toContain("/stoprun run-xyz");
    // Steering does not change agent state
    expect(state.calls.length).toBe(0);
  });
});
