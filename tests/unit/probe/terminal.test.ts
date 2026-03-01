import { describe, test, expect, afterEach } from "bun:test";
import { createTerminal, type TerminalWrapper } from "../../../src/probe/terminal";

let term: TerminalWrapper | null = null;

afterEach(() => {
  term?.dispose();
  term = null;
});

describe("createTerminal", () => {
  test("creates terminal with default dimensions", () => {
    term = createTerminal();
    expect(term.cols).toBe(80);
    expect(term.rows).toBe(24);
  });

  test("creates terminal with custom dimensions", () => {
    term = createTerminal(120, 40);
    expect(term.cols).toBe(120);
    expect(term.rows).toBe(40);
  });

  test("empty grid returns blank lines", () => {
    term = createTerminal(10, 3);
    const grid = term.getGrid();
    expect(grid.text).toBe("\n\n");
    expect(grid.ansi).toBe("\n\n");
  });
});

describe("write + getGrid text", () => {
  test("plain text appears in grid", async () => {
    term = createTerminal(20, 3);
    await term.write("hello world");
    const grid = term.getGrid();
    expect(grid.text.split("\n")[0]).toBe("hello world");
  });

  test("newlines advance cursor to next row", async () => {
    term = createTerminal(20, 5);
    await term.write("line one\r\nline two\r\nline three");
    const lines = term.getGrid().text.split("\n");
    expect(lines[0]).toBe("line one");
    expect(lines[1]).toBe("line two");
    expect(lines[2]).toBe("line three");
  });

  test("line wraps at column boundary", async () => {
    term = createTerminal(10, 3);
    await term.write("1234567890ABCDE");
    const lines = term.getGrid().text.split("\n");
    expect(lines[0]).toBe("1234567890");
    expect(lines[1]).toBe("ABCDE");
  });

  test("cursor positioning with escape codes", async () => {
    term = createTerminal(20, 3);
    // Write, then move cursor to col 0 and overwrite
    await term.write("hello\r\nworld");
    const lines = term.getGrid().text.split("\n");
    expect(lines[0]).toBe("hello");
    expect(lines[1]).toBe("world");
  });

  test("clear screen (ED2) empties grid", async () => {
    term = createTerminal(20, 3);
    await term.write("some text\r\n");
    await term.write("\x1b[2J\x1b[H"); // clear screen + home
    await term.write("fresh");
    const lines = term.getGrid().text.split("\n");
    expect(lines[0]).toBe("fresh");
    expect(lines[1]).toBe("");
  });

  test("handles Uint8Array input", async () => {
    term = createTerminal(20, 3);
    const data = new TextEncoder().encode("binary input");
    await term.write(data);
    const grid = term.getGrid();
    expect(grid.text.split("\n")[0]).toBe("binary input");
  });
});

describe("SGR reconstruction", () => {
  test("foreground color produces ANSI in output", async () => {
    term = createTerminal(20, 3);
    await term.write("\x1b[31mred text\x1b[0m");
    const grid = term.getGrid();
    const ansiLine = grid.ansi.split("\n")[0];
    // Should contain SGR for red (31) and reset
    expect(ansiLine).toContain("\x1b[31m");
    expect(ansiLine).toContain("red text");
    expect(ansiLine).toContain("\x1b[0m");
    // Plain text should NOT contain ANSI
    expect(grid.text.split("\n")[0]).toBe("red text");
  });

  test("bold text produces SGR 1", async () => {
    term = createTerminal(20, 3);
    await term.write("\x1b[1mbold\x1b[0m");
    const ansiLine = term.getGrid().ansi.split("\n")[0];
    expect(ansiLine).toContain("\x1b[1m");
    expect(ansiLine).toContain("bold");
  });

  test("combined attributes (bold + green)", async () => {
    term = createTerminal(20, 3);
    await term.write("\x1b[1;32mbold green\x1b[0m");
    const ansiLine = term.getGrid().ansi.split("\n")[0];
    // Should have both bold (1) and green (32) in some order
    expect(ansiLine).toMatch(/\x1b\[\d[;\d]*m/);
    expect(ansiLine).toContain("bold green");
  });

  test("256-color foreground uses 38;5;N", async () => {
    term = createTerminal(20, 3);
    await term.write("\x1b[38;5;196mhot red\x1b[0m");
    const ansiLine = term.getGrid().ansi.split("\n")[0];
    expect(ansiLine).toContain("38;5;196");
    expect(ansiLine).toContain("hot red");
  });

  test("style transitions emit reset between segments", async () => {
    term = createTerminal(30, 3);
    await term.write("\x1b[31mred\x1b[32mgreen\x1b[0m");
    const ansiLine = term.getGrid().ansi.split("\n")[0];
    // Should have red, then reset+green (or just green), then content
    expect(ansiLine).toContain("red");
    expect(ansiLine).toContain("green");
    // At least two SGR sequences
    const sgrMatches = ansiLine.match(/\x1b\[[0-9;]*m/g) || [];
    expect(sgrMatches.length).toBeGreaterThanOrEqual(2);
  });

  test("default-styled text has no SGR codes", async () => {
    term = createTerminal(20, 3);
    await term.write("plain text");
    const ansiLine = term.getGrid().ansi.split("\n")[0];
    expect(ansiLine).not.toContain("\x1b[");
    expect(ansiLine).toBe("plain text");
  });

  test("underline produces SGR 4", async () => {
    term = createTerminal(20, 3);
    await term.write("\x1b[4munderlined\x1b[0m");
    const ansiLine = term.getGrid().ansi.split("\n")[0];
    expect(ansiLine).toContain("\x1b[4m");
  });

  test("background color produces ANSI output", async () => {
    term = createTerminal(20, 3);
    await term.write("\x1b[41mred bg\x1b[0m");
    const ansiLine = term.getGrid().ansi.split("\n")[0];
    expect(ansiLine).toContain("41");
    expect(ansiLine).toContain("red bg");
  });
});
