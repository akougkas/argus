# Project Argus

**Real-time visual verification and steering for autonomous AI agents.**

As the industry shifts from chatbots to long-horizon autonomous agents, the biggest barrier to enterprise adoption isn't intelligence — it's trust, observability, and control. Argus is the missing layer: a lightweight probe that watches what your agent does via VLM-powered visual analysis, detects failures in real time, and gives humans a steering wheel.

![Argus Dashboard](docs/assets/dashboard.png)

## How It Works

A **probe** wraps any command (Python agent, SWE-agent, shell script) and monitors its terminal output. Every second, a Vision-Language Model evaluates the agent's state. If it detects errors, stuck loops, destructive behavior, or hallucinations, the dashboard lights up — and the human can pause, kill, or inject a correction.

```
[any command] ──spawn──▶ probe.ts ──WS──▶ hub.ts ──WS──▶ dashboard
                           │                 ▲                │
                        VLM tiers            │          pause/kill/inject
                       (Tier 1+2)            └────────────────┘
```

**Tier 1 — Fast Perception (every 1s):** Binary anomaly check. "Is there an error?" → `ANOMALY` or `OK`. 10 tokens, sub-second.

**Tier 2 — Deep Reasoning (on escalation):** Temporal analysis of the last 4 screen states. Returns structured JSON: state classification, confidence score, and reasoning.

**Agent States:** `PROGRESSING` · `STUCK` · `DANGEROUS` · `HALLUCINATING`

## Quick Start

```bash
# Install dependencies
bun install

# Terminal 1: Start the WebSocket hub
bun run dev:hub

# Terminal 2: Start the dashboard
bun run dev:dashboard

# Terminal 3: Start the probe (wraps demo agent by default)
bun run dev:probe

# Or wrap any command
bun run probe.ts -- python3 my_agent.py
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

### Environment

Copy `.env.example` to `.env` and configure your VLM endpoint:

```bash
cp .env.example .env
```

The probe works with any OpenAI-compatible API (llama.cpp, Ollama, OpenAI, etc.). Key variables:

| Variable | Default | Description |
|---|---|---|
| `ARGUS_VLM_URL` | `http://localhost:8080/v1` | VLM endpoint |
| `ARGUS_VLM_MODEL` | `gpt-4o-mini` | Model name |
| `ARGUS_VLM_KEY` | `no-key` | API key |
| `ARGUS_HUB_PORT` | `8000` | Hub WebSocket port |
| `ARGUS_AGENT_ID` | `A-01` | Agent identifier |

## Dashboard Controls

- **Pause** — Sends `SIGSTOP` to freeze the agent process in memory
- **Kill** — Sends `SIGKILL` to terminate immediately
- **Inject** — Writes text directly to the agent's stdin (steering prompt)

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Frontend | Next.js 16, React 19, CSS Modules |
| Backend | Bun WebSocket server |
| VLM | OpenAI SDK → any compatible endpoint |
| Font | JetBrains Mono |

## Project Status

This is a working proof-of-concept. The text-based VLM pipeline is functional. See [docs/plan.md](docs/plan.md) for the full roadmap.

**Current phase:** PoC with text-based VLM analysis
**Next phase:** Visual pipeline (terminal screenshots → VLM vision API) for richer analysis

## Architecture Docs

- [Architecture Blueprint](docs/architecture.md) — Full system design vision
- [Execution Plan](docs/plan.md) — Multi-phase roadmap
- [Progress Tracker](docs/progress.md) — Current status

## License

MIT
