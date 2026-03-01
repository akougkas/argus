# Session: v0.2.4 — Storage Layer + Frame Persistence

## Context

**v0.2.3 tagged.** Persistence + PTY foundation complete. All code tested, lint clean, build clean.

**Versioning:** Patch-level increments (0.2.x) until 1.0. Each patch is a shippable, tested unit.

**Current state:** 146 tests, 0 failures, 14 test files.

**Git tags:** v0.1.0 → v0.2.0 → v0.2.1 → v0.2.2 → v0.2.3

## What's Done (v0.2.3)

- **PTY:** `terminal.ts` wrapping `@xterm/headless` v6.0.0, `pipeToTerminal()`, PTY mode behind `ARGUS_PTY=1`
- **SQLite:** `db.ts` using `bun:sqlite`, hub integration (`createHub(port, dbPath?)`), HTTP API (3 endpoints), preload on restart. 12 + 8 tests.
- **Metadata:** register metadata, hub AgentState extended, preserve-on-disconnect

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

Hub: `createHub(port, dbPath?)` — when `dbPath` provided, DB wired into message handlers. Hub exposes `hub.db` (DbInstance | null).

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

## v0.2.4 Scope

This patch introduces the `StorageLayer` abstraction and filesystem-backed frame persistence. Scoped tightly — no telemetry, no actuation, no AWOC integration (those are v0.2.5+).

### Design Decision: Ephemeral-First Frame Storage

Frames are hot data during monitoring, cold data after. The capture → VLM pipeline must be fast (this is a real-time video monitor). Default mode stores frames in tmpfs/ramfs for zero-latency I/O. User can opt to persist on session end or in background.

### Step 1: StorageConfig + StorageLayer interface

Replace `dbPath?: string` in `createHub()` with a `StorageConfig`:

```typescript
// src/hub/storage.ts

interface StorageConfig {
  dbPath?: string;           // SQLite path (existing behavior)
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

`createHub(port, storage?: StorageConfig)` replaces `createHub(port, dbPath?)`. Backwards compatible — if only `dbPath` is provided, behaves exactly as v0.2.3.

### Step 2: FrameStore — filesystem-backed frame storage

```typescript
interface FrameStore {
  writeFrame(agentId: string, timestamp: number, jpegBuffer: Buffer): string;  // returns path
  getFrames(agentId: string, opts?: {limit?, since?, before?}): FrameRef[];
  getFrame(path: string): Buffer | null;
  cleanup(agentId: string, olderThan: number): number;  // returns count deleted
  flush(agentId: string, destDir: string): Promise<number>;  // copy tmpfs → disk
}

interface FrameRef {
  path: string;
  agent_id: string;
  timestamp: number;
  size_bytes: number;
}
```

Storage layout: `{framePath}/{agent_id}/{timestamp}.jpg`

Frame metadata in SQLite (`frames` table). Actual JPEGs on filesystem. Separates queryable metadata from blob storage.

**Ephemeral mode:** `framePath` defaults to `/dev/shm/argus-frames` (Linux tmpfs) or `/tmp/argus-frames`. Frames auto-cleaned after `frameTTL`. On shutdown or user request, `flush()` copies to persistent disk path.

**Persist mode:** `framePath` points to a real disk directory (`data/frames/`). No auto-cleanup. Used for post-mortem replay.

### Step 3: Add frames table to db.ts

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

### Step 4: Wire into hub

Hub receives `frame_update` from probe → decodes base64 → writes JPEG to FrameStore → stores metadata in SQLite → broadcasts base64 to dashboards (live view unchanged).

### Step 5: HTTP API for frames

- `GET /api/agents/:id/frames` — paginated frame metadata (limit/offset/since)
- `GET /api/frames/:path` — serve actual JPEG file (for replay/inspection)

### Step 6: AWOC Phase 1 manual validation

Carried from v0.2.3 — no code needed, just manual testing:
- [ ] `ARGUS_PTY=1 bun run src/probe/probe.ts -- htop`
- [ ] Verify dashboard renders TUI correctly
- [ ] Verify frame capture produces readable JPEGs
- [ ] Verify VLM analysis works against TUI content

### New Env Vars

- `ARGUS_FRAME_PATH` — Frame storage root (default: `/dev/shm/argus-frames` or `/tmp/argus-frames`)
- `ARGUS_FRAME_MODE=ephemeral` — `ephemeral` (tmpfs, auto-cleanup) or `persist` (disk, keep all)
- `ARGUS_FRAME_TTL=300000` — Auto-cleanup interval in ms (ephemeral mode only)

### Implementation Order

1. Create `src/hub/storage.ts` — StorageConfig, StorageLayer, FrameStore
2. Create `tests/unit/hub/storage.test.ts` — FrameStore unit tests (~10)
3. Add `frames` table to `src/hub/db.ts` — insertFrame, getFrames, deleteFramesBefore
4. Add frame tests to `tests/unit/hub/db.test.ts`
5. Refactor `createHub(port, storage?)` — replace dbPath param
6. Update existing hub tests for new signature
7. Wire frame_update handler in hub — decode, store, broadcast
8. Add HTTP endpoints for frames
9. Create `tests/integration/frames.test.ts` — frame persistence integration (~5)
10. AWOC manual validation
11. Update `.env.example`, `CLAUDE.md`, `ROADMAP.md`
12. `git tag v0.2.4`

### Files to Create

| File | Purpose |
|------|---------|
| `src/hub/storage.ts` | StorageConfig + StorageLayer + FrameStore implementation |
| `tests/unit/hub/storage.test.ts` | FrameStore unit tests |
| `tests/integration/frames.test.ts` | Frame persistence integration tests |

### Files to Modify

| File | Changes |
|------|---------|
| `src/hub/hub.ts` | StorageConfig replaces dbPath, frame_update storage handler |
| `src/hub/db.ts` | Add frames table + methods |
| `tests/unit/hub/db.test.ts` | Add frame method tests |
| `tests/unit/hub/hub.test.ts` | Update for new createHub signature |
| `tests/integration/persistence.test.ts` | Update for new createHub signature |
| `.env.example` | New frame env vars |

### Expected: ~165+ tests

---

## Future Patches (reference only)

| Patch | Scope |
|-------|-------|
| v0.2.5 | AWOC semantic integration — telemetry listener, enhanced Tier2, dashboard sidebar |
| v0.2.6 | Actuation — auto-pause rules, webhooks |
| v0.2.7 | Granular steering + polish — AWOC commands, keyboard shortcuts, replay view |
| v0.2.8 | Beta — CLI entry point, auth, docs, README |

## Future Storage Considerations (v1.0+)

| Data Type | Now (v0.2.x) | Later (v1.0+) |
|---|---|---|
| Agent state + metadata | `bun:sqlite` | Same — small, relational |
| Logs + VLM events | `bun:sqlite` | Same, with TTL/rotation |
| Frames (JPEG) | **Filesystem** (tmpfs ephemeral / disk persistent) | Object store (S3/MinIO) |
| Video recordings | Not needed yet | Chunked writes to disk/object store |
| Embeddings + vectors | Not needed yet | `sqlite-vec`, Qdrant, or pgvector |
| Agent execution graphs | Not needed yet | Adjacency list in SQLite, or graph store |
| Time-series metrics | Not needed yet | Append-only SQLite + rollup job |

**Principle:** SQLite for metadata/queries, filesystem for blobs, specialized stores only when workload demands. `StorageLayer` is the abstraction boundary.
