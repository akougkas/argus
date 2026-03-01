# Project Argus: Roadmap

## Phase 1: Working PoC (DONE)
Text-based VLM pipeline, end-to-end.
- Bun WebSocket hub with dynamic agent registry
- Probe wraps any command via Bun.spawn, streams logs + screen state
- Two-tier VLM: fast text tier1 (1s) + deep reasoning tier2 (on anomaly)
- Dashboard: CRT terminal aesthetic, live agent grid, pause/kill/inject controls
- Demo agent simulating SWE-agent failure loops

## Phase 2: Visual VLM Pipeline (DONE)
Terminal screenshots fed to vision models for richer analysis.
- ANSI-to-SVG rendering (ansi-to-svg) + sharp rasterization to JPEG
- Frame buffer with periodic capture (every 2s)
- Tier2 vision: 2x2 temporal grid composited from recent frames
- Separate vision model config (text tier1 stays fast, vision tier2 goes deep)
- Frame streaming to dashboard via `frame_update` messages
- Dashboard: real probes only (no mocks), agent_disconnected handling, Resume button

## Phase 3: Hardening & Multi-Agent
Make it production-usable for real agent workflows.
- Reconnection resilience (probe ↔ hub ↔ dashboard)
- Multi-probe support: run N probes with different ARGUS_AGENT_ID values
- Agent metadata: task name, start time, command being wrapped
- Log persistence (SQLite or file-based) for post-mortem analysis
- SSIM-based frame deduplication at the probe level (skip unchanged screens)

## Phase 4: Actuation & Steering
Close the loop — not just observe, but intervene.
- LLM MITM proxy: intercept agent's outbound API calls, inject system prompts
- Auto-pause on high-confidence DANGEROUS detection (configurable threshold)
- Timelapse generation: stitch keyframes into video summary with VLM chapter markers
- Webhook/Slack notifications on state transitions

## Phase 5: Production Infrastructure
Scale beyond local dev.
- Rust daemon (argusd) for zero-copy visual capture and strict resource bounding
- WebRTC live streaming for sub-150ms latency to remote dashboards
- Cloud backend: Kafka/Redis temporal buffers, PostgreSQL for historical data
- Auth, tenancy, billing (SaaS model)
- SDK packages: `@argus-ai/observer` (npm), `argus-observer` (PyPI)
