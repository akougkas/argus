import { OpenAI } from "openai";
import {
  extractJSON,
  getScreen,
  getScreenHistory,
  pushScreenHistory,
  getFrameBuffer,
  pushFrame,
  captureFrame,
  compositeGrid,
  handleCommand,
  pipeStream,
  resetState,
  type CommandPayload,
} from "./probe-utils";

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

// CLI: `bun run probe.ts -- python3 my_agent.py`  (default: demo_agent.ts)
const cliArgs = process.argv.slice(2);
const SPAWN_CMD = cliArgs.length > 0 ? cliArgs : ["bun", "run", "demo_agent.ts"];

const openai = new OpenAI({ baseURL: VLM_URL, apiKey: VLM_KEY });
const visionClient = new OpenAI({ baseURL: VISION_URL, apiKey: VISION_KEY });

// llama.cpp extension: disable thinking/reasoning mode for models that support it
const LLAMA_CPP_NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws: WebSocket;
let childProc: ReturnType<typeof Bun.spawn> | null = null;
let probeStarted = false;
let isDeepReasoning = false;
let isFastPerceptionRunning = false;
let lastBroadcastedScreen = "";

// Timer IDs for cleanup
let screenIntervalId: ReturnType<typeof setInterval> | null = null;
let frameIntervalId: ReturnType<typeof setInterval> | null = null;
let tier1IntervalId: ReturnType<typeof setInterval> | null = null;

// Frame capture failure tracking
let consecutiveFrameFailures = 0;

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

function clearIntervals() {
  if (screenIntervalId) { clearInterval(screenIntervalId); screenIntervalId = null; }
  if (frameIntervalId) { clearInterval(frameIntervalId); frameIntervalId = null; }
  if (tier1IntervalId) { clearInterval(tier1IntervalId); tier1IntervalId = null; }
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
    sendLog(`Failed to spawn: ${e instanceof Error ? e.message : String(e)}`, "error");
    probeStarted = false;
    return;
  }

  // Read stdout and stderr streams
  pipeStream(childProc.stdout as ReadableStream<Uint8Array> | null, "stdout", sendLog);
  pipeStream(childProc.stderr as ReadableStream<Uint8Array> | null, "stderr", sendLog);

  // Wait for exit
  childProc.exited.then((code) => {
    console.log(`[probe] Agent exited with code ${code}`);
    sendLog(`Agent exited (code ${code})`, "system");
    clearIntervals();
    childProc = null;
    probeStarted = false;
  });

  // Screen broadcast loop
  screenIntervalId = setInterval(() => {
    const screen = getScreen();
    if (screen && screen !== lastBroadcastedScreen) {
      send({ type: "terminal_screen_update", agent_id: AGENT_ID, screen });
      lastBroadcastedScreen = screen;
      pushScreenHistory(screen);
    }
  }, SCREEN_INTERVAL);

  // Frame capture loop
  frameIntervalId = setInterval(async () => {
    try {
      const frame = await captureFrame();
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

  // Tier 1: Fast perception loop
  tier1IntervalId = setInterval(async () => {
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
    const fb = getFrameBuffer();

    if (fb.length >= 2) {
      console.log(`[tier2] Vision mode — ${fb.length} frames available`);
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
    } else {
      console.log("[tier2] Text fallback mode");
      const history = getScreenHistory().slice(-4).join("\n\n--- PREVIOUS FRAME ---\n\n");

      response = await openai.chat.completions.create(
        {
          model: VLM_MODEL,
          messages: [{ role: "user", content: `${basePrompt}\n\nTEMPORAL SCREEN HISTORY:\n${history}` }],
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
      send({ type: "vlm_update", agent_id: AGENT_ID, data: result });
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
    send({ type: "register", agent_id: AGENT_ID });
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
    if (msg.type === "command") handleCommand(msg, childProc, sendLog);
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

// ---------------------------------------------------------------------------
// Top-level — only when run directly
// ---------------------------------------------------------------------------

if (import.meta.main) {
  console.log(`[probe] Argus Probe — agent=${AGENT_ID} cmd="${SPAWN_CMD.join(" ")}"`);
  connect();
}

export { connect, startProbe, resetState };
