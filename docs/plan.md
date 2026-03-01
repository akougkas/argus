# Project Argus: Execution Plan

This document outlines the multi-day effort to build Project Argus from the ground up, transitioning from a rapid Proof of Concept to a robust Enterprise DAEMON and SaaS dashboard.

## Phase 1: The "Wow Factor" Proof of Concept (Current Phase)
**Goal:** Build a rapid, local-only prototype to demonstrate the core value proposition (AI supervising AI) and generate viral interest.
*   **1.1 Python Edge Probe (`argus_probe.py`):**
    *   Write a Python script that takes a screen capture every 5 seconds using `mss` or `screencapture`/`scrot`.
    *   Implement basic SSIM or pixel diffing to only save frames that have changed.
    *   Implement local log ingestion (tailing a file or piping stdout).
*   **1.2 VLM Verification Loop:**
    *   Every 60 seconds, package the keyframes and recent logs.
    *   Send the payload to the Gemini 1.5 Flash API using the strict JSON schema prompt.
*   **1.3 Local Dashboard / Alerting:**
    *   Connect the existing Next.js dashboard UI to this local python probe (via a simple local HTTP server/WebSocket).
    *   Ensure the Next.js UI properly reflects the real-time VLM inferences (Progressing, Stuck, Dangerous).

## Phase 2: The Core Telemetry Moat (Rust Edge Daemon)
**Goal:** Replace the Python PoC with the high-performance, memory-safe Rust daemon (`argusd`).
*   **2.1 Rust Project Setup:** Initialize the Cargo workspace.
*   **2.2 Zero-Copy Visuals:** Implement X11/Wayland shared memory (`shmget`) extraction and SIMD-accelerated SSIM calculations.
*   **2.3 PTY Multiplexing:** Wrap the target agent process in a pseudo-terminal using `portable-pty` to capture raw ANSI logs and interactive prompts.
*   **2.4 Performance Tuning:** Ensure the daemon strictly respects cgroups limits (<1% CPU, <50MB RAM).

## Phase 3: Ingestion Engine & Verification Loop (Cloud Backend)
**Goal:** Stand up the scalable cloud infrastructure to handle multiple agents and robust VLM orchestration.
*   **3.1 Go WebRTC & Ingestion:** Build the backend service to receive UDP frames and batch them into Kafka.
*   **3.2 Temporal.io Orchestration:** Set up Temporal workflows to manage the sliding temporal window (Redis) and ping the Gemini 1.5 API.
*   **3.3 Real-time DB:** Store historical logs and VLM judgments in PostgreSQL or DuckDB (currently in `.mcp/zulipchat/zulipchat.duckdb`? Evaluate storage needs).

## Phase 4: Actuation & Control (The "Steering Wheel")
**Goal:** Implement the bidirectional communication to actually control the agent.
*   **4.1 Hard Brake (`SIGSTOP`):** Implement the gRPC command to freeze the agent's PID tree.
*   **4.2 Soft Steer (LLM MITM Proxy):** Build the local HTTP interceptor to inject `system` prompts into the agent's outgoing LLM requests.
*   **4.3 Dashboard Integration:** Wire up the "Pause", "Kill", and "Inject Prompt" buttons on the Next.js dashboard to trigger these actuations.

## Phase 5: SaaS Polish & Launch
*   **5.1 Auth & Tenancy:** Add NextAuth or Clerk for B2B user management.
*   **5.2 Billing:** Integrate Stripe (e.g., $1.00 per agent-hour monitoring).
*   **5.3 Time-Lapse Generation:** Use `ffmpeg` to stitch keyframes into a fast-forwarded video summary with VLM chapter markers.
*   **5.4 SDK Packages:** Publish `@argus-ai/observer` to NPM and `argus-observer` to PyPI.
