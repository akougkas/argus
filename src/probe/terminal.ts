/**
 * terminal.ts — Headless xterm wrapper for PTY mode.
 *
 * Provides a proper 2D terminal grid by feeding raw PTY bytes into
 * @xterm/headless and reconstructing ANSI-styled output from the cell buffer.
 * Pure module — no WebSocket, no process spawning.
 */
import { Terminal } from "@xterm/headless";

// ---------------------------------------------------------------------------
// SGR palette — standard 16 colors
// ---------------------------------------------------------------------------

const SGR_FG: Record<number, string> = {
  0: "30", 1: "31", 2: "32", 3: "33", 4: "34", 5: "35", 6: "36", 7: "37",
  8: "90", 9: "91", 10: "92", 11: "93", 12: "94", 13: "95", 14: "96", 15: "97",
};

const SGR_BG: Record<number, string> = {
  0: "40", 1: "41", 2: "42", 3: "43", 4: "44", 5: "45", 6: "46", 7: "47",
  8: "100", 9: "101", 10: "102", 11: "103", 12: "104", 13: "105", 14: "106", 15: "107",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalGrid {
  /** Plain text — ANSI stripped, lines joined with \n */
  text: string;
  /** ANSI-reconstructed text — SGR codes for styling, lines joined with \n */
  ansi: string;
}

export interface TerminalWrapper {
  /** Feed raw PTY bytes into the terminal emulator. Returns a promise that resolves when processing is complete. */
  write(data: string | Uint8Array): Promise<void>;
  /** Extract the current grid state. */
  getGrid(): TerminalGrid;
  /** Terminal columns */
  readonly cols: number;
  /** Terminal rows */
  readonly rows: number;
  /** Dispose the underlying terminal */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// SGR reconstruction helpers
// ---------------------------------------------------------------------------

interface CellStyle {
  fg: number;       // palette index or -1 for default
  bg: number;       // palette index or -1 for default
  fgPalette: boolean;
  bgPalette: boolean;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

const DEFAULT_STYLE: CellStyle = {
  fg: -1, bg: -1, fgPalette: false, bgPalette: false,
  bold: false, dim: false, italic: false, underline: false, inverse: false,
};

function stylesEqual(a: CellStyle, b: CellStyle): boolean {
  return a.fg === b.fg && a.bg === b.bg &&
    a.fgPalette === b.fgPalette && a.bgPalette === b.bgPalette &&
    a.bold === b.bold && a.dim === b.dim && a.italic === b.italic &&
    a.underline === b.underline && a.inverse === b.inverse;
}

function buildSgrSequence(style: CellStyle): string {
  if (stylesEqual(style, DEFAULT_STYLE)) return "\x1b[0m";

  const parts: string[] = [];
  if (style.bold) parts.push("1");
  if (style.dim) parts.push("2");
  if (style.italic) parts.push("3");
  if (style.underline) parts.push("4");
  if (style.inverse) parts.push("7");

  if (style.fgPalette && style.fg >= 0) {
    if (style.fg < 16 && SGR_FG[style.fg]) {
      parts.push(SGR_FG[style.fg]);
    } else {
      parts.push(`38;5;${style.fg}`);
    }
  }
  if (style.bgPalette && style.bg >= 0) {
    if (style.bg < 16 && SGR_BG[style.bg]) {
      parts.push(SGR_BG[style.bg]);
    } else {
      parts.push(`48;5;${style.bg}`);
    }
  }

  return parts.length > 0 ? `\x1b[${parts.join(";")}m` : "";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTerminal(cols: number = 80, rows: number = 24): TerminalWrapper {
  const term = new Terminal({ cols, rows, allowProposedApi: true });

  return {
    cols,
    rows,

    write(data: string | Uint8Array): Promise<void> {
      return new Promise((resolve) => {
        const str = typeof data === "string" ? data : new TextDecoder().decode(data);
        term.write(str, resolve);
      });
    },

    getGrid(): TerminalGrid {
      const buf = term.buffer.active;
      const textLines: string[] = [];
      const ansiLines: string[] = [];

      for (let y = 0; y < rows; y++) {
        const line = buf.getLine(y);
        if (!line) {
          textLines.push("");
          ansiLines.push("");
          continue;
        }

        let textLine = "";
        let ansiLine = "";
        let currentStyle: CellStyle = { ...DEFAULT_STYLE };
        let hasContent = false;

        for (let x = 0; x < cols; x++) {
          const cell = line.getCell(x);
          if (!cell) continue;

          const ch = cell.getChars() || " ";

          // Extract cell style
          const cellStyle: CellStyle = {
            fg: cell.getFgColor(),
            bg: cell.getBgColor(),
            fgPalette: cell.isFgPalette(),
            bgPalette: cell.isBgPalette(),
            bold: !!cell.isBold(),
            dim: !!cell.isDim(),
            italic: !!cell.isItalic(),
            underline: !!cell.isUnderline(),
            inverse: !!cell.isInverse(),
          };

          // Track whether we've seen non-space content
          if (ch !== " ") hasContent = true;

          // Emit SGR codes on style transitions
          if (!stylesEqual(cellStyle, currentStyle)) {
            // Reset then apply new style
            if (!stylesEqual(currentStyle, DEFAULT_STYLE)) {
              ansiLine += "\x1b[0m";
            }
            const sgr = buildSgrSequence(cellStyle);
            if (sgr && !stylesEqual(cellStyle, DEFAULT_STYLE)) {
              ansiLine += sgr;
            }
            currentStyle = cellStyle;
          }

          textLine += ch;
          ansiLine += ch;
        }

        // Close any open SGR at end of line
        if (!stylesEqual(currentStyle, DEFAULT_STYLE)) {
          ansiLine += "\x1b[0m";
        }

        // Trim trailing spaces for clean output
        textLines.push(textLine.trimEnd());
        ansiLines.push(hasContent ? ansiLine.trimEnd() : "");
      }

      return {
        text: textLines.join("\n"),
        ansi: ansiLines.join("\n"),
      };
    },

    dispose() {
      term.dispose();
    },
  };
}
