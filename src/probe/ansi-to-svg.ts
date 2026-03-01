// ---------------------------------------------------------------------------
// Minimal ANSI → SVG renderer — replaces unmaintained `ansi-to-svg` package
// Handles: 16 basic colors, 256-color, bold, dim, underline, reset
// ---------------------------------------------------------------------------

export interface AnsiToSvgOptions {
  fontFace?: string;
  fontSize?: number;
  lineHeight?: number;
  colors?: {
    backgroundColor?: string;
    foregroundColor?: string;
  };
}

// Standard 16 ANSI colors (0-7 normal, 8-15 bright)
const ANSI_COLORS: string[] = [
  "#000000", "#aa0000", "#00aa00", "#aa5500", "#0000aa", "#aa00aa", "#00aaaa", "#aaaaaa", // 0-7
  "#555555", "#ff5555", "#55ff55", "#ffff55", "#5555ff", "#ff55ff", "#55ffff", "#ffffff", // 8-15
];

// 256-color lookup (lazy-initialized)
let colors256: string[] | null = null;

function get256Colors(): string[] {
  if (colors256) return colors256;
  colors256 = [...ANSI_COLORS];
  // 216 color cube (indices 16-231)
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        const rv = r ? r * 40 + 55 : 0;
        const gv = g ? g * 40 + 55 : 0;
        const bv = b ? b * 40 + 55 : 0;
        colors256.push(`#${rv.toString(16).padStart(2, "0")}${gv.toString(16).padStart(2, "0")}${bv.toString(16).padStart(2, "0")}`);
      }
    }
  }
  // 24 grayscale (indices 232-255)
  for (let i = 0; i < 24; i++) {
    const v = i * 10 + 8;
    const hex = v.toString(16).padStart(2, "0");
    colors256.push(`#${hex}${hex}${hex}`);
  }
  return colors256;
}

interface Style {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  reverse: boolean;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Parse SGR parameters and update style
function applySgr(params: number[], style: Style, defaultFg: string): void {
  let i = 0;
  while (i < params.length) {
    const p = params[i];
    if (p === 0) { style.fg = null; style.bg = null; style.bold = false; style.dim = false; style.italic = false; style.underline = false; style.reverse = false; }
    else if (p === 1) style.bold = true;
    else if (p === 2) style.dim = true;
    else if (p === 3) style.italic = true;
    else if (p === 4) style.underline = true;
    else if (p === 7) style.reverse = true;
    else if (p === 22) { style.bold = false; style.dim = false; }
    else if (p === 23) style.italic = false;
    else if (p === 24) style.underline = false;
    else if (p === 27) style.reverse = false;
    else if (p >= 30 && p <= 37) style.fg = ANSI_COLORS[p - 30];
    else if (p === 38) {
      // Extended foreground: 38;5;n (256-color) or 38;2;r;g;b (truecolor)
      if (params[i + 1] === 5 && i + 2 < params.length) {
        style.fg = get256Colors()[params[i + 2]] || defaultFg;
        i += 2;
      } else if (params[i + 1] === 2 && i + 4 < params.length) {
        style.fg = `#${params[i + 2].toString(16).padStart(2, "0")}${params[i + 3].toString(16).padStart(2, "0")}${params[i + 4].toString(16).padStart(2, "0")}`;
        i += 4;
      }
    }
    else if (p === 39) style.fg = null;
    else if (p >= 40 && p <= 47) style.bg = ANSI_COLORS[p - 40];
    else if (p === 48) {
      // Extended background
      if (params[i + 1] === 5 && i + 2 < params.length) {
        style.bg = get256Colors()[params[i + 2]] || null;
        i += 2;
      } else if (params[i + 1] === 2 && i + 4 < params.length) {
        style.bg = `#${params[i + 2].toString(16).padStart(2, "0")}${params[i + 3].toString(16).padStart(2, "0")}${params[i + 4].toString(16).padStart(2, "0")}`;
        i += 4;
      }
    }
    else if (p === 49) style.bg = null;
    else if (p >= 90 && p <= 97) style.fg = ANSI_COLORS[p - 90 + 8];
    else if (p >= 100 && p <= 107) style.bg = ANSI_COLORS[p - 100 + 8];
    i++;
  }
}

// SGR escape regex: ESC [ <params> m
const SGR_RE = /\x1B\[([0-9;]*)m/g;
// Strip all other escape sequences (cursor movement, scroll regions, window ops, etc.)
const OTHER_ESC_RE = /\x1B(?:\[[0-9;]*[A-HJKSTfghlnqrstu]|\][^\x07]*\x07|\[\?[0-9;]*[hl]|\[=[0-9;]*[hl]|[78DME]|\(B)/g;

export function ansiToSvg(input: string, options?: AnsiToSvgOptions): string {
  const fontFace = options?.fontFace || "SauceCodePro Nerd Font, Source Code Pro, Courier";
  const fontSize = options?.fontSize || 14;
  const lineHeight = options?.lineHeight || 18;
  const bgColor = options?.colors?.backgroundColor || "#000000";
  const fgColor = options?.colors?.foregroundColor || "#aaaaaa";

  const charWidth = fontSize * 0.6; // monospace approximation
  const rowHeight = lineHeight + 1;
  const ascent = fontSize * 0.75;

  // Strip non-SGR escapes
  const cleaned = input.replace(OTHER_ESC_RE, "");
  const lines = cleaned.split("\n");

  const maxCols = Math.max(1, ...lines.map(l => l.replace(SGR_RE, "").length));
  const width = Math.ceil(maxCols * charWidth);
  const height = lines.length * rowHeight;

  let content = `<rect x="0" y="0" width="${width}" height="${height}" fill="${bgColor}"/>`;

  const style: Style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, reverse: false };

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    const y = row * rowHeight + ascent;
    let col = 0;

    // Walk the line, splitting on SGR sequences
    let lastIndex = 0;
    SGR_RE.lastIndex = 0;
    let match;

    while ((match = SGR_RE.exec(line)) !== null) {
      // Text before this escape
      const text = line.slice(lastIndex, match.index);
      if (text.length > 0) {
        content += renderSpan(text, col, row, y, style, charWidth, rowHeight, ascent, fgColor);
        col += text.length;
      }

      // Apply SGR
      const params = match[1] ? match[1].split(";").map(Number) : [0];
      applySgr(params, style, fgColor);

      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last escape
    const remaining = line.slice(lastIndex);
    if (remaining.length > 0) {
      content += renderSpan(remaining, col, row, y, style, charWidth, rowHeight, ascent, fgColor);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0, 0, ${width}, ${height}" font-family="${fontFace}" font-size="${fontSize}"><g fill="${fgColor}">${content}</g></svg>`;
}

function renderSpan(
  text: string,
  col: number,
  row: number,
  y: number,
  style: Style,
  charWidth: number,
  rowHeight: number,
  ascent: number,
  defaultFg: string,
): string {
  let result = "";
  const x = Math.round(col * charWidth * 100) / 100;
  const w = Math.round(text.length * charWidth * 100) / 100;

  // Resolve effective colors — reverse video swaps fg/bg
  const effectiveFg = style.reverse ? (style.bg || defaultFg) : style.fg;
  const effectiveBg = style.reverse ? (style.fg || defaultFg) : style.bg;

  // Background rect
  if (effectiveBg) {
    const rectY = row * rowHeight;
    result += `<rect x="${x}" y="${rectY}" width="${w}" height="${rowHeight}" fill="${effectiveBg}"`;
    if (style.dim) result += ` opacity="0.5"`;
    result += `/>`;
  }

  // Skip whitespace-only spans with no styling
  if (text.trim().length === 0 && !effectiveFg && !style.bold && !style.italic && !style.underline) {
    return result;
  }

  // Text element
  const attrs: string[] = [];
  if (effectiveFg) attrs.push(`fill="${effectiveFg}"`);
  if (style.bold) attrs.push(`font-weight="bold"`);
  if (style.italic) attrs.push(`font-style="italic"`);
  if (style.dim && !effectiveBg) attrs.push(`opacity="0.5"`);
  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";

  result += `<text x="${x}" y="${y}"${attrStr}>${escapeXml(text)}</text>`;

  // Underline path
  if (style.underline) {
    const uy = Math.round((y + ascent * 0.14) * 100) / 100;
    const color = effectiveFg || defaultFg;
    result += `<path d="M${x},${uy} L${x + w},${uy} Z" stroke="${color}"/>`;
  }

  return result;
}
