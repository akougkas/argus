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
});
