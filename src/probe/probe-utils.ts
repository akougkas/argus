import { ansiToSvg } from "./ansi-to-svg";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SCREEN_ROWS = 24;
export const ANSI_RE = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;
export const MAX_LINE_BUFFER = 64 * 1024; // 64KB safety valve

// ---------------------------------------------------------------------------
// Screen buffer — encapsulated state with reset for tests
// ---------------------------------------------------------------------------

let screenLines: string[] = [];
let rawScreenLines: string[] = [];
const frameBuffer: Buffer[] = [];

export function pushLine(line: string) {
  screenLines.push(line);
  if (screenLines.length > SCREEN_ROWS * 2) {
    screenLines = screenLines.slice(-SCREEN_ROWS * 2);
  }
}

export function getScreen(): string {
  return screenLines.slice(-SCREEN_ROWS).join("\n");
}

export function pushRawLine(line: string) {
  rawScreenLines.push(line);
  if (rawScreenLines.length > SCREEN_ROWS * 2) {
    rawScreenLines = rawScreenLines.slice(-SCREEN_ROWS * 2);
  }
}

export function getRawScreen(): string {
  return rawScreenLines.slice(-SCREEN_ROWS).join("\n");
}

export function getFrameBuffer(): Buffer[] {
  return frameBuffer;
}

export function pushFrame(buf: Buffer) {
  frameBuffer.push(buf);
  if (frameBuffer.length > 10) frameBuffer.shift();
}

export function resetState() {
  screenLines = [];
  rawScreenLines = [];
  frameBuffer.length = 0;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

export interface VlmResult {
  agent_state: string;
  confidence_score: number;
  reasoning: string;
}

export function extractJSON(text: string): VlmResult | null {
  try { return JSON.parse(text); } catch { /* not raw JSON */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) try { return JSON.parse(fenced[1]); } catch { /* malformed fenced */ }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.substring(start, end + 1)); } catch { /* malformed embedded */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Visual pipeline — ANSI → SVG → JPEG
// ---------------------------------------------------------------------------

export async function captureFrame(): Promise<string> {
  const rawAnsi = getRawScreen();
  if (!rawAnsi.trim()) return "";

  const svg = ansiToSvg(rawAnsi, {
    fontFace: "JetBrains Mono, Courier",
    fontSize: 14,
    lineHeight: 18,
    colors: {
      backgroundColor: "#0a0a0a",
      foregroundColor: "#00ff41",
    },
  });

  const jpeg = await sharp(Buffer.from(svg))
    .resize(960, 540, { fit: "contain", background: "#0a0a0a" })
    .jpeg({ quality: 60 })
    .toBuffer();

  return jpeg.toString("base64");
}

export async function compositeGrid(frames: Buffer[]): Promise<string> {
  const cellW = 480, cellH = 270;

  const resized = await Promise.all(
    frames.slice(-4).map(f =>
      sharp(f).resize(cellW, cellH, { fit: "contain", background: "#0a0a0a" }).toBuffer()
    )
  );

  while (resized.length < 4) {
    const blank = await sharp({
      create: { width: cellW, height: cellH, channels: 3, background: { r: 10, g: 10, b: 10 } },
    }).jpeg().toBuffer();
    resized.unshift(blank);
  }

  const grid = await sharp({
    create: { width: 960, height: 540, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      { input: resized[0], top: 0, left: 0 },
      { input: resized[1], top: 0, left: cellW },
      { input: resized[2], top: cellH, left: 0 },
      { input: resized[3], top: cellH, left: cellW },
    ])
    .jpeg({ quality: 70 })
    .toBuffer();

  return grid.toString("base64");
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export interface CommandPayload {
  type: "command";
  action: "pause" | "resume" | "kill" | "inject";
  content?: string;
}

export interface ChildProcessLike {
  pid: number;
  stdin: { write(data: string): void } | number | null | undefined;
  kill(signal?: number): void;
}

export function handleCommand(
  msg: CommandPayload,
  childProc: ChildProcessLike | null,
  sendLog: (text: string, type?: string) => void,
  sendState: (state: string, confidence: number, reasoning: string) => void,
): void {
  if (!childProc) {
    console.warn("[probe] No active process to command");
    return;
  }

  switch (msg.action) {
    case "pause":
      try {
        process.kill(childProc.pid, "SIGSTOP");
        sendLog("Agent paused (SIGSTOP)", "system");
        sendState("PAUSED", 100, "Agent paused by operator");
        console.log(`[probe] SIGSTOP → PID ${childProc.pid}`);
      } catch (e) {
        console.error("[probe] Failed to pause:", e);
      }
      break;

    case "resume":
      try {
        process.kill(childProc.pid, "SIGCONT");
        sendLog("Agent resumed (SIGCONT)", "system");
        sendState("PROGRESSING", 100, "Agent resumed by operator");
        console.log(`[probe] SIGCONT → PID ${childProc.pid}`);
      } catch (e) {
        console.error("[probe] Failed to resume:", e);
      }
      break;

    case "kill":
      try {
        childProc.kill(9);
        sendLog("Agent killed (SIGKILL)", "system");
        console.log(`[probe] SIGKILL → PID ${childProc.pid}`);
        // EXITED state sent by the child exit handler, not here — avoids race
      } catch (e) {
        console.error("[probe] Failed to kill:", e);
      }
      break;

    case "inject":
      if (msg.content && childProc.stdin && typeof childProc.stdin !== "number") {
        (childProc.stdin as { write(data: string): void }).write(msg.content + "\n");
        sendLog(`Injected: ${msg.content}`, "system");
        console.log(`[probe] Injected: ${msg.content}`);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Stream reader — pipes subprocess output into screen buffer + log lines
// ---------------------------------------------------------------------------

export async function pipeStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  label: string,
  sendLog: (text: string, type?: string) => void,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let rawLineBuffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const raw = decoder.decode(value, { stream: true });
      const clean = raw.replace(ANSI_RE, "");

      lineBuffer += clean;
      rawLineBuffer += raw;

      // Safety valve: flush if buffer grows too large without newlines
      if (lineBuffer.length > MAX_LINE_BUFFER) {
        console.warn(`[probe] pipeStream(${label}): lineBuffer exceeded ${MAX_LINE_BUFFER}B without newline, force-flushing`);
        pushLine(lineBuffer.trim());
        sendLog(lineBuffer.trim(), label === "stderr" ? "error" : "info");
        lineBuffer = "";
      }
      if (rawLineBuffer.length > MAX_LINE_BUFFER) {
        pushRawLine(rawLineBuffer);
        rawLineBuffer = "";
      }

      let idx;
      while ((idx = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, idx).trim();
        lineBuffer = lineBuffer.slice(idx + 1);
        if (line) {
          pushLine(line);
          const isError = label === "stderr" || /error|exception|fatal|✖/i.test(line);
          sendLog(line, isError ? "error" : "info");
        }
      }

      while ((idx = rawLineBuffer.indexOf("\n")) !== -1) {
        const rawLine = rawLineBuffer.slice(0, idx);
        rawLineBuffer = rawLineBuffer.slice(idx + 1);
        if (rawLine.trim()) {
          pushRawLine(rawLine);
        }
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== "Stream closed") {
      console.error(`[probe] pipeStream(${label}) error:`, msg);
    }
  }
}
