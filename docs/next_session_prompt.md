# Argus Development - Next Session Prompt

You are taking over the development of **Project Argus**, a visual, real-time verification and steering layer for long-horizon AI agents ("Datadog for AI Agents").

## 1. Project Context & Current Architecture
We have successfully scaffolded a multi-tier pipeline, but it needs stabilization, a thorough code review, and a realistic TypeScript/Bun demo agent. 

**Current Stack:**
*   **Frontend (Next.js):** Located in `src/`. A dark-mode, terminal-styled dashboard that connects to a local WebSocket hub. It renders live agent logs, visual frame buffers (a raw text grid), and VLM anomaly alerts.
*   **Hub Server (Python/FastAPI):** `python-probe/server.py`. A lightweight WebSocket router that accepts connections from both the Next.js dashboard and edge probes, routing messages between them.
*   **The Edge Probe (Python/pty):** `python-probe/pty_probe.py`. A highly optimized pseudo-terminal (PTY) multiplexer using `pyte`. It wraps an agent process, captures raw ANSI streams, maintains a 2D virtual screen, and streams the UI at 20fps.
*   **The Compound VLM Engine:** We use a Two-Tier system powered **exclusively** by a local `Qwen3.5-35B-A3B-UD-Q4_K_XL` model running on `llama.cpp` at `http://100.74.131.112:8080/v1` (the "Mini" node). 
    *   **Tier 1 (Fast Perception):** Runs frequently, looks at the bottom 15 lines of the terminal, and replies quickly (OK/ANOMALY).
    *   **Tier 2 (Deep Reasoning):** Triggers only on anomalies. Reviews temporal screen history and outputs strict JSON explaining the agent's failure state.

## 2. Your Mission

### Step 1: Code Review & Wiring Verification
Please review `pty_probe.py`, `server.py`, and `src/app/page.tsx`. 
*   Fix any lingering bugs in JSON extraction, asynchronous deadlocks, or WebSocket routing.
*   Ensure that the Next.js frontend perfectly handles `terminal_screen_update`, `log_update`, and `vlm_update` events. The UI should smoothly stream the terminal grid without flickering, and properly flash/display reasoning when the VLM intervenes.

### Step 2: Build a Realistic Bun + TypeScript Demo Agent
We are currently using a rudimentary Python script (`dummy_agent.py`) to fake an agent's terminal output. I want you to replace this with a modern, realistic **Bun + TypeScript** mock agent.
*   Create `demo_agent.ts`.
*   Simulate a modern SWE-Agent or Data-Agent workflow (e.g., using Chalk for colors, showing realistic `npm/bun install` outputs, progress bars, and git checkouts).
*   Script a scenario where the agent makes progress, hits a warning but recovers, and then ultimately gets trapped in a catastrophic, infinite error loop (e.g., a permissions error, an unresolvable dependency, or an endless hallucination). 
*   This needs to output raw ANSI that our `pyte` virtual terminal can parse.

### Step 3: End-to-End Stabilization
*   Wire the `pty_probe.py` to supervise your new `bun run demo_agent.ts` process.
*   Run the pipeline end-to-end and use your browser tools to verify the dashboard accurately reflects the Bun agent's terminal and successfully catches the anomaly using the Qwen 3.5 model.
*   Ensure that the `wait_for` timeouts and concurrency locks in `pty_probe.py` perfectly protect the local Llama server from being overwhelmed if it runs slowly.

Please proceed methodically. Start by auditing the codebase, then build the Bun demo, and finally run the system.