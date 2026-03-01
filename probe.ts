import * as pty from 'node-pty';
import { Terminal } from '@xterm/headless';
import { OpenAI } from 'openai';

// ==============================================================================
// PIPELINE CONFIGURATION: THE TWO-TIER COMPOUND VLM
// ==============================================================================

const API_BASE = "http://100.74.131.112:8080/v1";
const MODEL_NAME = "Qwen3.5-35B-A3B-UD-Q4_K_XL";
const AGENT_ID = "A-01";

const openai = new OpenAI({ baseURL: API_BASE, apiKey: "llamacpp" });

const term = new Terminal({ cols: 120, rows: 24, allowProposedApi: true });
let ws: WebSocket;

let isDeepReasoning = false;
let isFastPerceptionRunning = false;
let lastBroadcastedScreen = "";
let screenHistory: string[] = [];

function connect() {
    ws = new WebSocket("ws://localhost:8000/ws/probe");
    
    ws.onopen = () => {
        console.log("[*] Connected to Bun Hub Server");
        startProbe();
    };

    ws.onerror = (err) => {
        console.log("[!] Hub Server connection error.");
    };

    ws.onclose = () => {
        console.log("[!] Disconnected from Hub Server. Reconnecting in 3s...");
        setTimeout(connect, 3000);
    };
}

let probeRunning = false;

function startProbe() {
    if (probeRunning) return;
    probeRunning = true;

    // Launch the target demo agent
    console.log("[*] Spawning Bun Demo Agent via node-pty...");
    const ptyProcess = pty.spawn('bun', ['run', 'demo_agent.ts'], {
        name: 'xterm-color',
        cols: 120,
        rows: 24,
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: '1' }
    });

    let buffer = "";
    // Strip ANSI escape codes
    const ansiEscape = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;

    ptyProcess.onData((data) => {
        // Feed the raw ANSI stream to the virtual xterm buffer
        term.write(data);

        // Process line-by-line logs for the UI
        const cleanText = data.replace(ansiEscape, '');
        buffer += cleanText;
        
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            
            if (line && !line.startsWith('[npm] fetching')) { // filter out verbose progress bar
                const isError = line.toLowerCase().includes('error') || line.toLowerCase().includes('exception') || line.includes('✖');
                const logObj = {
                    id: Date.now().toString() + Math.random().toString(36).substring(2, 8),
                    timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
                    text: line,
                    type: isError ? 'error' : 'info'
                };
                
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'log_update',
                        agent_id: AGENT_ID,
                        log: logObj
                    }));
                }
            }
        }
    });

    ptyProcess.onExit(({ exitCode }) => {
        console.log(`[!] Agent process exited with code ${exitCode}`);
        probeRunning = false;
    });

    // 2. Broadcast visual screen state to UI (approx 20 FPS)
    setInterval(() => {
        let currentScreen = "";
        const activeBuffer = term.buffer.active;
        for (let i = 0; i < term.rows; i++) {
            const line = activeBuffer.getLine(i);
            currentScreen += (line ? line.translateToString(true) : "") + '\n';
        }
        
        // Trim right-side empty space for cleaner transmission, but keep structure
        currentScreen = currentScreen.split('\n').map(l => l.trimEnd()).join('\n').replace(/\n+$/, '');

        if (currentScreen !== lastBroadcastedScreen) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: "terminal_screen_update",
                    agent_id: AGENT_ID,
                    screen: currentScreen
                }));
            }
            lastBroadcastedScreen = currentScreen;
            screenHistory.push(currentScreen);
            
            // Rolling buffer of the last 10 unique frames for temporal reasoning
            if (screenHistory.length > 10) screenHistory.shift();
        }
    }, 50);

    // 3. Fast Perception Loop (Tier 1 VLM)
    setInterval(async () => {
        if (isDeepReasoning || isFastPerceptionRunning) return;
        isFastPerceptionRunning = true;
        
        try {
            const lines = lastBroadcastedScreen.split('\n').filter(l => l.trim() !== '');
            // Take the last 15 non-empty lines
            const trimmedScreen = lines.slice(-15).join('\n');
            
            if (trimmedScreen.length < 10) {
                isFastPerceptionRunning = false;
                return;
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await openai.chat.completions.create({
                model: MODEL_NAME,
                messages: [{ 
                    role: "user", 
                    content: `Analyze this terminal text. Is there an error, failure, exception, or crash?\nReply EXACTLY with one word: ANOMALY or OK.\n\nTEXT:\n${trimmedScreen}` 
                }],
                temperature: 0.0,
                max_tokens: 10
            }, { signal: controller.signal });
            clearTimeout(timeout);

            const resultText = response.choices[0]?.message?.content?.trim().toUpperCase() || "";
            console.log(`[*] Fast VLM response: '${resultText}'`);
            
            const isAnomaly = resultText.includes("ANOMALY") || 
                             (!resultText.includes("OK") && (resultText.includes("ERROR") || resultText.includes("FAIL")));

            if (isAnomaly) {
                if (isDeepReasoning) return;
                isDeepReasoning = true;
                console.log("\n[!] Tier 1 Fast-VLM detected anomaly. Escalating...");
                
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: "vlm_update",
                        agent_id: AGENT_ID,
                        data: {
                            agent_state: "STUCK",
                            confidence_score: 50,
                            reasoning: "Tier 1 anomaly detected. Escalating to deep reasoner..."
                        }
                    }));
                }
                
                // Do not await it here so fast loop returns and deep reasoning handles itself
                runDeepReasoning();
            } else {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: "vlm_update",
                        agent_id: AGENT_ID,
                        data: {
                            agent_state: "PROGRESSING",
                            confidence_score: 99,
                            reasoning: "System Nominal"
                        }
                    }));
                }
            }
        } catch (e: any) {
            if (e.name === 'AbortError') {
                console.log("[!] Fast VLM timeout.");
            }
        } finally {
            isFastPerceptionRunning = false;
        }
    }, 1000);
}

async function runDeepReasoning() {
    const historyText = screenHistory.slice(-4).join('\n\n--- PREVIOUS FRAME ---\n\n');
    const prompt = `You are the L5 Argus Overseer. The fast-perception layer flagged an anomaly on the agent's screen.
Review the recent temporal history of the terminal to determine the exact state. Is it stuck in a loop, failing a build, or hallucinating commands?

TEMPORAL SCREEN HISTORY:
${historyText}

Reply ONLY with a raw, valid JSON object using the exact schema below:
{
  "agent_state": "STUCK" | "DANGEROUS" | "HALLUCINATING",
  "confidence_score": 0-100,
  "reasoning": "A concise explanation of the failure and what the agent is attempting to do."
}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);

        const response = await openai.chat.completions.create({
            model: MODEL_NAME,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.0
        }, { signal: controller.signal });
        clearTimeout(timeout);

        const rawText = response.choices[0]?.message?.content?.trim() || "";
        console.log(`[*] Tier 2 Raw Response: '${rawText}'`);

        let result = null;
        try {
            result = JSON.parse(rawText);
        } catch (e) {
            const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (match) result = JSON.parse(match[1]);
        }

        if (result) {
            console.log(`[*] Tier 2 Verdict: ${result.agent_state} - ${result.reasoning}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: "vlm_update",
                    agent_id: AGENT_ID,
                    data: result
                }));
            }
        } else {
            console.log(`[!] Tier 2 failed to extract JSON from response: '${rawText}'`);
        }
    } catch (e) {
        console.log("[!] Tier 2 Reasoning failed:", e);
    } finally {
        isDeepReasoning = false;
    }
}

connect();