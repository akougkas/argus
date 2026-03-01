import * as pty from "node-pty";
import { Terminal } from "@xterm/headless";
import { OpenAI } from "openai";

// ---------------------------------------------------------------------------
// Configuration (all from env vars or CLI args)
// ---------------------------------------------------------------------------

const AGENT_ID = process.env.ARGUS_AGENT_ID || "A-01";
const HUB_URL = process.env.ARGUS_HUB_URL || "ws://localhost:8000/ws/probe";
const VLM_URL = process.env.ARGUS_VLM_URL || "http://localhost:8080/v1";
const VLM_MODEL = process.env.ARGUS_VLM_MODEL || "gpt-4o-mini";
const VLM_KEY = process.env.ARGUS_VLM_KEY || "no-key";
const FAST_INTERVAL = parseInt(process.env.ARGUS_FAST_INTERVAL || "1000");
const SCREEN_INTERVAL = parseInt(process.env.ARGUS_SCREEN_INTERVAL || "50");

// CLI: `bun run probe.ts -- python3 my_agent.py`  (default: demo_agent.ts)
const cliArgs = process.argv.slice(2);
const SPAWN_CMD = cliArgs.length > 0 ? cliArgs : ["bun", "run", "demo_agent.ts"];

const openai = new OpenAI({ baseURL: VLM_URL, apiKey: VLM_KEY });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const term = new Terminal({ cols: 120, rows: 24, allowProposedApi: true });
const ANSI_RE = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;

let ws: WebSocket;
let ptyProcess: pty.IPty | null = null;
let probeStarted = false;
let isDeepReasoning = false;
let isFastPerceptionRunning = false;
let lastBroadcastedScreen = "";
let screenHistory: string[] = [];

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
  // 1. Direct parse
  try { return JSON.parse(text); } catch {}
  // 2. Fenced code block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) try { return JSON.parse(fenced[1]); } catch {}
  // 3. Brace extraction (VLM prepends/appends commentary)
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.substring(start, end + 1)); } catch {}
  }
  return null;
}

function getScreen(): string {
  let screen = "";
  const buf = term.buffer.active;
  for (let i = 0; i < term.rows; i++) {
    const line = buf.getLine(i);
    screen += (line ? line.translateToString(true).trimEnd() : "") + "\n";
  }
  return screen.replace(/\n+$/, "");
}

// ---------------------------------------------------------------------------
// Command handler (pause / kill / inject from dashboard via hub)
// ---------------------------------------------------------------------------

function handleCommand(msg: any) {
  if (!ptyProcess) {
    console.warn("[probe] No active process to command");
    return;
  }

  switch (msg.action) {
    case "pause":
      try {
        process.kill(ptyProcess.pid, "SIGSTOP");
        sendLog("Agent paused (SIGSTOP)", "system");
        console.log(`[probe] SIGSTOP sent to PID ${ptyProcess.pid}`);
      } catch (e) {
        console.error("[probe] Failed to pause:", e);
      }
      break;

    case "resume":
      try {
        process.kill(ptyProcess.pid, "SIGCONT");
        sendLog("Agent resumed (SIGCONT)", "system");
        console.log(`[probe] SIGCONT sent to PID ${ptyProcess.pid}`);
      } catch (e) {
        console.error("[probe] Failed to resume:", e);
      }
      break;

    case "kill":
      try {
        process.kill(ptyProcess.pid, "SIGKILL");
        sendLog("Agent killed (SIGKILL)", "system");
        console.log(`[probe] SIGKILL sent to PID ${ptyProcess.pid}`);
      } catch (e) {
        console.error("[probe] Failed to kill:", e);
      }
      break;

    case "inject":
      if (msg.content) {
        ptyProcess.write(msg.content + "\n");
        sendLog(`Injected prompt: ${msg.content}`, "system");
        console.log(`[probe] Injected: ${msg.content}`);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// PTY + Monitoring pipeline
// ---------------------------------------------------------------------------

function startProbe() {
  if (probeStarted) return;
  probeStarted = true;

  const [cmd, ...args] = SPAWN_CMD;
  console.log(`[probe] Spawning: ${SPAWN_CMD.join(" ")}`);

  try {
    ptyProcess = pty.spawn(cmd, args, {
      name: "xterm-color",
      cols: 120,
      rows: 24,
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "1" },
    });
  } catch (e) {
    console.error(`[probe] Failed to spawn "${cmd}":`, e);
    probeStarted = false;
    return;
  }

  let lineBuffer = "";

  ptyProcess.onData((data) => {
    term.write(data);

    // Extract log lines
    const clean = data.replace(ANSI_RE, "");
    lineBuffer += clean;

    let idx;
    while ((idx = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, idx).trim();
      lineBuffer = lineBuffer.slice(idx + 1);
      if (line) {
        const isError = /error|exception|fatal|✖/i.test(line);
        sendLog(line, isError ? "error" : "info");
      }
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[probe] Agent exited with code ${exitCode}`);
    sendLog(`Agent exited (code ${exitCode})`, "system");
    ptyProcess = null;
    probeStarted = false;
  });

  // Screen broadcast loop
  setInterval(() => {
    const screen = getScreen();
    if (screen !== lastBroadcastedScreen) {
      send({ type: "terminal_screen_update", agent_id: AGENT_ID, screen });
      lastBroadcastedScreen = screen;
      screenHistory.push(screen);
      if (screenHistory.length > 10) screenHistory.shift();
    }
  }, SCREEN_INTERVAL);

  // Tier 1: Fast perception loop
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
        },
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      const result = response.choices[0]?.message?.content?.trim().toUpperCase() || "";
      console.log(`[tier1] ${result}`);

      const isAnomaly =
        result.includes("ANOMALY") ||
        (!result.includes("OK") && (result.includes("ERROR") || result.includes("FAIL")));

      if (isAnomaly) {
        // Set flag synchronously BEFORE any async work (race condition fix)
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

        // Fire-and-forget — don't block the fast loop
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
// Tier 2: Deep reasoning
// ---------------------------------------------------------------------------

async function runDeepReasoning() {
  const history = screenHistory.slice(-4).join("\n\n--- PREVIOUS FRAME ---\n\n");
  const prompt = `You are the L5 Argus Overseer. The fast-perception layer flagged an anomaly on the agent's screen.
Review the recent temporal history of the terminal to determine the exact state. Is it stuck in a loop, failing a build, or hallucinating commands?

TEMPORAL SCREEN HISTORY:
${history}

Reply ONLY with a raw, valid JSON object using the exact schema below:
{
  "agent_state": "STUCK" | "DANGEROUS" | "HALLUCINATING",
  "confidence_score": 0-100,
  "reasoning": "A concise explanation of the failure and what the agent is attempting to do."
}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const response = await openai.chat.completions.create(
      {
        model: VLM_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      },
      { signal: controller.signal },
    );
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
    reconnectDelay = 1000; // Reset on success
    console.log(`[probe] Connected to hub (${HUB_URL})`);

    // Register with hub
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
