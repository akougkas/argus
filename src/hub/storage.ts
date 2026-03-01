import { mkdirSync, existsSync, readdirSync, unlinkSync, readFileSync, copyFileSync, statSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { join, basename, resolve, sep } from "path";
import { createDb, type DbInstance } from "./db";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface StorageConfig {
  dbPath?: string;
  framePath?: string;
  frameMode?: "ephemeral" | "persist";
  frameTTL?: number; // ms, default 300000 (5min), ephemeral only
}

// ---------------------------------------------------------------------------
// FrameStore
// ---------------------------------------------------------------------------

export interface FrameRef {
  path: string;
  agent_id: string;
  timestamp: number;
  size_bytes: number;
}

export interface FrameStore {
  writeFrame(agentId: string, timestamp: number, jpegBuffer: Buffer): Promise<string>;
  getFrames(agentId: string, opts?: { limit?: number; since?: number; before?: number }): FrameRef[];
  getFrame(path: string): Buffer | null;
  cleanup(agentId: string, olderThan: number): number;
  flush(agentId: string, destDir: string): number;
  readonly rootPath: string;
}

// ---------------------------------------------------------------------------
// StorageLayer
// ---------------------------------------------------------------------------

export interface StorageLayer {
  db: DbInstance | null;
  frames: FrameStore | null;
  close(): void;
}

// ---------------------------------------------------------------------------
// FrameStore implementation — filesystem-backed
// ---------------------------------------------------------------------------

export function createFrameStore(rootPath: string, db: DbInstance | null): FrameStore {
  mkdirSync(rootPath, { recursive: true });

  function agentDir(agentId: string): string {
    // Sanitize agent ID for filesystem safety
    const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(rootPath, safe);
  }

  return {
    rootPath,

    async writeFrame(agentId: string, timestamp: number, jpegBuffer: Buffer): Promise<string> {
      const dir = agentDir(agentId);
      await mkdir(dir, { recursive: true });
      const filename = `${timestamp}.jpg`;
      const filePath = join(dir, filename);
      await writeFile(filePath, jpegBuffer);
      const sizeBytes = jpegBuffer.length;

      // Record metadata in SQLite if available
      db?.insertFrame(agentId, timestamp, filePath, sizeBytes);

      return filePath;
    },

    getFrames(agentId: string, opts: { limit?: number; since?: number; before?: number } = {}): FrameRef[] {
      // Prefer DB if available (indexed, paginated)
      if (db) {
        return db.getFrames(agentId, opts);
      }

      // Fallback: scan filesystem
      const dir = agentDir(agentId);
      if (!existsSync(dir)) return [];

      const { limit = 100, since, before } = opts;
      let entries = readdirSync(dir)
        .filter((f) => f.endsWith(".jpg"))
        .map((f) => {
          const ts = parseInt(basename(f, ".jpg"), 10);
          const filePath = join(dir, f);
          const stat = statSync(filePath);
          return { path: filePath, agent_id: agentId, timestamp: ts, size_bytes: stat.size };
        })
        .filter((e) => !isNaN(e.timestamp));

      if (since !== undefined) entries = entries.filter((e) => e.timestamp >= since);
      if (before !== undefined) entries = entries.filter((e) => e.timestamp < before);

      // Sort DESC (newest first)
      entries.sort((a, b) => b.timestamp - a.timestamp);
      return entries.slice(0, limit);
    },

    getFrame(framePath: string): Buffer | null {
      // Security: resolve to canonical path and verify it's under rootPath
      const resolved = resolve(framePath);
      const boundary = resolve(rootPath) + sep;
      if (!resolved.startsWith(boundary)) return null;
      if (!existsSync(resolved)) return null;
      return readFileSync(resolved) as Buffer;
    },

    cleanup(agentId: string, olderThan: number): number {
      const dir = agentDir(agentId);
      if (!existsSync(dir)) return 0;

      let count = 0;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".jpg")) continue;
        const ts = parseInt(basename(f, ".jpg"), 10);
        if (isNaN(ts) || ts >= olderThan) continue;
        try {
          unlinkSync(join(dir, f));
          count++;
        } catch {
          // Partial failure: skip this file, continue cleanup
        }
      }

      // Clean from DB too
      db?.deleteFramesBefore(agentId, olderThan);

      return count;
    },

    flush(agentId: string, destDir: string): number {
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_FRAME_TTL = 300_000; // 5 minutes

function defaultFramePath(): string {
  // Prefer tmpfs on Linux
  if (existsSync("/dev/shm")) return "/dev/shm/argus-frames";
  return join(process.env.TMPDIR || "/tmp", "argus-frames");
}

export function createStorage(config: StorageConfig = {}): StorageLayer {
  const db = config.dbPath !== undefined ? createDb(config.dbPath) : null;

  let frames: FrameStore | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  if (config.framePath !== undefined || config.frameMode !== undefined) {
    const framePath = config.framePath || defaultFramePath();
    frames = createFrameStore(framePath, db);

    // Auto-cleanup in ephemeral mode
    if (config.frameMode !== "persist") {
      const ttl = config.frameTTL ?? DEFAULT_FRAME_TTL;
      cleanupTimer = setInterval(() => {
        const cutoff = Date.now() - ttl;
        const rootPath = frames!.rootPath;
        if (!existsSync(rootPath)) return;
        for (const dir of readdirSync(rootPath)) {
          const dirPath = join(rootPath, dir);
          try {
            const stat = statSync(dirPath);
            if (stat.isDirectory()) {
              frames!.cleanup(dir, cutoff);
            }
          } catch {
            // Directory may have been removed between readdir and stat
          }
        }
      }, Math.min(ttl, 60_000)); // Check at most every minute

      // Don't keep process alive for cleanup
      if (cleanupTimer.unref) cleanupTimer.unref();
    }
  }

  return {
    db,
    frames,
    close() {
      if (cleanupTimer) clearInterval(cleanupTimer);
      db?.close();
    },
  };
}
