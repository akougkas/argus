# Project Argus: Progress Tracker

## Phase 1: Working PoC (Text-Based VLM)
- [x] Next.js dashboard with CRT terminal aesthetic
- [x] Architecture blueprint and execution plan
- [x] Bun WebSocket hub with dynamic agent registry and command routing
- [x] Probe wraps any command via Bun.spawn, streams logs + screen state
- [x] Two-tier VLM pipeline: fast perception (tier1) + deep reasoning (tier2)
- [x] Homelab Qwen3.5 integration with thinking mode disabled
- [x] Dashboard controls: pause (SIGSTOP), kill (SIGKILL), inject (stdin write)
- [x] Demo agent simulating SWE-agent failure loop
- [x] End-to-end detection: PROGRESSING → STUCK → DANGEROUS state transitions

## Phase 2: Visual VLM Pipeline
- [x] ANSI-to-SVG rendering of terminal output (ansi-to-svg)
- [x] sharp rasterization to JPEG frames (960x540, q60)
- [x] Raw ANSI line buffer alongside stripped text
- [x] Frame capture loop (every 2s) with 10-frame buffer
- [x] Temporal frame grid (2x2 composite via sharp.composite)
- [x] Vision API integration (tier2 with image input, separate model config)
- [x] Frame streaming to dashboard (frame_update messages)
- [x] Text tier2 fallback when frames unavailable

## Phase 3: Dashboard Cleanup
- [x] Remove mock agents, show only real connected probes
- [x] Handle agent_disconnected message (remove from UI)
- [x] Add Resume button (SIGCONT unpause)
- [x] Empty state when no agents connected
- [x] Fix log_update handler (add missing id/timestamp fields)

## Phase 4: Hardening & Multi-Agent
- [ ] Multi-probe support with unique agent IDs
- [ ] Agent metadata (task name, start time, wrapped command)
- [ ] Log persistence for post-mortem analysis
- [ ] SSIM-based frame deduplication

## Phase 5: Actuation & Steering
- [ ] LLM MITM proxy for prompt injection steering
- [ ] Auto-pause on high-confidence DANGEROUS
- [ ] Timelapse generation
- [ ] Webhook/Slack notifications

## Phase 6: Production Infrastructure
- [ ] Rust daemon (argusd)
- [ ] WebRTC live streaming
- [ ] Cloud backend (Kafka/Redis/PostgreSQL)
- [ ] Auth, tenancy, billing
- [ ] SDK packages
