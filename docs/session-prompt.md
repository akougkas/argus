# Session: v0.4.0 — Storage Layer + Frames + Semantic Integration

## Context

**v0.3.0 tagged.** Persistence + PTY foundation complete. All code tested, lint clean, build clean.

**Current state:** 146 tests, 0 failures, 14 test files.

**Git log (most recent):**
```
<v0.3.0 tag> v0.3.0: SQLite persistence + HTTP API (Track B)
4779802 v0.3.0 WIP: PTY foundation (Track A complete)
6291d93 v0.2.2: Pre-persistence hub hardening  ← tagged v0.2.2
```

## What's Done (v0.3.0)

- **Track A (PTY):** `terminal.ts` wrapping `@xterm/headless` v6.0.0, `pipeToTerminal()`, PTY mode behind `ARGUS_PTY=1`
- **Track B (SQLite):** `db.ts` using `bun:sqlite`, hub integration (`createHub(port, dbPath?)`), HTTP API (3 endpoints), preload on restart. 12 + 8 tests.
- **Track C (Metadata):** register metadata, hub AgentState extended, preserve-on-disconnect
- **Track D (AWOC validation):** manual only, not automated yet

### Current Persistence Architecture

```typescript
// src/hub/db.ts — DbInstance interface
insertAgent(id, state, confidence, reasoning, task, command, startTime, lastSeen): void
updateAgentState(id, state, confidence, reasoning, lastSeen): void
insertLog(agentId, text, type, timestamp): void
insertVlmEvent(agentId, state, confidence, reasoning, timestamp): void
getAllAgents(): Array<{...}>
getAgentHistory(agentId, {limit, offset, since}): Array<{...}>
getAgentLogs(agentId, {limit, offset, since, type}): Array<{...}>
close(): void
```

Hub calls `createHub(port, dbPath?)` — when `dbPath` is provided, DB is created and wired into message handlers. Hub exposes `hub.db` (DbInstance | null).

### Current Frame Pipeline (probe.ts)

```
ANSI terminal → ansiToSvg() → sharp(SVG→JPEG) → base64 → frame_update WS → dashboard
                                                    ↓
                                              frameBuffer[] (in-memory, last 4 frames)
                                                    ↓
                                              Tier2 VLM: 2x2 temporal grid
```

Frames are ephemeral — live in memory, streamed to dashboard, used by VLM, then discarded. No persistence. Frame capture interval: `ARGUS_FRAME_INTERVAL` (default 2000ms).

---

## v0.4.0 Roadmap

This version has three major tracks. **Order matters:** Storage Layer first (frames depend on it), then AWOC integration, then actuation.

### Track E: Storage Layer Abstraction + Frame Persistence

**Architecture decision (confirmed):** Polyglot persistence. Different data types go to different backends. No single database handles all of Argus's future needs (text logs, JPEG frames, video recordings, embeddings, execution graphs).

**Key insight: Ephemeral-first frame storage.** Frames are hot data during monitoring, cold data after. Default mode is tmpfs/ramfs for zero-latency capture → VLM pipeline. User can opt to persist on session end or in background.

#### Step 1: StorageConfig + StorageLayer interface

Replace `dbPath?: string` in `createHub()` with a `StorageConfig`:

```typescript
interface StorageConfig {
  dbPath?: string;           // SQLite path (existing)
  framePath?: string;        // Frame storage root — tmpfs for ephemeral, disk for persistent
  frameMode?: "ephemeral" | "persist";  // Default: ephemeral
  frameTTL?: number;         // Auto-cleanup after N ms (default: 300000 = 5min)
}

interface StorageLayer {
  db: DbInstance | null;
  frames: FrameStore | null;
  close(): void;
}
```

`createHub(port, storage?: StorageConfig)` replaces `createHub(port, dbPath?)`. Backwards compatible — if only `dbPath` is provided, behaves exactly as v0.3.0.

#### Step 2: FrameStore — filesystem-backed frame storage

```typescript
interface FrameStore {
  writeFrame(agentId: string, timestamp: number, jpegBuffer: Buffer): string;  // returns path
  getFrames(agentId: string, opts?: {limit?, since?, before?}): FrameRef[];
  getFrame(path: string): Buffer | null;
  cleanup(agentId: string, olderThan: number): number;  // returns count deleted
  flush(agentId: string, destDir: string): Promise<number>;  // dump to persistent storage
}

interface FrameRef {
  path: string;
  agent_id: string;
  timestamp: number;
  size_bytes: number;
}
```

Storage layout: `{framePath}/{agent_id}/{timestamp}.jpg`

Frame metadata goes in SQLite (`frames` table: agent_id, timestamp, path, size_bytes). The actual JPEG stays on filesystem. This separates queryable metadata from blob storage.

**Ephemeral mode:** `framePath` points to `/dev/shm/argus-frames` (Linux tmpfs) or `/tmp/argus-frames`. Frames auto-cleaned after `frameTTL`. On shutdown or user request, `flush()` copies to persistent disk path.

**Persist mode:** `framePath` points to a real disk directory (`data/frames/`). No auto-cleanup. Used for post-mortem replay.

#### Step 3: Wire into probe → hub pipeline

Currently frames flow: probe captures → base64 → WS `frame_update` → dashboard only.

New flow: probe captures → base64 → WS `frame_update` → hub stores frame + broadcasts to dashboard.

Hub receives `frame_update`, decodes base64, writes to FrameStore, stores metadata in SQLite. Dashboard still gets the base64 stream for live view. HTTP API gains `GET /api/agents/:id/frames` for historical access.

#### Step 4: Add frames table to db.ts

```sql
CREATE TABLE IF NOT EXISTS frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  timestamp INTEGER,
  path TEXT,
  size_bytes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_frames_agent_ts ON frames(agent_id, timestamp);
```

Extend DbInstance: `insertFrame()`, `getFrames()`, `deleteFramesBefore()`.

#### New Env Vars
- `ARGUS_FRAME_PATH` — Frame storage root (default: `/dev/shm/argus-frames` or `/tmp/argus-frames`)
- `ARGUS_FRAME_MODE=ephemeral` — `ephemeral` (tmpfs, auto-cleanup) or `persist` (disk, keep all)
- `ARGUS_FRAME_TTL=300000` — Auto-cleanup interval in ms (ephemeral mode only)

### Track F: AWOC Semantic Integration (Phase 2–3)

**What AWOC is:** AWOC is an autonomous AI coding agent (like SWE-agent) that Argus monitors. Argus wraps AWOC's terminal via PTY and watches it visually. AWOC phases in the roadmap refer to deeper integration levels:

- **Phase 1 (v0.3.0, done):** Visual-only monitoring via PTY. Argus sees what AWOC shows in the terminal.
- **Phase 2 (v0.4.0):** Semantic side-channel. AWOC (or its extension) emits structured telemetry alongside terminal output. Argus ingests both visual and structured data for richer analysis.
- **Phase 3 (v0.4.0):** Synthesized verification. Tier2 VLM gets both frame grids AND telemetry JSON, enabling it to cross-reference what AWOC says it's doing vs. what's visible on screen.
- **Phase 4 (v0.5.0):** Granular steering. Dashboard can inject AWOC-specific commands (`/stoprun`, `/steer`) based on run IDs from telemetry.

#### Step 5: Telemetry listener

`src/probe/telemetry-listener.ts` — UDP socket on configurable port. Receives structured JSON from AWOC extension:

```typescript
interface TelemetryEvent {
  type: "tool_start" | "tool_end" | "context_update" | "run_start" | "run_end";
  run_id?: string;
  tool?: string;
  context_usage?: number;
  timestamp: number;
  payload?: Record<string, unknown>;
}
```

Probe forwards telemetry to hub as `telemetry_update` messages. Hub stores in new `telemetry` table (or extends `vlm_events`).

#### Step 6: Enhanced Tier2 prompt

Current Tier2: sends 2x2 frame grid + asks for state classification.

Enhanced Tier2: sends frames + latest telemetry snapshot. Prompt becomes: "Here are 4 recent screenshots. The agent's telemetry reports: [tool=X, run_id=Y, context_usage=Z%]. Based on both visual and telemetry data, classify the agent state..."

This cross-referencing detects hallucination: if telemetry says "editing file.py" but the screen shows `rm -rf`, that's a DANGEROUS state with high confidence.

#### Step 7: Dashboard telemetry sidebar

Dashboard sidebar gains: active tool, current run ID, context usage meter. These come from `telemetry_update` messages. Read-only for now — steering in v0.5.0.

### Track G: Actuation

#### Step 8: Auto-pause

Configurable rules engine:
- Confidence threshold: auto-pause if confidence drops below X for N consecutive checks
- State match: auto-pause if state is DANGEROUS (always) or STUCK (configurable)
- N-confirmation gate: require N consecutive identical classifications before acting (prevents flapping)

Config via env vars: `ARGUS_AUTO_PAUSE=1`, `ARGUS_CONFIDENCE_THRESHOLD=30`, `ARGUS_CONFIRM_COUNT=3`.

#### Step 9: Webhooks

`src/hub/webhooks.ts` — HTTP POST on state transitions. Slack-compatible payload format. Configurable URL via `ARGUS_WEBHOOK_URL`. Fires on: state change, auto-pause triggered, agent disconnect.

#### Step 10: State transition timeline

Dashboard gains a timeline component showing state transitions over time. Data source: `GET /api/agents/:id/history` (already exists from v0.3.0). Visualization: horizontal bar with colored segments (green=PROGRESSING, yellow=STUCK, red=DANGEROUS, etc.).

### Track D: AWOC Phase 1 Validation (carried from v0.3.0)

Manual validation — no code needed:
- [ ] `ARGUS_PTY=1 bun run src/probe/probe.ts -- htop` (or `vim`, `awoc`)
- [ ] Verify dashboard renders TUI correctly
- [ ] Verify frame capture produces readable JPEGs
- [ ] Verify VLM analysis works against TUI content

### Implementation Order

1. **StorageConfig + StorageLayer** interface (Step 1) — refactor createHub signature
2. **FrameStore** implementation (Step 2) — filesystem + tmpfs support
3. **frames table** in db.ts (Step 4) — extend DbInstance
4. **Wire frame persistence** into hub (Step 3) — hub stores on frame_update
5. **HTTP API** for frames — `GET /api/agents/:id/frames`
6. **Telemetry listener** (Step 5) — UDP socket in probe
7. **Enhanced Tier2** (Step 6) — cross-reference frames + telemetry
8. **Dashboard telemetry** sidebar (Step 7)
9. **Auto-pause** (Step 8) — rules engine
10. **Webhooks** (Step 9)
11. **Timeline visualization** (Step 10)
12. **AWOC manual validation** (Track D)
13. Update docs, tests, tag v0.4.0

### Expected: ~175+ tests

---

## Future Storage Considerations (v1.0+)

Decisions made during v0.3.0 development — captured for future reference:

| Data Type | Now (v0.3–0.5) | Later (v1.0+) |
|---|---|---|
| Agent state + metadata | `bun:sqlite` | Same — small, relational |
| Logs + VLM events | `bun:sqlite` | Same, with TTL/rotation |
| Frames (JPEG) | **Filesystem** (tmpfs ephemeral / disk persistent) | Object store (S3/MinIO) |
| Video recordings | Not needed yet | Chunked writes to disk/object store |
| Embeddings + vectors | Not needed yet | `sqlite-vec`, Qdrant, or pgvector |
| Agent execution graphs | Not needed yet | Adjacency list in SQLite, or graph store |
| Time-series metrics | Not needed yet | Append-only SQLite + rollup job |

**Principle:** SQLite for metadata/queries, filesystem for blobs, specialized stores only when workload demands them. The `StorageLayer` interface is the boundary — backends swap without rewriting hub logic.

**Evaluated and rejected:** stoolap (Rust SQL DB, v0.3.3, 1 contributor, 307 npm downloads total, 2.5 months old, suspected vibecoded, no production users). SQLite wins on every dimension that matters for Argus.

## Key Files

| File | Status |
|------|--------|
| `src/hub/db.ts` | v0.3.0 — SQLite persistence layer |
| `src/hub/hub.ts` | v0.3.0 — DB integration + HTTP API |
| `src/probe/probe.ts` | v0.3.0 — PTY mode + VLM pipeline |
| `src/probe/terminal.ts` | v0.3.0 — xterm wrapper |
| `src/probe/ansi-to-svg.ts` | v0.2.0 — inline ANSI→SVG |
| `src/app/page.tsx` | v0.2.0 — dashboard (CRT aesthetic, don't change design) |
| `tests/helpers.ts` | Shared test utilities |

### Files to Create (v0.4.0)

| File | Purpose |
|------|---------|
| `src/hub/storage.ts` | StorageConfig + StorageLayer + FrameStore |
| `src/probe/telemetry-listener.ts` | UDP telemetry socket |
| `src/hub/webhooks.ts` | HTTP POST on state transitions |
| `tests/unit/hub/storage.test.ts` | FrameStore unit tests |
| `tests/unit/probe/telemetry.test.ts` | Telemetry listener tests |
| `tests/integration/frames.test.ts` | Frame persistence integration |

### Files to Modify (v0.4.0)

| File | Changes |
|------|---------|
| `src/hub/hub.ts` | StorageConfig replaces dbPath, frame_update handler, telemetry routing |
| `src/hub/db.ts` | Add frames table + methods |
| `src/probe/probe.ts` | Telemetry listener integration, enhanced Tier2 prompt |
| `src/app/page.tsx` | Timeline component, telemetry sidebar (minimal — respect CRT aesthetic) |
| `src/app/useAgentSocket.ts` | Handle telemetry_update messages |
