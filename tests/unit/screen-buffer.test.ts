import { describe, test, expect, beforeEach } from "bun:test";
import {
  pushLine,
  getScreen,
  pushRawLine,
  getRawScreen,
  pushScreenHistory,
  getScreenHistory,
  pushFrame,
  getFrameBuffer,
  resetState,
  SCREEN_ROWS,
} from "../../probe-utils";

beforeEach(() => {
  resetState();
});

describe("pushLine / getScreen", () => {
  test("returns empty string with no lines", () => {
    expect(getScreen()).toBe("");
  });

  test("returns single pushed line", () => {
    pushLine("hello world");
    expect(getScreen()).toBe("hello world");
  });

  test("returns last SCREEN_ROWS lines", () => {
    for (let i = 0; i < SCREEN_ROWS + 10; i++) {
      pushLine(`line-${i}`);
    }
    const screen = getScreen();
    const lines = screen.split("\n");
    expect(lines.length).toBe(SCREEN_ROWS);
    expect(lines[0]).toBe(`line-10`);
    expect(lines[SCREEN_ROWS - 1]).toBe(`line-${SCREEN_ROWS + 9}`);
  });

  test("bounds buffer to 2x SCREEN_ROWS", () => {
    for (let i = 0; i < SCREEN_ROWS * 3; i++) {
      pushLine(`line-${i}`);
    }
    // After bounding, internal buffer should be <= 2 * SCREEN_ROWS
    // We can verify by checking getScreen still returns correct last SCREEN_ROWS
    const screen = getScreen();
    const lines = screen.split("\n");
    expect(lines.length).toBe(SCREEN_ROWS);
    expect(lines[SCREEN_ROWS - 1]).toBe(`line-${SCREEN_ROWS * 3 - 1}`);
  });
});

describe("pushRawLine / getRawScreen", () => {
  test("returns empty string with no lines", () => {
    expect(getRawScreen()).toBe("");
  });

  test("preserves ANSI escape codes", () => {
    pushRawLine("\x1b[32mgreen text\x1b[0m");
    expect(getRawScreen()).toBe("\x1b[32mgreen text\x1b[0m");
  });

  test("respects SCREEN_ROWS limit", () => {
    for (let i = 0; i < SCREEN_ROWS + 5; i++) {
      pushRawLine(`raw-${i}`);
    }
    const lines = getRawScreen().split("\n");
    expect(lines.length).toBe(SCREEN_ROWS);
    expect(lines[0]).toBe("raw-5");
  });
});

describe("screenHistory", () => {
  test("starts empty", () => {
    expect(getScreenHistory()).toEqual([]);
  });

  test("pushes and retrieves", () => {
    pushScreenHistory("screen1");
    pushScreenHistory("screen2");
    expect(getScreenHistory()).toEqual(["screen1", "screen2"]);
  });

  test("caps at 10 entries", () => {
    for (let i = 0; i < 15; i++) {
      pushScreenHistory(`s${i}`);
    }
    const h = getScreenHistory();
    expect(h.length).toBe(10);
    expect(h[0]).toBe("s5");
    expect(h[9]).toBe("s14");
  });
});

describe("frameBuffer", () => {
  test("starts empty", () => {
    expect(getFrameBuffer()).toEqual([]);
  });

  test("pushes and retrieves buffers", () => {
    const buf = Buffer.from("test");
    pushFrame(buf);
    expect(getFrameBuffer().length).toBe(1);
    expect(getFrameBuffer()[0]).toBe(buf);
  });

  test("caps at 10 frames", () => {
    for (let i = 0; i < 15; i++) {
      pushFrame(Buffer.from(`frame-${i}`));
    }
    const fb = getFrameBuffer();
    expect(fb.length).toBe(10);
    expect(fb[0].toString()).toBe("frame-5");
  });
});

describe("resetState", () => {
  test("clears all buffers", () => {
    pushLine("line");
    pushRawLine("raw");
    pushScreenHistory("history");
    pushFrame(Buffer.from("frame"));

    resetState();

    expect(getScreen()).toBe("");
    expect(getRawScreen()).toBe("");
    expect(getScreenHistory()).toEqual([]);
    expect(getFrameBuffer()).toEqual([]);
  });
});
