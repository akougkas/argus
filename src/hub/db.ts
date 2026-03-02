import { Database } from "bun:sqlite";

export interface DbInstance {
  insertAgent(
    id: string,
    state: string,
    confidence: number,
    reasoning: string,
    task: string,
    command: string,
    startTime: number,
    lastSeen: number,
  ): void;
  updateAgentState(
    id: string,
    state: string,
    confidence: number,
    reasoning: string,
    lastSeen: number,
  ): void;
  insertLog(
    agentId: string,
    text: string,
    type: string,
    timestamp: number,
  ): void;
  insertVlmEvent(
    agentId: string,
    state: string,
    confidence: number,
    reasoning: string,
    timestamp: number,
  ): void;
  getAllAgents(): Array<{
    id: string;
    state: string;
    confidence: number;
    reasoning: string;
    task: string;
    command: string;
    start_time: number;
    last_seen: number;
  }>;
  getAgentHistory(
    agentId: string,
    opts?: { limit?: number; offset?: number; since?: number },
  ): Array<{
    id: number;
    agent_id: string;
    state: string;
    confidence: number;
    reasoning: string;
    timestamp: number;
  }>;
  getAgentLogs(
    agentId: string,
    opts?: { limit?: number; offset?: number; since?: number; type?: string },
  ): Array<{
    id: number;
    agent_id: string;
    text: string;
    type: string;
    timestamp: number;
  }>;
  insertFrame(
    agentId: string,
    timestamp: number,
    path: string,
    sizeBytes: number,
  ): void;
  getFrames(
    agentId: string,
    opts?: { limit?: number; since?: number; before?: number },
  ): Array<{
    path: string;
    agent_id: string;
    timestamp: number;
    size_bytes: number;
  }>;
  deleteFramesBefore(agentId: string, olderThan: number): number;
  insertTelemetryEvent(
    agentId: string,
    eventType: string,
    runId: string,
    data: string,
    contextPercent: number,
    activeRuns: number,
    timestamp: number,
  ): void;
  getTelemetryEvents(
    agentId: string,
    opts?: { limit?: number; offset?: number; since?: number; before?: number; run_id?: string },
  ): Array<{
    id: number;
    agent_id: string;
    event_type: string;
    run_id: string;
    data: string;
    context_percent: number;
    active_runs: number;
    timestamp: number;
  }>;
  close(): void;
}

export function createDb(path?: string): DbInstance {
  const db = new Database(path ?? ":memory:");

  // WAL mode for concurrent reads, foreign keys for integrity
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      state TEXT,
      confidence REAL,
      reasoning TEXT,
      task TEXT,
      command TEXT,
      start_time INTEGER,
      last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      text TEXT,
      type TEXT,
      timestamp INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_logs_agent_ts ON logs(agent_id, timestamp);
    CREATE TABLE IF NOT EXISTS vlm_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      state TEXT,
      confidence REAL,
      reasoning TEXT,
      timestamp INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_vlm_agent_ts ON vlm_events(agent_id, timestamp);
    CREATE TABLE IF NOT EXISTS frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      timestamp INTEGER,
      path TEXT,
      size_bytes INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_frames_agent_ts ON frames(agent_id, timestamp);
    CREATE TABLE IF NOT EXISTS telemetry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      event_type TEXT,
      run_id TEXT,
      data TEXT,
      context_percent REAL,
      active_runs INTEGER,
      timestamp INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_agent_ts ON telemetry_events(agent_id, timestamp);
  `);

  // Prepared statements
  const stmtInsertAgent = db.prepare(`
    INSERT INTO agents (id, state, confidence, reasoning, task, command, start_time, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      state = excluded.state,
      confidence = excluded.confidence,
      reasoning = excluded.reasoning,
      task = excluded.task,
      command = excluded.command,
      start_time = excluded.start_time,
      last_seen = excluded.last_seen
  `);

  const stmtUpdateAgentState = db.prepare(`
    UPDATE agents SET state = ?, confidence = ?, reasoning = ?, last_seen = ? WHERE id = ?
  `);

  const stmtInsertLog = db.prepare(`
    INSERT INTO logs (agent_id, text, type, timestamp) VALUES (?, ?, ?, ?)
  `);

  const stmtInsertVlmEvent = db.prepare(`
    INSERT INTO vlm_events (agent_id, state, confidence, reasoning, timestamp) VALUES (?, ?, ?, ?, ?)
  `);

  const stmtInsertFrame = db.prepare(`
    INSERT INTO frames (agent_id, timestamp, path, size_bytes) VALUES (?, ?, ?, ?)
  `);

  const stmtDeleteFramesBefore = db.prepare(`
    DELETE FROM frames WHERE agent_id = ? AND timestamp < ?
  `);

  const stmtInsertTelemetryEvent = db.prepare(`
    INSERT INTO telemetry_events (agent_id, event_type, run_id, data, context_percent, active_runs, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const stmtGetAllAgents = db.prepare(`SELECT * FROM agents`);

  return {
    insertAgent(id, state, confidence, reasoning, task, command, startTime, lastSeen) {
      stmtInsertAgent.run(id, state, confidence, reasoning, task, command, startTime, lastSeen);
    },

    updateAgentState(id, state, confidence, reasoning, lastSeen) {
      stmtUpdateAgentState.run(state, confidence, reasoning, lastSeen, id);
    },

    insertLog(agentId, text, type, timestamp) {
      stmtInsertLog.run(agentId, text, type, timestamp);
    },

    insertVlmEvent(agentId, state, confidence, reasoning, timestamp) {
      stmtInsertVlmEvent.run(agentId, state, confidence, reasoning, timestamp);
    },

    getAllAgents() {
      return stmtGetAllAgents.all() as ReturnType<DbInstance["getAllAgents"]>;
    },

    getAgentHistory(agentId, opts = {}) {
      const { limit = 100, offset = 0, since } = opts;
      if (since !== undefined) {
        return db
          .prepare(
            `SELECT * FROM vlm_events WHERE agent_id = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
          )
          .all(agentId, since, limit, offset) as ReturnType<DbInstance["getAgentHistory"]>;
      }
      return db
        .prepare(
          `SELECT * FROM vlm_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        )
        .all(agentId, limit, offset) as ReturnType<DbInstance["getAgentHistory"]>;
    },

    getAgentLogs(agentId, opts = {}) {
      const { limit = 100, offset = 0, since, type } = opts;
      const conditions = ["agent_id = ?"];
      const params: (string | number)[] = [agentId];

      if (since !== undefined) {
        conditions.push("timestamp >= ?");
        params.push(since);
      }
      if (type !== undefined) {
        conditions.push("type = ?");
        params.push(type);
      }

      params.push(limit, offset);
      const where = conditions.join(" AND ");
      return db
        .prepare(
          `SELECT * FROM logs WHERE ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        )
        .all(...params) as ReturnType<DbInstance["getAgentLogs"]>;
    },

    insertFrame(agentId, timestamp, path, sizeBytes) {
      stmtInsertFrame.run(agentId, timestamp, path, sizeBytes);
    },

    getFrames(agentId, opts = {}) {
      const { limit = 100, since, before } = opts;
      const conditions = ["agent_id = ?"];
      const params: (string | number)[] = [agentId];

      if (since !== undefined) {
        conditions.push("timestamp >= ?");
        params.push(since);
      }
      if (before !== undefined) {
        conditions.push("timestamp < ?");
        params.push(before);
      }

      params.push(limit);
      const where = conditions.join(" AND ");
      return db
        .prepare(
          `SELECT path, agent_id, timestamp, size_bytes FROM frames WHERE ${where} ORDER BY timestamp DESC LIMIT ?`,
        )
        .all(...params) as ReturnType<DbInstance["getFrames"]>;
    },

    deleteFramesBefore(agentId, olderThan) {
      const result = stmtDeleteFramesBefore.run(agentId, olderThan);
      return result.changes;
    },

    insertTelemetryEvent(agentId, eventType, runId, data, contextPercent, activeRuns, timestamp) {
      stmtInsertTelemetryEvent.run(agentId, eventType, runId, data, contextPercent, activeRuns, timestamp);
    },

    getTelemetryEvents(agentId, opts = {}) {
      const { limit = 100, offset = 0, since, before, run_id } = opts;
      const conditions = ["agent_id = ?"];
      const params: (string | number)[] = [agentId];

      if (since !== undefined) {
        conditions.push("timestamp >= ?");
        params.push(since);
      }
      if (before !== undefined) {
        conditions.push("timestamp < ?");
        params.push(before);
      }
      if (run_id !== undefined) {
        conditions.push("run_id = ?");
        params.push(run_id);
      }

      params.push(limit, offset);
      const where = conditions.join(" AND ");
      return db
        .prepare(
          `SELECT * FROM telemetry_events WHERE ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        )
        .all(...params) as ReturnType<DbInstance["getTelemetryEvents"]>;
    },

    close() {
      db.close();
    },
  };
}
