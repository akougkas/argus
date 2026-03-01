import { describe, test, expect } from "bun:test";
import { ansiToSvg } from "../../../src/probe/ansi-to-svg";

describe("ansiToSvg", () => {
  test("empty input returns valid SVG", () => {
    const svg = ansiToSvg("");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("xmlns=");
  });

  test("plain text renders as text element", () => {
    const svg = ansiToSvg("hello world");
    expect(svg).toContain("<text");
    expect(svg).toContain("hello world");
    expect(svg).toContain("</text>");
  });

  test("red text renders with red fill", () => {
    const svg = ansiToSvg("\x1b[31mhello\x1b[0m");
    expect(svg).toContain('fill="#aa0000"');
    expect(svg).toContain("hello");
  });

  test("bright green text renders with bright green fill", () => {
    const svg = ansiToSvg("\x1b[92mok\x1b[0m");
    expect(svg).toContain('fill="#55ff55"');
  });

  test("bold text renders with font-weight bold", () => {
    const svg = ansiToSvg("\x1b[1mbold text\x1b[0m");
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain("bold text");
  });

  test("background color renders a rect", () => {
    const svg = ansiToSvg("\x1b[41mred bg\x1b[0m");
    // Background rect with red color (ANSI color 1)
    expect(svg).toMatch(/rect.*fill="#aa0000"/);
    expect(svg).toContain("red bg");
  });

  test("multi-line input renders multiple rows", () => {
    const svg = ansiToSvg("line1\nline2\nline3");
    // Should have 3 text elements at different y positions
    const textMatches = svg.match(/<text /g);
    expect(textMatches?.length).toBe(3);
  });

  test("HTML special characters are escaped", () => {
    const svg = ansiToSvg('x < y & z > w "q"');
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&quot;");
  });

  test("custom colors override defaults", () => {
    const svg = ansiToSvg("test", {
      colors: {
        backgroundColor: "#0a0a0a",
        foregroundColor: "#00ff41",
      },
    });
    expect(svg).toContain('fill="#0a0a0a"'); // background rect
    expect(svg).toContain('fill="#00ff41"'); // g element fill
  });

  test("custom font options applied", () => {
    const svg = ansiToSvg("test", {
      fontFace: "JetBrains Mono, Courier",
      fontSize: 14,
      lineHeight: 18,
    });
    expect(svg).toContain('font-family="JetBrains Mono, Courier"');
    expect(svg).toContain('font-size="14"');
  });

  test("reset code clears styling", () => {
    const svg = ansiToSvg("\x1b[31mred\x1b[0m normal");
    // "red" should have red fill, "normal" should not
    const parts = svg.split("</text>");
    const redPart = parts.find(p => p.includes("red") && !p.includes("normal"));
    const normalPart = parts.find(p => p.includes(" normal"));
    expect(redPart).toContain('fill="#aa0000"');
    // Normal text should NOT have a fill override (inherits from <g>)
    expect(normalPart).not.toContain('fill="#aa0000"');
  });

  test("underline renders a path element", () => {
    const svg = ansiToSvg("\x1b[4munderlined\x1b[0m");
    expect(svg).toContain("<path");
    expect(svg).toContain('stroke=');
  });

  test("256-color foreground (38;5;n) renders correctly", () => {
    // Color 196 = bright red (#ff0000)
    const svg = ansiToSvg("\x1b[38;5;196mcolored\x1b[0m");
    expect(svg).toContain('fill="#ff0000"');
  });

  test("strips non-SGR escape sequences", () => {
    // Cursor movement + text
    const svg = ansiToSvg("\x1b[2Jhello\x1b[1;1H");
    expect(svg).toContain("hello");
    expect(svg).not.toContain("\x1b");
  });

  test("reverse video swaps fg and bg", () => {
    const svg = ansiToSvg("\x1b[7mreversed\x1b[0m", {
      colors: { foregroundColor: "#00ff41", backgroundColor: "#0a0a0a" },
    });
    // Reversed: fg becomes bg rect, bg becomes text fill
    expect(svg).toMatch(/rect.*fill="#00ff41"/);
    expect(svg).toContain("reversed");
  });

  test("reverse video with explicit colors", () => {
    const svg = ansiToSvg("\x1b[31;7mswapped\x1b[0m");
    // Red fg + reverse: bg becomes red, fg becomes default
    expect(svg).toMatch(/rect.*fill="#aa0000"/);
  });

  test("italic renders with font-style italic", () => {
    const svg = ansiToSvg("\x1b[3mitalic text\x1b[0m");
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain("italic text");
  });

  test("strips scroll region and window manipulation sequences", () => {
    // Scroll region set + window resize
    const svg = ansiToSvg("\x1b[1;24rhello\x1b[8;40;80t");
    expect(svg).toContain("hello");
    expect(svg).not.toContain("\x1b");
  });

  test("strips alternate screen buffer sequences", () => {
    const svg = ansiToSvg("\x1b[?1049hhello\x1b[?1049l");
    expect(svg).toContain("hello");
    expect(svg).not.toContain("\x1b");
  });

  test("strips single-char escape sequences (save/restore cursor)", () => {
    const svg = ansiToSvg("\x1b7hello\x1b8");
    expect(svg).toContain("hello");
    expect(svg).not.toContain("\x1b");
  });
});
