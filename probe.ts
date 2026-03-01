import { OpenAI } from "openai";
import ansiToSvg from "ansi-to-svg";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Configuration (all from env vars or CLI args)
// ---------------------------------------------------------------------------

const AGENT_ID = process.env.ARGUS_AGENT_ID || "A-01";
const HUB_URL = process.env.ARGUS_HUB_URL || "ws://localhost:8000/ws/probe";
const VLM_URL = process.env.ARGUS_VLM_URL || "http://localhost:8080/v1";
const VLM_MODEL = process.env.ARGUS_VLM_MODEL || "gpt-4o-mini";
const VLM_KEY = process.env.ARGUS_VLM_KEY || "no-key";
const VISION_URL = process.env.ARGUS_VISION_URL || VLM_URL;
const VISION_MODEL = process.env.ARGUS_VISION_MODEL || VLM_MODEL;
const VISION_KEY = process.env.ARGUS_VISION_KEY || VLM_KEY;
const FAST_INTERVAL = parseInt(process.env.ARGUS_FAST_INTERVAL || "1000");
const SCREEN_INTERVAL = parseInt(process.env.ARGUS_SCREEN_INTERVAL || "100");
const FRAME_INTERVAL = parseInt(process.env.ARGUS_FRAME_INTERVAL || "2000");
const SCREEN_ROWS = 24;

// CLI: `bun run probe.ts -- python3 my_agent.py`  (default: demo_agent.ts)
const cliArgs = process.argv.slice(2);
const SPAWN_CMD = cliArgs.length > 0 ? cliArgs : ["bun", "run", "demo_agent.ts"];

const openai = new OpenAI({ baseURL: VLM_URL, apiKey: VLM_KEY });
const visionClient = new OpenAI({ baseURL: VISION_URL, apiKey: VISION_KEY });

// llama.cpp extension: disable thinking/reasoning mode for models that support it
// (e.g. Qwen3.5). Without this, thinking tokens consume the entire budget.
const LLAMA_CPP_NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;

let ws: WebSocket;
let childProc: ReturnType<typeof Bun.spawn> | null = null;
let probeStarted = false;
let isDeepReasoning = false;
let isFastPerceptionRunning = false;
let lastBroadcastedScreen = "";
let screenHistory: string[] = [];

// Rolling line buffer — the "screen" is the last SCREEN_ROWS lines
let screenLines: string[] = [];

// Raw ANSI line buffer — preserves escape codes for visual pipeline
let rawScreenLines: string[] = [];

// JPEG frame buffer for vision tier2
const frameBuffer: Buffer[] = [];

// Reconnection backoff
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(payload: object) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendLog(text: string, type: string = "info") {
  send({ type: "log_update", agent_id: AGENT_ID, log: { text, type } });
}

function extractJSON(text: string): any | null {
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) try { return JSON.parse(fenced[1]); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.substring(start, end + 1)); } catch {}
  }
  return null;
}

function getScreen(): string {
  return screenLines.slice(-SCREEN_ROWS).join("\n");
}

function pushLine(line: string) {
  screenLines.push(line);
  // Keep bounded (2x screen for scrollback context)
  if (screenLines.length > SCREEN_ROWS * 2) {
    screenLines = screenLines.slice(-SCREEN_ROWS * 2);
  }
}

function pushRawLine(line: string) {
  rawScreenLines.push(line);
  if (rawScreenLines.length > SCREEN_ROWS * 2) {
    rawScreenLines = rawScreenLines.slice(-SCREEN_ROWS * 2);
  }
}

function getRawScreen(): string {
  return rawScreenLines.slice(-SCREEN_ROWS).join("\n");
}

// ---------------------------------------------------------------------------
// Visual pipeline — ANSI → SVG → JPEG
// ---------------------------------------------------------------------------

async function captureFrame(): Promise<string> {
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

async function compositeGrid(frames: Buffer[]): Promise<string> {
  const cellW = 480, cellH = 270;

  // Resize all frames to cell size
  const resized = await Promise.all(
    frames.slice(-4).map(f =>
      sharp(f).resize(cellW, cellH, { fit: "contain", background: "#0a0a0a" }).toBuffer()
    )
  );

  // Pad to 4 with black cells if fewer frames
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
// Command handler (pause / kill / inject from dashboard via hub)
// ---------------------------------------------------------------------------

function handleCommand(msg: any) {
  if (!childProc) {
    console.warn("[probe] No active process to command");
    return;
  }

  switch (msg.action) {
    case "pause":
      try {
        process.kill(childProc.pid, "SIGSTOP");
        sendLog("Agent paused (SIGSTOP)", "system");
        console.log(`[probe] SIGSTOP → PID ${childProc.pid}`);
      } catch (e) {
        console.error("[probe] Failed to pause:", e);
      }
      break;

    case "resume":
      try {
        process.kill(childProc.pid, "SIGCONT");
        sendLog("Agent resumed (SIGCONT)", "system");
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
      } catch (e) {
        console.error("[probe] Failed to kill:", e);
      }
      break;

    case "inject":
      if (msg.content && childProc.stdin && typeof childProc.stdin !== "number") {
        childProc.stdin.write(msg.content + "\n");
        sendLog(`Injected: ${msg.content}`, "system");
        console.log(`[probe] Injected: ${msg.content}`);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Subprocess + Monitoring pipeline
// ---------------------------------------------------------------------------

async function startProbe() {
  if (probeStarted) return;
  probeStarted = true;

  console.log(`[probe] Spawning: ${SPAWN_CMD.join(" ")}`);

  try {
    childProc = Bun.spawn(SPAWN_CMD, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });
  } catch (e) {
    console.error(`[probe] Failed to spawn:`, e);
    probeStarted = false;
    return;
  }

  // Read stdout and stderr streams
  pipeStream(childProc.stdout as ReadableStream<Uint8Array> | null, "stdout");
  pipeStream(childProc.stderr as ReadableStream<Uint8Array> | null, "stderr");

  // Wait for exit
  childProc.exited.then((code) => {
    console.log(`[probe] Agent exited with code ${code}`);
    sendLog(`Agent exited (code ${code})`, "system");
    childProc = null;
    probeStarted = false;
  });

  // Screen broadcast loop — sends the rolling line buffer as terminal screen
  setInterval(() => {
    const screen = getScreen();
    if (screen && screen !== lastBroadcastedScreen) {
      send({ type: "terminal_screen_update", agent_id: AGENT_ID, screen });
      lastBroadcastedScreen = screen;
      screenHistory.push(screen);
      if (screenHistory.length > 10) screenHistory.shift();
    }
  }, SCREEN_INTERVAL);

  // Frame capture loop — ANSI → SVG → JPEG for visual pipeline + dashboard
  setInterval(async () => {
    try {
      const frame = await captureFrame();
      if (frame) {
        const buf = Buffer.from(frame, "base64");
        frameBuffer.push(buf);
        if (frameBuffer.length > 10) frameBuffer.shift();
        // Stream latest frame to dashboard
        send({ type: "frame_update", agent_id: AGENT_ID, frame });
      }
    } catch {
      // Silently skip frame capture failures (non-critical)
    }
  }, FRAME_INTERVAL);

  // Tier 1: Fast perception loop (text-based, unchanged)
  setInterval(async () => {
    if (isDeepReasoning || isFastPerceptionRunning) return;
    isFastPerceptionRunning = true;

    try {
      const lines = lastBroadcastedScreen.split("\n").filter((l) => l.trim());
      const trimmed = lines.slice(-15).join("\n");
      if (trimmed.length < 10) return;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await openai.chat.completions.create(
        {
          model: VLM_MODEL,
          messages: [
            {
              role: "user",
              content: `Analyze this terminal text. Is there an error, failure, exception, or crash?\nReply EXACTLY with one word: ANOMALY or OK.\n\nTEXT:\n${trimmed}`,
            },
          ],
          temperature: 0,
          max_tokens: 10,
          ...LLAMA_CPP_NO_THINK,
        } as any,
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      const result = response.choices[0]?.message?.content?.trim().toUpperCase() || "";
      console.log(`[tier1] ${result}`);

      const isAnomaly =
        result.includes("ANOMALY") ||
        (!result.includes("OK") && (result.includes("ERROR") || result.includes("FAIL")));

      if (isAnomaly) {
        if (isDeepReasoning) return;
        isDeepReasoning = true;

        console.log("[tier1] Anomaly detected — escalating to Tier 2");
        send({
          type: "vlm_update",
          agent_id: AGENT_ID,
          data: {
            agent_state: "STUCK",
            confidence_score: 50,
            reasoning: "Tier 1 anomaly detected. Escalating to deep reasoner...",
          },
        });

        runDeepReasoning();
      } else {
        send({
          type: "vlm_update",
          agent_id: AGENT_ID,
          data: {
            agent_state: "PROGRESSING",
            confidence_score: 99,
            reasoning: "System nominal",
          },
        });
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        console.log("[tier1] Timeout");
      } else {
        console.error("[tier1] Error:", e.message);
      }
    } finally {
      isFastPerceptionRunning = false;
    }
  }, FAST_INTERVAL);
}

// ---------------------------------------------------------------------------
// Stream reader — pipes subprocess output into screen buffer + log lines
// ---------------------------------------------------------------------------

async function pipeStream(stream: ReadableStream<Uint8Array> | null | undefined, label: string) {
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

      // Process stripped lines → screen buffer + log lines
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

      // Process raw ANSI lines → visual pipeline buffer
      while ((idx = rawLineBuffer.indexOf("\n")) !== -1) {
        const rawLine = rawLineBuffer.slice(0, idx);
        rawLineBuffer = rawLineBuffer.slice(idx + 1);
        if (rawLine.trim()) {
          pushRawLine(rawLine);
        }
      }
    }
  } catch {
    // Stream closed
  }
}

// ---------------------------------------------------------------------------
// Tier 2: Deep reasoning
// ---------------------------------------------------------------------------

async function runDeepReasoning() {
  const basePrompt = `You are the L5 Argus Overseer. The fast-perception layer flagged an anomaly on the agent's terminal.
Determine the exact state: stuck in a loop, failing a build, or hallucinating commands?

Reply ONLY with a raw, valid JSON object:
{
  "agent_state": "STUCK" | "DANGEROUS" | "HALLUCINATING",
  "confidence_score": 0-100,
  "reasoning": "A concise explanation of the failure and what the agent is attempting to do."
}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let response;

    if (frameBuffer.length >= 2) {
      // Vision mode: composite recent frames into 2x2 temporal grid
      console.log(`[tier2] Vision mode — ${frameBuffer.length} frames available`);
      const gridBase64 = await compositeGrid(frameBuffer.slice(-4));

      response = await visionClient.chat.completions.create(
        {
          model: VISION_MODEL,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: `${basePrompt}\n\nThe 2x2 grid shows 4 chronological terminal screenshots (top-left → top-right → bottom-left → bottom-right). Analyze the temporal progression.` },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${gridBase64}` } },
            ],
          }],
          temperature: 0,
          max_tokens: 300,
        } as any,
        { signal: controller.signal },
      );
    } else {
      // Text fallback: same as before
      console.log("[tier2] Text fallback mode");
      const history = screenHistory.slice(-4).join("\n\n--- PREVIOUS FRAME ---\n\n");

      response = await openai.chat.completions.create(
        {
          model: VLM_MODEL,
          messages: [{ role: "user", content: `${basePrompt}\n\nTEMPORAL SCREEN HISTORY:\n${history}` }],
          temperature: 0,
          max_tokens: 300,
          ...LLAMA_CPP_NO_THINK,
        } as any,
        { signal: controller.signal },
      );
    }
    clearTimeout(timeout);

    const rawText = response.choices[0]?.message?.content?.trim() || "";
    console.log(`[tier2] Raw: ${rawText.substring(0, 120)}...`);

    const result = extractJSON(rawText);
    if (result) {
      console.log(`[tier2] Verdict: ${result.agent_state} — ${result.reasoning}`);
      send({ type: "vlm_update", agent_id: AGENT_ID, data: result });
    } else {
      console.error("[tier2] Failed to extract JSON from response");
    }
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.log("[tier2] Timeout (45s)");
    } else {
      console.error("[tier2] Error:", e.message);
    }
  } finally {
    isDeepReasoning = false;
  }
}

// ---------------------------------------------------------------------------
// WebSocket connection with exponential backoff
// ---------------------------------------------------------------------------

function connect() {
  ws = new WebSocket(HUB_URL);

  ws.onopen = () => {
    reconnectDelay = 1000;
    console.log(`[probe] Connected to hub (${HUB_URL})`);
    send({ type: "register", agent_id: AGENT_ID });
    startProbe();
  };

  ws.onmessage = (event) => {
    let msg: any;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }
    if (msg.type === "command") handleCommand(msg);
  };

  ws.onerror = () => {
    console.error("[probe] Hub connection error");
  };

  ws.onclose = () => {
    console.log(`[probe] Disconnected. Reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  };
}

console.log(`[probe] Argus Probe — agent=${AGENT_ID} cmd="${SPAWN_CMD.join(" ")}"`);
connect();
