import { describe, test, expect, afterEach } from "bun:test";
import { createTerminal, type TerminalWrapper } from "../../src/probe/terminal";

let term: TerminalWrapper | null = null;

afterEach(() => {
  term?.dispose();
  term = null;
});

describe("PTY pipeline integration", () => {
  test("script -qefc captures command output into terminal grid", async () => {
    term = createTerminal(80, 24);

    // Spawn a real process via script
    const proc = Bun.spawn(
      ["script", "-qefc", "echo 'hello from PTY'", "/dev/null"],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, TERM: "xterm-256color" } },
    );

    // Read stdout into terminal
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await term.write(decoder.decode(value, { stream: true }));
      }
    } catch { /* stream closed */ }

    await proc.exited;

    const grid = term.getGrid();
    const textLines = grid.text.split("\n").filter((l) => l.trim());
    // Should contain the echoed text somewhere in the grid
    const hasOutput = textLines.some((l) => l.includes("hello from PTY"));
    expect(hasOutput).toBe(true);
  });

  test("script captures colored output with SGR codes", async () => {
    term = createTerminal(80, 24);

    // printf with ANSI color codes
    const proc = Bun.spawn(
      ["script", "-qefc", "printf '\\033[31mred text\\033[0m'", "/dev/null"],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, TERM: "xterm-256color" } },
    );

    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await term.write(decoder.decode(value, { stream: true }));
      }
    } catch { /* stream closed */ }

    await proc.exited;

    const grid = term.getGrid();
    // Plain text should have the content
    expect(grid.text).toContain("red text");
    // ANSI output should have SGR codes for red
    expect(grid.ansi).toContain("red text");
    expect(grid.ansi).toContain("\x1b[");
  });

  test("script + stty sets terminal dimensions", async () => {
    const cols = 40;
    const rows = 10;
    term = createTerminal(cols, rows);

    const proc = Bun.spawn(
      ["script", "-qefc", `stty rows ${rows} cols ${cols} 2>/dev/null; echo "sized"`, "/dev/null"],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, TERM: "xterm-256color" } },
    );

    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await term.write(decoder.decode(value, { stream: true }));
      }
    } catch { /* stream closed */ }

    await proc.exited;

    // Grid should have the right dimensions
    const grid = term.getGrid();
    const lines = grid.text.split("\n");
    expect(lines.length).toBe(rows);
    expect(grid.text).toContain("sized");
  });
});
