import { OpenAI } from "openai";
import {
  extractJSON,
  getScreen,
  getFrameBuffer,
  pushFrame,
  captureFrame,
  compositeGrid,
  handleCommand,
  pipeStream,
  pipeToTerminal,
  resetState,
  type CommandPayload,
} from "./probe-utils";
import { createTerminal, type TerminalWrapper } from "./terminal";
import { createTelemetryListener, type TelemetryListener, type TelemetryPayload } from "./telemetry-listener";
import { ansiToSvg } from "./ansi-to-svg";
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
const SCREEN_INTERVAL = parseInt(process.env.ARGUS_SCREEN_INTERVAL || "250");
const FRAME_INTERVAL = parseInt(process.env.ARGUS_FRAME_INTERVAL || "2000");
const TIER1_COOLDOWN = parseInt(process.env.ARGUS_TIER1_COOLDOWN || "5000");
const AGENT_TASK = process.env.ARGUS_AGENT_TASK || "";
const PTY_MODE = process.env.ARGUS_PTY === "1";
const PTY_COLS = parseInt(process.env.ARGUS_PTY_COLS || "80");
const PTY_ROWS = parseInt(process.env.ARGUS_PTY_ROWS || "24");
const TELEMETRY_PORT = process.env.ARGUS_TELEMETRY_PORT
  ? parseInt(process.env.ARGUS_TELEMETRY_PORT)
  : undefined; // undefined = disabled

// CLI: `bun run probe.ts -- python3 my_agent.py`  (default: demo_agent.ts)
const cliArgs = process.argv.slice(2);
const SPAWN_CMD = cliArgs.length > 0 ? cliArgs : ["bun", "run", "src/demo/demo_agent.ts"];

const openai = new OpenAI({ baseURL: VLM_URL, apiKey: VLM_KEY });
const visionClient = new OpenAI({ baseURL: VISION_URL, apiKey: VISION_KEY });

// llama.cpp extension: disable thinking/reasoning mode for models that support it
const LLAMA_CPP_NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws: WebSocket;
let childProc: ReturnType<typeof Bun.spawn> | null = null;
let terminal: TerminalWrapper | null = null;
let probeStarted = false;
let isDeepReasoning = false;
let isFastPerceptionRunning = false;
let lastBroadcastedScreen = "";
let lastAnalyzedScreen = ""; // BUG-1 fix: tier1 dedup

// Timer IDs for cleanup
let screenIntervalId: ReturnType<typeof setInterval> | null = null;
let frameIntervalId: ReturnType<typeof setInterval> | null = null;
let tier1IntervalId: ReturnType<typeof setInterval> | null = null;

// Frame capture failure tracking
let consecutiveFrameFailures = 0;

// Tier1 cooldown after tier2 escalation
let lastTier2Completion = 0;

// Cached VLM state for re-registration
let lastSentState = "PROGRESSING";
let lastSentConfidence = 100;
let lastSentReasoning = "";

// Operator override — blocks VLM from overriding PAUSED state
let operatorOverride: string | null = null;

// Telemetry listener (optional, for AWOC integration)
let telemetryListenerInstance: TelemetryListener | null = null;
let lastTelemetry: TelemetryPayload | null = null;

// Shutdown guard
let shuttingDown = false;

// Prevents re-spawn after child exit (operator kill or natural exit)
let childExited = false;

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

function sendVlmState(state: string, confidence: number, reasoning: string) {
  // Operator states (PAUSED) take precedence — only operator commands and EXITED can override
  if (operatorOverride && state !== operatorOverride && state !== "EXITED") return;
  // EXITED is terminal — in-flight VLM results must not override it
  if (lastSentState === "EXITED" && state !== "EXITED") return;
  lastSentState = state;
  lastSentConfidence = confidence;
  lastSentReasoning = reasoning;
  send({
    type: "vlm_update",
    agent_id: AGENT_ID,
    data: { agent_state: state, confidence_score: confidence, reasoning },
  });
}

function clearIntervals() {
  if (screenIntervalId) { clearInterval(screenIntervalId); screenIntervalId = null; }
  if (frameIntervalId) { clearInterval(frameIntervalId); frameIntervalId = null; }
  if (tier1IntervalId) { clearInterval(tier1IntervalId); tier1IntervalId = null; }
}

function stopTelemetry() {
  if (telemetryListenerInstance) {
    telemetryListenerInstance.close();
    telemetryListenerInstance = null;
    console.log("[probe] Telemetry listener closed");
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[probe] Shutting down...");
  clearIntervals();
  stopTelemetry();
  if (childProc) {
    try { process.kill(childProc.pid, "SIGTERM"); } catch {}
    const forceTimer = setTimeout(() => {
      try { childProc?.kill(9); } catch {}
      if (ws?.readyState === WebSocket.OPEN) ws.close();
      process.exit(0);
    }, 3000);
    childProc.exited.then(() => {
      clearTimeout(forceTimer);
      if (ws?.readyState === WebSocket.OPEN) ws.close();
      process.exit(0);
    });
  } else {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Subprocess + Monitoring pipeline
// ---------------------------------------------------------------------------

/** Capture a frame from the terminal grid (PTY mode). */
async function captureFrameFromGrid(ansiContent: string): Promise<string> {
  if (!ansiContent.trim()) return "";
  const svg = ansiToSvg(ansiContent, {
    fontFace: "JetBrains Mono, Courier",
    fontSize: 14,
    lineHeight: 18,
    colors: { backgroundColor: "#0a0a0a", foregroundColor: "#00ff41" },
  });
  const jpeg = await sharp(Buffer.from(svg))
    .resize(960, 540, { fit: "contain", background: "#0a0a0a" })
    .jpeg({ quality: 60 })
    .toBuffer();
  return jpeg.toString("base64");
}

async function startProbe() {
  if (probeStarted || childExited) return;
  probeStarted = true;
  clearIntervals(); // Guard against leaked timers from previous runs

  const mode = PTY_MODE ? "PTY" : "pipe";
  console.log(`[probe] Spawning (${mode}): ${SPAWN_CMD.join(" ")}`);

  try {
    if (PTY_MODE) {
      // PTY mode: wrap command in `script` for real PTY allocation
      const innerCmd = `stty rows ${PTY_ROWS} cols ${PTY_COLS} 2>/dev/null; exec ${SPAWN_CMD.join(" ")}`;
      childProc = Bun.spawn(["script", "-qefc", innerCmd, "/dev/null"], {
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: "1", TERM: "xterm-256color" },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      });
      terminal = createTerminal(PTY_COLS, PTY_ROWS);
    } else {
      // Pipe mode: direct spawn (default)
      childProc = Bun.spawn(SPAWN_CMD, {
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      });
    }
  } catch (e) {
    console.error(`[probe] Failed to spawn:`, e);
    sendLog(`Failed to spawn: ${e instanceof Error ? e.message : String(e)}`, "error");
    probeStarted = false;
    return;
  }

  // Read streams
  if (PTY_MODE && terminal) {
    // PTY: feed stdout to terminal emulator (stderr merged into PTY stdout)
    pipeToTerminal(childProc.stdout as ReadableStream<Uint8Array> | null, terminal, sendLog);
  } else {
    // Pipe: separate stdout/stderr streams
    pipeStream(childProc.stdout as ReadableStream<Uint8Array> | null, "stdout", sendLog);
    pipeStream(childProc.stderr as ReadableStream<Uint8Array> | null, "stderr", sendLog);
  }

  // Wait for exit
  childProc.exited.then((code) => {
    console.log(`[probe] Agent exited with code ${code}`);
    sendLog(`Agent exited (code ${code})`, "system");
    sendVlmState("EXITED", 100, `Agent exited (code ${code})`);
    clearIntervals();
    if (terminal) { terminal.dispose(); terminal = null; }
    childProc = null;
    probeStarted = false;
    childExited = true;
  });

  // Screen broadcast loop
  screenIntervalId = setInterval(() => {
    const screen = (PTY_MODE && terminal)
      ? terminal.getGrid().text
      : getScreen();
    if (screen && screen !== lastBroadcastedScreen) {
      send({ type: "terminal_screen_update", agent_id: AGENT_ID, screen });
      lastBroadcastedScreen = screen;
    }
  }, SCREEN_INTERVAL);

  // Frame capture loop — skip when paused/exited
  frameIntervalId = setInterval(async () => {
    if (operatorOverride || lastSentState === "EXITED") return;
    try {
      let frame: string;
      if (PTY_MODE && terminal) {
        // PTY: capture from terminal grid ANSI output
        frame = await captureFrameFromGrid(terminal.getGrid().ansi);
      } else {
        // Pipe: capture from raw screen buffer
        frame = await captureFrame();
      }
      if (frame) {
        const buf = Buffer.from(frame, "base64");
        pushFrame(buf);
        send({ type: "frame_update", agent_id: AGENT_ID, frame });
        consecutiveFrameFailures = 0;
      }
    } catch (e: unknown) {
      consecutiveFrameFailures++;
      if (consecutiveFrameFailures === 5) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[probe] Frame capture failing repeatedly (5x): ${msg}`);
      }
    }
  }, FRAME_INTERVAL);

  // Tier 1: Fast perception loop — skip if paused/exited, deep reasoning, or in cooldown
  tier1IntervalId = setInterval(async () => {
    if (operatorOverride || lastSentState === "EXITED") return;
    if (isDeepReasoning || isFastPerceptionRunning) return;
    if (Date.now() - lastTier2Completion < TIER1_COOLDOWN) return;
    isFastPerceptionRunning = true;

    try {
      const lines = lastBroadcastedScreen.split("\n").filter((l) => l.trim());
      const trimmed = lines.slice(-15).join("\n");
      if (trimmed.length < 10) return;

      // BUG-1: Don't re-analyze identical screen content
      if (trimmed === lastAnalyzedScreen) return;
      lastAnalyzedScreen = trimmed;

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (response as any).choices[0]?.message?.content?.trim().toUpperCase() || "";
      console.log(`[tier1] ${result}`);

      const isAnomaly =
        result.includes("ANOMALY") ||
        (!result.includes("OK") && (result.includes("ERROR") || result.includes("FAIL")));

      if (isAnomaly) {
        if (isDeepReasoning) return;
        isDeepReasoning = true;

        console.log("[tier1] Anomaly detected — escalating to Tier 2");
        sendVlmState("STUCK", 50, "Tier 1 anomaly detected. Escalating to deep reasoner...");
        runDeepReasoning();
      } else {
        sendVlmState("PROGRESSING", 99, "System nominal");
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        console.log("[tier1] Timeout");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[tier1] Error:", msg);
      }
    } finally {
      isFastPerceptionRunning = false;
    }
  }, FAST_INTERVAL);

  // Telemetry listener — optional UDP receiver for AWOC integration
  if (TELEMETRY_PORT !== undefined && !telemetryListenerInstance) {
    createTelemetryListener({
      port: TELEMETRY_PORT,
      onEvent(payload: TelemetryPayload) {
        lastTelemetry = payload;
        send({
          type: "telemetry_update",
          agent_id: AGENT_ID,
          event_type: payload.event_type,
          run_id: payload.run_id,
          data: payload.data,
          telemetry: payload.telemetry,
        });
        console.log(`[telemetry] ${payload.event_type} run=${payload.run_id}`);
      },
      onError(err: Error) {
        console.warn(`[telemetry] ${err.message}`);
      },
    }).then((listener) => {
      telemetryListenerInstance = listener;
      console.log(`[probe] Telemetry listener on UDP port ${listener.port}`);
    }).catch((err) => {
      console.warn(`[probe] Telemetry listener failed to start: ${err.message}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Tier 2: Deep reasoning
// ---------------------------------------------------------------------------

function buildTelemetryContext(): string {
  if (!lastTelemetry) return "";
  const t = lastTelemetry;
  const parts: string[] = [];
  if (t.data.tool_name) {
    const argsStr = t.data.args ? ` with args ${JSON.stringify(t.data.args)}` : "";
    parts.push(`Currently executing tool '${t.data.tool_name}'${argsStr}.`);
  }
  if (t.data.agent_name) {
    parts.push(`Active agent: ${t.data.agent_name}.`);
  }
  parts.push(`Context usage: ${t.telemetry.context_percent.toFixed(1)}%.`);
  parts.push(`Active runs: ${t.telemetry.active_runs}.`);
  parts.push(`Run ID: ${t.run_id}.`);
  return `\n\nSEMANTIC TELEMETRY (from orchestrator):\n${parts.join(" ")}`;
}

async function runDeepReasoning() {
  const telemetryCtx = buildTelemetryContext();
  const basePrompt = `You are the L5 Argus Overseer. The fast-perception layer flagged an anomaly on the agent's terminal.
Determine the exact state: stuck in a loop, failing a build, or hallucinating commands?${telemetryCtx}

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
    const fb = getFrameBuffer();
    let usedVision = false;

    if (fb.length >= 2) {
      console.log(`[tier2] Vision mode — ${fb.length} frames available`);
      try {
        const gridBase64 = await compositeGrid(fb.slice(-4));

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          { signal: controller.signal },
        );
        usedVision = true;
      } catch (visionErr: unknown) {
        if (visionErr instanceof Error && visionErr.name === "AbortError") throw visionErr;
        const msg = visionErr instanceof Error ? visionErr.message : String(visionErr);
        console.warn(`[tier2] Vision failed (${msg}), falling back to text`);
      }
    }

    if (!usedVision) {
      // Text fallback: use current screen content
      console.log("[tier2] Text fallback mode");
      const currentScreen = (PTY_MODE && terminal) ? terminal.getGrid().text : getScreen();

      response = await openai.chat.completions.create(
        {
          model: VLM_MODEL,
          messages: [{ role: "user", content: `${basePrompt}\n\nCURRENT TERMINAL SCREEN:\n${currentScreen}` }],
          temperature: 0,
          max_tokens: 300,
          ...LLAMA_CPP_NO_THINK,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { signal: controller.signal },
      );
    }
    clearTimeout(timeout);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawText = (response as any).choices[0]?.message?.content?.trim() || "";
    console.log(`[tier2] Raw: ${rawText.substring(0, 120)}...`);

    const result = extractJSON(rawText);
    if (result) {
      console.log(`[tier2] Verdict: ${result.agent_state} — ${result.reasoning}`);
      sendVlmState(result.agent_state, result.confidence_score, result.reasoning);
    } else {
      console.error("[tier2] Failed to extract JSON from response");
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      console.log("[tier2] Timeout (45s)");
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[tier2] Error:", msg);
    }
  } finally {
    isDeepReasoning = false;
    lastTier2Completion = Date.now();
  }
}

// ---------------------------------------------------------------------------
// WebSocket connection with exponential backoff
// ---------------------------------------------------------------------------

let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function connect() {
  ws = new WebSocket(HUB_URL);

  ws.onopen = () => {
    reconnectDelay = 1000;
    console.log(`[probe] Connected to hub (${HUB_URL})`);
    send({
      type: "register",
      agent_id: AGENT_ID,
      metadata: {
        task: AGENT_TASK,
        command: SPAWN_CMD.join(" "),
        start_time: Date.now(),
      },
    });

    // Re-send current state on reconnect (probe already running)
    if (probeStarted) {
      sendVlmState(lastSentState, lastSentConfidence, lastSentReasoning);
      const screen = (PTY_MODE && terminal) ? terminal.getGrid().text : getScreen();
      if (screen) send({ type: "terminal_screen_update", agent_id: AGENT_ID, screen });
    }

    startProbe();
  };

  ws.onmessage = (event) => {
    let msg: CommandPayload;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      console.warn("[probe] Received malformed JSON from hub");
      return;
    }
    if (msg.type === "command") {
      if (msg.action === "pause") operatorOverride = "PAUSED";
      else if (msg.action === "resume") operatorOverride = null;
      handleCommand(msg, childProc, sendLog, sendVlmState);
    }
  };

  ws.onerror = () => {
    console.error("[probe] Hub connection error");
  };

  ws.onclose = () => {
    if (shuttingDown) return;
    const jitter = Math.random() * 1000;
    const delay = reconnectDelay + jitter;
    console.log(`[probe] Disconnected. Reconnecting in ${(delay / 1000).toFixed(1)}s...`);
    setTimeout(connect, delay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  };
}

// ---------------------------------------------------------------------------
// Top-level — only when run directly
// ---------------------------------------------------------------------------

if (import.meta.main) {
  console.log(`[probe] Argus Probe — agent=${AGENT_ID} cmd="${SPAWN_CMD.join(" ")}"`);
  if (TELEMETRY_PORT !== undefined) {
    console.log(`[probe] Telemetry UDP port: ${TELEMETRY_PORT}`);
  }
  connect();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export function getLastTelemetry(): TelemetryPayload | null {
  return lastTelemetry;
}

export { connect, startProbe, resetState };
