# 👁️ Project Argus

**"Datadog for Autonomous Agents"**

As the AI industry shifts from "chatbots" to "long-horizon autonomous agents", the biggest barrier to enterprise adoption isn't intelligence; it’s trust, observability, and cost-control.

**Project Argus** is a visual, real-time verification and steering layer for long-horizon AI agents, bridging the gap between autonomous execution and human oversight. It acts as a "Baby Monitor / Security Camera" paired with an Overseer Vision-Language Model (VLM).

## Core Features
*   **The "Live Cam" Dashboard:** A web UI showing a grid of live visual feeds (headless browsers, IDEs, or terminals) of all active agents.
*   **VLM Overseer Loop:** An asynchronous background loop that feeds sampled frames to a VLM (Gemini 1.5 Flash) to evaluate states: Progressing, Looping/Stuck, Destructive Behavior, and Hallucinating.
*   **Smart Alerting:** Webhook, Slack, or SMS notifications triggered by the VLM.
*   **Intervention API (The Steering Wheel):** A two-way communication channel allowing the human observer to click a button to pause the agent (`SIGSTOP`), kill the process, or inject a steering prompt (LLM MITM Prompt Injection).
*   **Time-Lapse Summaries:** Fast-forwarded video summaries of sessions with VLM-narrated chapter markers.

## Architecture & Planning

This repository is being built iteratively. Please see the `docs/` directory for deep-dive architectural design and our execution plan.

*   [Architecture Blueprint](./docs/architecture.md): Detailed breakdown of the Telemetry, Transport, and Overseer planes.
*   [Execution Plan](./docs/plan.md): The multi-phase approach from Local Python PoC to Rust Daemon to Cloud SaaS.
*   [Progress Tracker](./docs/progress.md): Current status and next steps.

## Repository Structure

Currently, this repository holds the **Next.js Dashboard** scaffold in `src/`.
Future additions will include the `argusd` (Rust daemon), `argus-backend` (Go/FastAPI), and `argus-probe` (Python PoC).

```bash
/
├── docs/             # Architectural specs and planning
├── src/              # Next.js Dashboard UI
├── package.json
└── README.md
```

## Getting Started (Dashboard UI)

First, run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the mocked live view of the Overseer dashboard.
