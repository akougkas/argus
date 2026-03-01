# Project Argus: Progress Tracker

## v0.0.x — Proof of Concept (DONE)

### Phase 1: Text-Based VLM Pipeline
- [x] Next.js dashboard with CRT terminal aesthetic
- [x] Architecture blueprint and execution plan
- [x] Bun WebSocket hub with dynamic agent registry and command routing
- [x] Probe wraps any command via Bun.spawn, streams logs + screen state
- [x] Two-tier VLM pipeline: fast perception (tier1) + deep reasoning (tier2)
- [x] Homelab Qwen3.5 integration with thinking mode disabled
- [x] Dashboard controls: pause (SIGSTOP), kill (SIGKILL), inject (stdin write)
- [x] Demo agent simulating SWE-agent failure loop
- [x] End-to-end detection: PROGRESSING → STUCK → DANGEROUS state transitions

### Phase 2: Visual VLM Pipeline
- [x] ANSI-to-SVG rendering of terminal output (ansi-to-svg)
- [x] sharp rasterization to JPEG frames (960x540, q60)
- [x] Raw ANSI line buffer alongside stripped text
- [x] Frame capture loop (every 2s) with 10-frame buffer
- [x] Temporal frame grid (2x2 composite via sharp.composite)
- [x] Vision API integration (tier2 with image input, separate model config)
- [x] Frame streaming to dashboard (frame_update messages)
- [x] Text tier2 fallback when frames unavailable

### Phase 3: Dashboard Cleanup
- [x] Remove mock agents, show only real connected probes
- [x] Handle agent_disconnected message (remove from UI)
- [x] Add Resume button (SIGCONT unpause)
- [x] Empty state when no agents connected
- [x] Fix log_update handler (add missing id/timestamp fields)

## v0.1.0 — Testable Foundation (NEXT)
- [ ] Refactor hub.ts: `createHub()` factory + `import.meta.main` guard
- [ ] Refactor probe.ts: extract `probe-utils.ts`, parameterize deps
- [ ] Extract `useAgentSocket` hook from page.tsx
- [ ] Unit tests: extractJSON, screen buffer, hub routing, commands, pipeStream
- [ ] Integration test: hub → probe → dashboard pipeline
- [ ] Type safety: message schemas, validation guards
- [ ] Fix silent failures (frame capture, stream close, dashboard JSON)
- [ ] Timer cleanup on child process exit
- [ ] Dashboard hub URL from `NEXT_PUBLIC_HUB_URL`
- [ ] GitHub Actions CI: lint → build → test
- [ ] 80%+ test coverage on core logic
- [ ] Tag v0.1.0

## v0.2.0 — Hardening
- [ ] Dashboard auto-reconnect
- [ ] Hub health check endpoint
- [ ] Probe VLM health check at startup
- [ ] Bound lineBuffer growth
- [ ] Spawn failure retry
- [ ] Remove redundant screenHistory
- [ ] Evaluate ansi-to-svg replacement
- [ ] React key monotonic counter
- [ ] Memory profiling

## v0.3.0 — Multi-Agent & Persistence
- [ ] Multi-probe routing
- [ ] Agent metadata in register message
- [ ] SQLite log persistence
- [ ] Post-mortem replay API
- [ ] SSIM frame deduplication
- [ ] Dashboard metadata display + log search

## v0.4.0 — Actuation & Alerts
- [ ] Auto-pause on high-confidence DANGEROUS
- [ ] Webhook notifications on state transitions
- [ ] Slack integration
- [ ] State transition history
- [ ] Dashboard timeline visualization

## v0.5.0 — Beta
- [ ] Real agent end-to-end test
- [ ] Dashboard polish + keyboard shortcuts
- [ ] Documentation (troubleshooting, examples, API ref)
- [ ] Performance audit
- [ ] Installable package (`bunx argus`)
- [ ] Tagged GitHub release with changelog
