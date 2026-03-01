import { describe, test, expect, beforeEach } from "bun:test";
import { pipeStream, getScreen, getRawScreen, resetState } from "../../probe-utils";

beforeEach(() => {
  resetState();
});

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function collectLogs() {
  const logs: Array<{ text: string; type?: string }> = [];
  return {
    fn: (text: string, type?: string) => { logs.push({ text, type }); },
    logs,
  };
}

describe("pipeStream", () => {
  test("does nothing for null stream", async () => {
    const log = collectLogs();
    await pipeStream(null, "stdout", log.fn);
    expect(log.logs.length).toBe(0);
  });

  test("splits lines and pushes to screen buffer", async () => {
    const log = collectLogs();
    const stream = makeStream(["line1\nline2\nline3\n"]);

    await pipeStream(stream, "stdout", log.fn);

    expect(getScreen()).toContain("line1");
    expect(getScreen()).toContain("line2");
    expect(getScreen()).toContain("line3");
    expect(log.logs.length).toBe(3);
  });

  test("handles chunked data across multiple reads", async () => {
    const log = collectLogs();
    const stream = makeStream(["hel", "lo wo", "rld\n"]);

    await pipeStream(stream, "stdout", log.fn);

    expect(log.logs.length).toBe(1);
    expect(log.logs[0].text).toBe("hello world");
  });

  test("strips ANSI for clean screen, preserves for raw", async () => {
    const log = collectLogs();
    const stream = makeStream(["\x1b[32mgreen\x1b[0m\n"]);

    await pipeStream(stream, "stdout", log.fn);

    expect(getScreen()).toBe("green");
    expect(getRawScreen()).toBe("\x1b[32mgreen\x1b[0m");
  });

  test("labels stderr lines as errors", async () => {
    const log = collectLogs();
    const stream = makeStream(["stderr line\n"]);

    await pipeStream(stream, "stderr", log.fn);

    expect(log.logs[0].type).toBe("error");
  });

  test("detects error keywords in stdout", async () => {
    const log = collectLogs();
    const stream = makeStream(["TypeError: undefined\n"]);

    await pipeStream(stream, "stdout", log.fn);

    expect(log.logs[0].type).toBe("error");
  });

  test("normal stdout lines are info", async () => {
    const log = collectLogs();
    const stream = makeStream(["all good\n"]);

    await pipeStream(stream, "stdout", log.fn);

    expect(log.logs[0].type).toBe("info");
  });

  test("skips empty lines", async () => {
    const log = collectLogs();
    const stream = makeStream(["line1\n\n\nline2\n"]);

    await pipeStream(stream, "stdout", log.fn);

    expect(log.logs.length).toBe(2);
  });
});
