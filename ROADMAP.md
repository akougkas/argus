# Project Argus: Roadmap

Solo dev. No users until beta. Each version is tested, verified, and tagged before moving on.
AWOC integration phases are folded into version milestones — Argus remains a standalone product.
Increment by patch (0.2.x) until 1.0. Each patch is a shippable, tested unit of work.

## Version Map

| Version | Milestone | AWOC Phase | Status |
|---------|-----------|------------|--------|
| v0.1.0 | Testable Foundation | — | Done, tagged |
| v0.2.0 | Multi-Agent Reliability | — | Done, tagged |
| v0.2.1 | Project Restructuring + ANSI Hardening | Phase 1 (parser) | Done, tagged |
| v0.2.2 | Pre-Persistence Hub Hardening | — | Done, tagged |
| **v0.2.3** | **Persistence + PTY Foundation** | **Phase 1 (validation)** | **Done, tagged** |
| **v0.2.4** | **Storage Layer + Frame Persistence** | **—** | **Done, tagged** |
| **v0.2.5** | **Telemetry Receiver + AWOC Integration Foundation** | **Phase 2** | **Done, tagged** |
| **v0.2.6** | **Actuation & Targeted Steering** | **Phase 3** | **Done, tagged** |
| **v0.2.7** | **Steering UX + Dashboard Controls** | **Phase 4** | **Done, tagged** |
| v0.2.8 | Beta: Monitors AWOC in Production | Phase 4 | Planned |

---

## v0.1.0 — Testable Foundation (Done)

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

## v0.2.0 — Multi-Agent Reliability (Done)

- [x] Graceful shutdown (SIGINT/SIGTERM) on hub and probe
- [x] Probe re-registration with cached VLM state
- [x] Hub idempotent register (preserves state)
- [x] Operator state protection (operatorOverride flag)
- [x] Tier2 vision→text fallback on endpoint failure
- [x] Inline ANSI→SVG renderer (replaced unmaintained ansi-to-svg package)
- [x] Rate limiting (screen interval 250ms, rAF batching, tier1 cooldown)
- [x] Multi-probe integration tests (5 scenarios)
- [x] Dashboard auto-reconnect with exponential backoff
- [x] Hub health check endpoint (`GET /health`)
- [x] 95 tests, 0 failures across 10 test files

## v0.2.1 — Project Restructuring + ANSI Hardening (Done)

- [x] Reorganized backend into `src/` structure (hub/, probe/, demo/)
- [x] Tests mirror `src/` layout: `tests/unit/{hub,probe,app}/`
- [x] Hardened ANSI→SVG parser for TUI compatibility:
  - Reverse video (SGR 7/27), italic (SGR 3/23)
  - Expanded escape stripping: scroll regions, window ops, single-char escapes, charset designation
  - Tests for alternate screen buffer, cursor save/restore, scroll regions
- [x] 101 tests, 0 failures (6 new ANSI parser tests)

## v0.2.2 — Pre-Persistence Hub Hardening (Done)

- [x] `register` message gains optional `metadata: { task, command, start_time }`
- [x] Probe reads `ARGUS_AGENT_TASK`, auto-populates command from SPAWN_CMD
- [x] Hub: `AgentState` gains `task`, `command`, `startTime`, `lastSeen`, `connected` fields
- [x] Hub preserves agents on disconnect (`connected: false`)
- [x] Hub `init` sends only connected agents; health counts only connected agents
- [x] Dashboard: `applyMessage()` populates task from init data
- [x] 126 tests, 0 failures

---

## v0.2.3 — Persistence + PTY Foundation (Done)

Two independent tracks (PTY, SQLite) converging with agent metadata.

**Key breakthrough:** `script -qefc "cmd" /dev/null` allocates a real PTY via Bun.spawn (zero native addons). Combined with `@xterm/headless` v6.0.0 (zero deps, works under Bun), this gives proper 2D terminal grid capture for TUI apps — solving the pipe-vs-PTY limitation without node-pty.

### Track A: PTY Integration (`script` + `@xterm/headless`)

New dep: `@xterm/headless` v6.0.0 (zero deps, production)

- [x] `src/probe/terminal.ts` — wraps `@xterm/headless` Terminal
  - `createTerminal(cols, rows)` → `TerminalWrapper`
  - `write(data)` — feed raw PTY bytes
  - `getGrid()` → `{ text, ansi }` — plain text + reconstructed SGR codes
  - SGR reconstruction: walk cells, track style changes, emit codes on transitions
  - Pure module, no WebSocket/process concerns
- [x] `pipeToTerminal()` in `src/probe/probe-utils.ts` — reads chunks, feeds terminal, extracts log lines
- [x] PTY mode in `src/probe/probe.ts` (behind `ARGUS_PTY=1`)
  - Wraps command in `script -qefc "stty rows R cols C; exec CMD" /dev/null`
  - Sets `TERM=xterm-256color` in spawn env
  - Screen broadcast from `terminal.getGrid().text`
  - Frame capture from `terminal.getGrid().ansi` → `ansiToSvg()`
  - Pipe mode (default `ARGUS_PTY=0`) unchanged
- [x] `tests/unit/probe/terminal.test.ts` (~10 tests): grid text, cursor, SGR, alternate screen, resize
- [x] `tests/integration/pty-pipeline.test.ts` (~3 tests): spawn via script, verify grid

### Track B: SQLite Persistence

Uses `bun:sqlite` (built-in, no dependency).

- [x] `src/hub/db.ts`
  - `createDb(path?)` → `DbInstance`
  - Schema: `agents`, `logs`, `vlm_events` (indexed on `(agent_id, timestamp)`)
  - `:memory:` for tests, file path for production (`ARGUS_DB_PATH`)
  - No frames table (deferred to v0.2.4)
- [x] Hub integration: `createHub(port, dbPath?)`
  - On register: upsert agent
  - On vlm_update: insert event + update state
  - On log_update: insert log
  - On startup: preload agents from DB (survives restarts)
- [x] HTTP API in hub `fetch()`:
  - `GET /api/agents` — all agents (including disconnected)
  - `GET /api/agents/:id/history` — paginated timeline
  - `GET /api/agents/:id/logs` — paginated logs with `?type=` filter
  - Query params: `limit=100`, `offset=0`, `since=<timestamp>`
- [x] `tests/unit/hub/db.test.ts` (12 tests): CRUD, pagination, upsert, ordering
- [x] Extended integration tests for persistence through restart + HTTP API (8 tests)

### Result: 146 tests, 0 failures

---

## v0.2.4 — Storage Layer + Frame Persistence (Done)

Polyglot persistence: SQLite for metadata, filesystem for JPEG blobs.
Ephemeral-first: frames default to tmpfs, flush to disk on demand.
Security hardening from Gemini Pro review integrated.

- [x] `StorageConfig` + `StorageLayer` interface replaces `dbPath?` in `createHub()`
- [x] `FrameStore` — filesystem-backed JPEG storage (tmpfs ephemeral / disk persistent)
- [x] `frames` table in `db.ts` — metadata only (path, agent_id, timestamp, size_bytes)
- [x] Hub stores frames on `frame_update`, broadcasts to dashboard
- [x] HTTP API: `GET /api/agents/:id/frames` + `GET /api/frames/:path`
- [x] TTL-based auto-cleanup in ephemeral mode
- [x] `flush()` to copy frames from tmpfs to persistent disk
- [x] Security hardening: path traversal fix, 5MB frame size limit, try/catch on all storage ops, hub-authoritative timestamps, async frame writes, reconnect jitter, timer guard, raw relay optimization, cleanup partial failure resilience
- [x] 12 hardening tests (path traversal, oversized frame, storage error resilience, cleanup)

New env vars: `ARGUS_FRAME_PATH`, `ARGUS_FRAME_MODE`, `ARGUS_FRAME_TTL`

### Result: 187 tests, 0 failures across 17 files

## v0.2.5 — Telemetry Receiver + AWOC Integration Foundation (Done)

**AWOC Phase 2: Semantic side-channel receiver**

- [x] `src/probe/telemetry-listener.ts` — UDP receiver with schema validation (5 event types)
- [x] Probe integration: optional telemetry listener via `ARGUS_TELEMETRY_PORT`, forwards to hub
- [x] Hub: `telemetry_events` table, `telemetry_update` message routing, HTTP API (`GET /api/agents/:id/telemetry`)
- [x] Tier2 VLM prompt enriched with telemetry context (tool, args, context %, run ID)
- [x] Dashboard frame pipeline CI tests (7 tests, tech debt from v0.2.4)
- [x] `useAgentSocket` refactored: 8 pure functions extracted, 40% → 61% line coverage

New env var: `ARGUS_TELEMETRY_PORT`

### Result: 286 tests, 0 failures across 18 files

## v0.2.6 — Actuation & Targeted Steering (Done)

**AWOC Phase 3: Steering commands + integration tests**

- [x] `src/probe/steering.ts` — `buildSteeringCommand()` translates stoprun/steer to AWOC stdin strings
- [x] Extended `handleCommand()` in probe-utils.ts: `stoprun` and `steer` actions
- [x] Telemetry integration test — probe WS → hub → SQLite → HTTP API (5 tests)
- [x] Steering integration test — dashboard → hub → probe routing (5 tests)
- [x] Steering unit tests (9 tests) + handle-command tests (5 new tests)

### Result: 310 tests, 0 failures across 21 files

## v0.2.7 — Steering UX + Dashboard Controls (Done)

**AWOC Phase 4**

- [x] `AgentTelemetry` interface + `telemetry_update` handler in `applyMessage`
- [x] Dashboard sidebar: telemetry panel (run ID, active tool, context % bar)
- [x] Steering buttons: "Halt Run" (sends `stoprun` with run ID) + "Steer Agent" (text input)
- [x] Agent card CTX % badge with color thresholds (green/yellow/red)
- [x] Graceful degradation: steering controls only visible when telemetry active
- [ ] `src/app/useKeyboardShortcuts.ts` — keyboard shortcuts (deferred to v0.2.8)
- [ ] Post-mortem replay view with timeline scrubber (deferred to v0.2.8)

### Result: 329 tests, 0 failures across 21 files

## v0.2.8 — Beta (Planned)

- [ ] `src/cli.ts` entry point → `bunx argus -- <cmd>`
- [ ] Auth basics: bearer token on hub WS + HTTP
- [ ] `src/app/useKeyboardShortcuts.ts` — keyboard shortcuts
- [ ] Post-mortem replay view with timeline scrubber
- [ ] Documentation: getting-started, configuration, API reference, AWOC guide
- [ ] README rewrite with badges, screenshots
- [ ] End-to-end: 5 simultaneous AWOC probes under Argus

---

## Technical Debt (Tracked)

| Item | Introduced | Target |
|------|-----------|--------|
| No authentication on hub endpoints | v0.1.0 | v0.2.8 |
| ~~No frame persistence / visual replay~~ | ~~v0.2.0~~ | ~~v0.2.4~~ Done |
| ~~Dashboard frame pipeline untested in CI~~ | ~~v0.1.0~~ | ~~v0.2.5~~ Done |
| ~~useAgentSocket low line coverage (40%)~~ | ~~v0.2.0~~ | ~~v0.2.5~~ Done (61%) |
| ~~End-to-end telemetry integration test~~ | ~~v0.2.5~~ | ~~v0.2.6~~ Done |
