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

## v0.1.0 — Testable Foundation (DONE, tagged)
- [x] Refactor hub.ts: `createHub()` factory + `import.meta.main` guard
- [x] Refactor probe.ts: extract `probe-utils.ts`, parameterize deps
- [x] Extract `useAgentSocket` hook from page.tsx
- [x] Unit tests: extractJSON, screen buffer, hub routing, commands, pipeStream
- [x] Integration test: hub → probe → dashboard pipeline
- [x] Type safety: message schemas, validation guards
- [x] Fix silent failures (frame capture, stream close, dashboard JSON)
- [x] Timer cleanup on child process exit
- [x] Dashboard hub URL from `NEXT_PUBLIC_HUB_URL`
- [x] GitHub Actions CI: lint → build → test
- [x] 80%+ test coverage on core logic
- [x] Tag v0.1.0

## v0.2.0 — Multi-Agent Reliability (DONE, tagged)
- [x] Graceful shutdown (SIGINT/SIGTERM) on hub and probe
- [x] Probe re-registration with cached VLM state
- [x] Hub idempotent register (preserves state)
- [x] Operator state protection (operatorOverride flag)
- [x] Tier2 vision→text fallback on endpoint failure
- [x] Inline ANSI→SVG renderer (replaced unmaintained package)
- [x] Rate limiting (screen interval 250ms, rAF batching, tier1 cooldown)
- [x] Multi-probe integration tests (5 scenarios)
- [x] Dashboard auto-reconnect with exponential backoff
- [x] Hub health check endpoint (`GET /health`)
- [x] 95 tests, 0 failures across 10 test files

## v0.2.1 — Project Restructuring (DONE)
- [x] Reorganized backend code into `src/` structure:
  - `src/hub/hub.ts` — WebSocket relay
  - `src/probe/probe.ts` — VLM monitoring pipeline
  - `src/probe/probe-utils.ts` — Pure functions
  - `src/probe/ansi-to-svg.ts` — ANSI→SVG renderer
  - `src/demo/demo_agent.ts` — Demo agent
- [x] Tests mirror `src/` layout: `tests/unit/hub/`, `tests/unit/probe/`, `tests/unit/app/`
- [x] Updated package.json scripts, CLAUDE.md, all imports
- [x] 101 tests, 0 failures (6 new ANSI parser tests)

## AWOC Integration — Phase 1: Visual Baseline (IN PROGRESS)
- [x] Hardened ANSI→SVG parser for TUI compatibility:
  - [x] Reverse video (SGR 7/27) — critical for TUI selection/highlighting
  - [x] Italic (SGR 3/23) — used by TUI frameworks
  - [x] Expanded escape stripping: scroll regions (`r`), window ops (`t`), single-char escapes (`ESC 7/8/D/M/E`), charset designation (`ESC(B`)
  - [x] Tests for alternate screen buffer, cursor save/restore, scroll regions
- [ ] Live validation: wrap `awoc` CLI and verify visual fidelity in dashboard
- [ ] Tune frame capture timing for pi-tui refresh rate
- **Known limitation:** Bun.spawn pipes stdout/stderr (no PTY), so full TUI cursor-positioning is linearized. The ANSI parser correctly strips these sequences and renders SGR styling. For pixel-perfect TUI rendering, the Phase 2 semantic side-channel provides deterministic state.

## v0.3.0 — Persistence & Metadata (NEXT)
- [ ] Agent metadata: task name, start time, wrapped command
- [ ] SQLite log persistence
- [ ] Post-mortem replay API
- [ ] SSIM frame deduplication at probe level
- [ ] Dashboard metadata display + log search

## AWOC Integration — Phase 2: Semantic Side-Channel
- [ ] Local UDP/IPC listener in probe for telemetry payloads
- [ ] Hub accepts structured telemetry alongside terminal streams
- [ ] Telemetry-enhanced VLM prompts (Tier 2)

## v0.4.0 — Actuation & Alerts
- [ ] Auto-pause on high-confidence DANGEROUS
- [ ] Webhook notifications on state transitions
- [ ] Slack integration
- [ ] State transition history
- [ ] Dashboard timeline visualization

## AWOC Integration — Phase 3-4: Synthesized Verification & Granular Steering
- [ ] Bundle visual frames + semantic telemetry for VLM evaluation
- [ ] Targeted AWOC commands (stoprun, steer) via dashboard
- [ ] Application-specific intervention buttons

## v0.5.0 — Beta
- [ ] Real agent end-to-end test
- [ ] Dashboard polish + keyboard shortcuts
- [ ] Documentation (troubleshooting, examples, API ref)
- [ ] Performance audit
- [ ] Installable package (`bunx argus`)
- [ ] Tagged GitHub release with changelog
