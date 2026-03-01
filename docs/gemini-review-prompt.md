# Argus v0.2.x Deep Review — For Gemini Pro

You are reviewing **Argus**, a real-time visual verification and steering layer for autonomous AI agents — "Datadog for Autonomous Agents." A probe monitors agent terminal output via PTY + VLM, detects failures (stuck loops, destructive intent, hallucinations), and streams state to a dashboard with manual override controls.

**Context:** Solo dev project, v0.2.4 just completed (StorageLayer + frame persistence). 175 tests, 0 failures. Bun runtime, Next.js dashboard, SQLite + filesystem persistence.

**Your job:** Deep technical review across v0.2.0–v0.2.4. Not code style — find **real bugs, security holes, race conditions, architectural weaknesses, missing edge cases, performance problems, and test gaps** that will bite before beta (v0.2.8). Be harsh. Every issue should be actionable with a concrete fix recommendation.

---

## Architecture

```
                    ┌─── Pipe mode (default) ───┐
[any command] ──────┤                           ├──▶ probe.ts ──WS──▶ hub.ts ──WS──▶ page.tsx
                    └─── PTY mode (ARGUS_PTY=1) ┘       │            ▲  │               │
                         script -qefc + xterm/headless   │            │  │         pause/kill/inject
                                                      VLM tiers       │  └─ HTTP API ──▶ /api/*
                                                     (Tier 1+2)       │
                                                         │            │
                                                   [StorageLayer]─────┘
                                                    ├─ SQLite (agents, logs, events, frame refs)
                                                    └─ Filesystem (JPEG frames: tmpfs or disk)
```

**WebSocket Protocol:**
- Probe → Hub: `register`, `terminal_screen_update`, `log_update`, `vlm_update`, `frame_update`
- Hub → Dashboard: `init`, `update`, `agent_disconnected`, plus forwarded probe messages
- Dashboard → Hub → Probe: `command` (`pause`/`resume`/`kill`/`inject`)

**Agent States:** PROGRESSING, STUCK, DANGEROUS, HALLUCINATING, PAUSED, EXITED

---

## Source Files (complete)

### src/hub/hub.ts (269 lines) — WebSocket relay + HTTP API

```typescript
import type { Server, ServerWebSocket } from "bun";
import { createStorage, type StorageConfig, type StorageLayer, type FrameStore } from "./storage";
import type { DbInstance } from "./db";

export interface WsData {
  type: "probe" | "dashboard";
  agentId?: string;
}

export interface AgentState {
  state: string;
  confidence: number;
  reasoning: string;
  logs: Array<{ text: string; type: string }>;
  task: string;
  command: string;
  startTime: number;
  lastSeen: number;
  connected: boolean;
}

export interface HubInstance {
  server: Server<WsData>;
  agents: Map<string, AgentState>;
  probes: Map<string, ServerWebSocket<WsData>>;
  dashboards: Set<ServerWebSocket<WsData>>;
  db: DbInstance | null;
  frames: FrameStore | null;
  storage: StorageLayer;
  stop(): void;
}

export function createHub(port: number, config?: StorageConfig | string): HubInstance {
  const agents = new Map<string, AgentState>();
  const probes = new Map<string, ServerWebSocket<WsData>>();
  const dashboards = new Set<ServerWebSocket<WsData>>();
  const startTime = Date.now();

  const storageConfig: StorageConfig = typeof config === "string"
    ? { dbPath: config }
    : config ?? {};
  const storage = createStorage(storageConfig);
  const { db, frames } = storage;

  if (db) {
    for (const row of db.getAllAgents()) {
      agents.set(row.id, {
        state: row.state, confidence: row.confidence, reasoning: row.reasoning,
        logs: [], task: row.task, command: row.command,
        startTime: row.start_time, lastSeen: row.last_seen, connected: false,
      });
    }
    if (agents.size > 0) console.log(`[hub] Preloaded ${agents.size} agent(s) from DB`);
  }

  function broadcast(msg: string) { for (const d of dashboards) d.send(msg); }
  function broadcastJSON(payload: object) { broadcast(JSON.stringify(payload)); }
  function connectedAgents(): Map<string, AgentState> {
    const result = new Map<string, AgentState>();
    for (const [id, a] of agents) { if (a.connected) result.set(id, a); }
    return result;
  }

  function handleProbeMessage(ws: ServerWebSocket<WsData>, msg: Record<string, unknown>) {
    if (msg.type === "register") {
      const id = msg.agent_id as string | undefined;
      if (!id) return;
      ws.data.agentId = id;
      probes.set(id, ws);
      const now = Date.now();
      const metadata = msg.metadata as Record<string, unknown> | undefined;
      const existing = agents.get(id);
      if (existing) {
        existing.connected = true; existing.lastSeen = now;
        if (metadata?.task) existing.task = metadata.task as string;
        if (metadata?.command) existing.command = metadata.command as string;
        if (metadata?.start_time) existing.startTime = metadata.start_time as number;
      } else {
        agents.set(id, {
          state: "PROGRESSING", confidence: 100, reasoning: "", logs: [],
          task: (metadata?.task as string) || "", command: (metadata?.command as string) || "",
          startTime: (metadata?.start_time as number) || now, lastSeen: now, connected: true,
        });
      }
      const a = agents.get(id)!;
      db?.insertAgent(id, a.state, a.confidence, a.reasoning, a.task, a.command, a.startTime, a.lastSeen);
      console.log(`[hub] Probe registered: ${id}`);
      broadcastJSON({ type: "init", data: Object.fromEntries(connectedAgents()) });
      return;
    }

    const agentId = ws.data.agentId;
    if (!agentId) { console.warn("[hub] Probe sent data before registering"); return; }
    const agentState = agents.get(agentId);
    if (!agentState) return;
    agentState.lastSeen = Date.now();

    if (msg.type === "vlm_update") {
      const data = msg.data as Record<string, unknown> | undefined;
      agentState.state = (data?.agent_state as string) || "PROGRESSING";
      agentState.confidence = (data?.confidence_score as number) ?? agentState.confidence;
      agentState.reasoning = (data?.reasoning as string) || "";
      const now = Date.now();
      db?.insertVlmEvent(agentId, agentState.state, agentState.confidence, agentState.reasoning, now);
      db?.updateAgentState(agentId, agentState.state, agentState.confidence, agentState.reasoning, now);
      broadcastJSON({ type: "update", agent_id: agentId, data: msg.data });
      return;
    }

    if (msg.type === "frame_update" && frames) {
      const base64 = msg.frame as string | undefined;
      if (!base64) { broadcast(JSON.stringify(msg)); return; }
      const jpegBuffer = Buffer.from(base64, "base64");
      const timestamp = (msg.timestamp as number) || Date.now();
      frames.writeFrame(agentId, timestamp, jpegBuffer);
      broadcast(JSON.stringify(msg));
      return;
    }

    if (msg.type === "log_update") {
      const log = msg.log as { text: string; type: string };
      agentState.logs.push(log);
      if (agentState.logs.length > 50) agentState.logs.shift();
      db?.insertLog(agentId, log.text, log.type, Date.now());
    }

    broadcast(JSON.stringify(msg));
  }

  // ... dashboard command routing, HTTP API (agents, history, logs, frames endpoints), WebSocket handlers
  // Full HTTP API: /health, /api/agents, /api/agents/:id/history, /api/agents/:id/logs,
  //               /api/agents/:id/frames, /api/frames/:path (serves JPEG)
}
```

### src/hub/storage.ts (203 lines) — StorageLayer + FrameStore

```typescript
import { mkdirSync, existsSync, readdirSync, unlinkSync, readFileSync, writeFileSync, copyFileSync, statSync } from "fs";
import { join, basename } from "path";
import { createDb, type DbInstance } from "./db";

export interface StorageConfig {
  dbPath?: string;
  framePath?: string;
  frameMode?: "ephemeral" | "persist";
  frameTTL?: number; // ms, default 300000 (5min), ephemeral only
}

export interface FrameRef {
  path: string; agent_id: string; timestamp: number; size_bytes: number;
}

export interface FrameStore {
  writeFrame(agentId: string, timestamp: number, jpegBuffer: Buffer): string;
  getFrames(agentId: string, opts?: { limit?: number; since?: number; before?: number }): FrameRef[];
  getFrame(path: string): Buffer | null;
  cleanup(agentId: string, olderThan: number): number;
  flush(agentId: string, destDir: string): number;
  readonly rootPath: string;
}

export interface StorageLayer {
  db: DbInstance | null;
  frames: FrameStore | null;
  close(): void;
}

export function createFrameStore(rootPath: string, db: DbInstance | null): FrameStore {
  mkdirSync(rootPath, { recursive: true });

  function agentDir(agentId: string): string {
    const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(rootPath, safe);
  }

  return {
    rootPath,
    writeFrame(agentId, timestamp, jpegBuffer) {
      const dir = agentDir(agentId);
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `${timestamp}.jpg`);
      writeFileSync(filePath, jpegBuffer);
      db?.insertFrame(agentId, timestamp, filePath, jpegBuffer.length);
      return filePath;
    },
    getFrames(agentId, opts = {}) {
      if (db) return db.getFrames(agentId, opts);
      // Filesystem fallback: scan directory, parse timestamps from filenames
      const dir = agentDir(agentId);
      if (!existsSync(dir)) return [];
      const { limit = 100, since, before } = opts;
      let entries = readdirSync(dir).filter(f => f.endsWith(".jpg"))
        .map(f => {
          const ts = parseInt(basename(f, ".jpg"), 10);
          const filePath = join(dir, f);
          const stat = statSync(filePath);
          return { path: filePath, agent_id: agentId, timestamp: ts, size_bytes: stat.size };
        }).filter(e => !isNaN(e.timestamp));
      if (since !== undefined) entries = entries.filter(e => e.timestamp >= since);
      if (before !== undefined) entries = entries.filter(e => e.timestamp < before);
      entries.sort((a, b) => b.timestamp - a.timestamp);
      return entries.slice(0, limit);
    },
    getFrame(path) {
      if (!path.startsWith(rootPath)) return null;  // Security: path must be under rootPath
      if (!existsSync(path)) return null;
      return readFileSync(path) as Buffer;
    },
    cleanup(agentId, olderThan) {
      const dir = agentDir(agentId);
      if (!existsSync(dir)) return 0;
      let count = 0;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".jpg")) continue;
        const ts = parseInt(basename(f, ".jpg"), 10);
        if (isNaN(ts) || ts >= olderThan) continue;
        unlinkSync(join(dir, f));
        count++;
      }
      db?.deleteFramesBefore(agentId, olderThan);
      return count;
    },
    flush(agentId, destDir) {
      const srcDir = agentDir(agentId);
      if (!existsSync(srcDir)) return 0;
      mkdirSync(destDir, { recursive: true });
      let count = 0;
      for (const f of readdirSync(srcDir)) {
        if (!f.endsWith(".jpg")) continue;
        copyFileSync(join(srcDir, f), join(destDir, f));
        count++;
      }
      return count;
    },
  };
}

export function createStorage(config: StorageConfig = {}): StorageLayer {
  const db = config.dbPath !== undefined ? createDb(config.dbPath) : null;
  let frames: FrameStore | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  if (config.framePath !== undefined || config.frameMode !== undefined) {
    const framePath = config.framePath || defaultFramePath();
    frames = createFrameStore(framePath, db);

    if (config.frameMode !== "persist") {
      const ttl = config.frameTTL ?? 300_000;
      cleanupTimer = setInterval(() => {
        const cutoff = Date.now() - ttl;
        const rootPath = frames!.rootPath;
        if (!existsSync(rootPath)) return;
        for (const dir of readdirSync(rootPath)) {
          const dirPath = join(rootPath, dir);
          try {
            const stat = statSync(dirPath);
            if (stat.isDirectory()) frames!.cleanup(dir, cutoff);
          } catch { /* directory removed between readdir and stat */ }
        }
      }, Math.min(ttl, 60_000));
      if (cleanupTimer.unref) cleanupTimer.unref();
    }
  }

  return { db, frames, close() { if (cleanupTimer) clearInterval(cleanupTimer); db?.close(); } };
}
```

### src/hub/db.ts (263 lines) — SQLite persistence

```typescript
import { Database } from "bun:sqlite";

export interface DbInstance {
  insertAgent(id, state, confidence, reasoning, task, command, startTime, lastSeen): void;
  updateAgentState(id, state, confidence, reasoning, lastSeen): void;
  insertLog(agentId, text, type, timestamp): void;
  insertVlmEvent(agentId, state, confidence, reasoning, timestamp): void;
  getAllAgents(): Array<{id, state, confidence, reasoning, task, command, start_time, last_seen}>;
  getAgentHistory(agentId, opts?: {limit?, offset?, since?}): Array<{...}>;
  getAgentLogs(agentId, opts?: {limit?, offset?, since?, type?}): Array<{...}>;
  insertFrame(agentId, timestamp, path, sizeBytes): void;
  getFrames(agentId, opts?: {limit?, since?, before?}): Array<{path, agent_id, timestamp, size_bytes}>;
  deleteFramesBefore(agentId, olderThan): number;
  close(): void;
}

// Schema: agents, logs, vlm_events, frames tables. WAL mode. Prepared statements.
// getAgentLogs builds dynamic WHERE with parameterized queries.
// getFrames builds dynamic WHERE with parameterized queries.
```

### src/probe/probe.ts (493 lines) — VLM monitoring pipeline

```typescript
// Full file included above in the Architecture section.
// Key concerns:
// - Two VLM tiers: Tier1 (text, 1s interval, 5s timeout) → Tier2 (vision, 45s timeout)
// - PTY mode via `script -qefc` + @xterm/headless
// - State machine: operatorOverride blocks VLM overriding PAUSED
// - Frame capture: ANSI→SVG→JPEG→base64, pushed to hub
// - WebSocket reconnect with exponential backoff
// - Global mutable state (13+ let variables)
```

### src/probe/probe-utils.ts (313 lines) — Extracted utilities

```typescript
// Key exports:
// - screenLines/rawScreenLines/frameBuffer: mutable module-level state
// - pushLine, getScreen, pushRawLine, getRawScreen, pushFrame, getFrameBuffer, resetState
// - extractJSON: robust JSON extraction from VLM output (raw, fenced, embedded)
// - captureFrame: rawScreen → ansiToSvg → sharp JPEG → base64
// - compositeGrid: 4 frames → 2x2 grid → JPEG base64
// - handleCommand: SIGSTOP/SIGCONT/SIGKILL/stdin-write
// - pipeStream: ReadableStream → line-by-line processing, ANSI stripping, 64KB safety valve
// - pipeToTerminal: ReadableStream → terminal.write() → log line extraction by grid diffing
```

### src/probe/terminal.ts (200 lines) — Headless xterm wrapper

```typescript
// createTerminal(cols, rows) → TerminalWrapper
// - write(): Promise-based (xterm write is async)
// - getGrid(): walks cell buffer, reconstructs SGR codes, returns {text, ansi}
// - SGR reconstruction tracks style transitions, emits reset+apply on change
// - Handles: bold, dim, italic, underline, inverse, 16-color, 256-color palette
```

### src/probe/ansi-to-svg.ts (221 lines) — Inline renderer

```typescript
// ansiToSvg(input, options?) → SVG string
// - Parses SGR sequences, renders text spans with fill/font-weight/opacity
// - Handles: 16 colors, 256-color, truecolor, bold, dim, italic, underline, reverse
// - Background rects for colored backgrounds
// - Strips non-SGR escapes (cursor, scroll regions, window ops)
// - charWidth = fontSize * 0.6 (monospace approximation)
```

### src/app/useAgentSocket.ts (242 lines) — Dashboard WebSocket hook

```typescript
// applyMessage(): pure function that transforms Agent[] based on WS message
// useAgentSocket(url): hook with reconnect, rAF message batching
// - msgBufferRef collects messages, flushes on requestAnimationFrame
// - Exponential backoff on disconnect (1s → 30s max)
// - Selection logic: auto-select first agent, deselect on disconnect
```

---

## Review Categories

For each issue, provide: **Severity** (Critical/High/Medium/Low), **Location** (file:line), **Problem**, **Impact**, **Fix** (concrete code or approach).

### 1. Security
- Path traversal in frame serving (`getFrame` uses `startsWith` — symlink bypass?)
- No authentication anywhere (known, but are there escalation vectors?)
- Agent ID sanitization — is `[^a-zA-Z0-9_-]` → `_` sufficient?
- Can a malicious probe crash the hub? (OOM via large messages, rapid reconnect, etc.)
- Base64 decode of untrusted `frame` field — any bomb vectors?

### 2. Reliability & Race Conditions
- Probe has 13+ mutable `let` variables — any concurrent access issues?
- `startProbe()` sets intervals — what if called twice? (re-registration path)
- `childProc.exited.then()` runs `clearIntervals()` — timer IDs may have been reassigned
- Hub broadcasts init on every registration — thundering herd with N dashboards?
- `frame_update` handler does synchronous `writeFileSync` in the WS message handler — blocking?
- Cleanup timer races with `writeFrame` — can it delete a frame mid-write?
- DB writes (`insertFrame`, `insertVlmEvent`) are fire-and-forget (`db?.method()`) — silent failures

### 3. Performance
- `writeFileSync` in the hot path (frame_update every 2s per probe)
- `readdirSync` + `statSync` in getFrames fallback — O(n) filesystem scan
- `sharp` operations in frame capture (SVG→JPEG resize) — CPU-bound, blocks event loop?
- `JSON.stringify(msg)` called per-broadcast to each dashboard — N dashboards = N serializations?
- Hub log buffer: `agentState.logs.push(log); if (length > 50) shift()` — O(n) shift every time
- `compositeGrid` creates blank frames with sharp even when < 4 frames available

### 4. Error Handling & Resilience
- What happens when SQLite disk is full? (`db?.insertLog` silently fails)
- What happens when frame storage fills tmpfs? (`writeFileSync` throws — caught?)
- `sharp` crash in frame capture kills the entire probe? Or just that frame?
- VLM endpoint down: tier1 timeout (5s) + tier2 timeout (45s) — probe functional during?
- Hub crash: all probes reconnect simultaneously — thundering herd?

### 5. Data Integrity
- Frame timestamps from probe (`msg.timestamp || Date.now()`) — clock skew between probe and hub?
- Same timestamp = same filename — two frames at same ms overwrite each other
- `cleanup()` deletes files but DB metadata deletion is separate — partial failure = inconsistency
- No foreign keys between frames table and agents table
- SQLite WAL mode + concurrent reads from HTTP API — any issues?

### 6. Test Gaps
- No test for probe reconnection behavior (intervals, state preservation)
- No test for concurrent frame writes from multiple probes
- No test for cleanup timer firing during active writes
- No test for hub handling malformed/oversized frame_update
- No test for `compositeGrid` with sharp failures
- `useAgentSocket` at 40% line coverage — reconnect and batch processing untested
- No load/stress test (what happens with 50 probes? 1000 frames/sec?)

### 7. API Design
- `createHub` accepts `StorageConfig | string` — is the union type a long-term liability?
- `getFrames` has different return paths (DB vs filesystem) — consistency guaranteed?
- Hub HTTP routes use regex matching — order-dependent, fragile?
- No pagination cursor (offset-based pagination is O(n) for deep pages)
- No rate limiting on HTTP API or WebSocket messages

### 8. Architecture
- Frame storage writes happen synchronously in the WS message handler — should be offloaded?
- Probe mutable state should be a state machine (explicit transitions, testable)?
- `probe-utils.ts` module-level mutable state makes unit testing fragile
- Hub has no backpressure — slow dashboard blocks broadcast to all?
- No health check that verifies storage is actually working (DB writable, frame path accessible)

---

## Output Format

Structure your response as:

```
## Critical Issues (must fix before v0.2.5)
1. [SEVERITY] file:line — Problem → Impact → Fix

## High Priority (fix in v0.2.4 hardening pass)
1. ...

## Medium Priority (address in v0.2.5-v0.2.6)
1. ...

## Low Priority (track for beta)
1. ...

## Architecture Recommendations
- ...

## Missing Tests (prioritized)
1. ...
```

Be specific. Include code snippets for fixes where helpful. Don't pad with style nits — every item should be something that could cause a bug, security issue, data loss, or performance problem in production.
