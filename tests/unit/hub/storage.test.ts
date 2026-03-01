import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createFrameStore, createStorage, type FrameStore, type StorageLayer } from "../../../src/hub/storage";
import { createDb, type DbInstance } from "../../../src/hub/db";

const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

let tmpDirs: string[] = [];
let db: DbInstance | null = null;
let store: FrameStore | null = null;
let storage: StorageLayer | null = null;

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "argus-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  storage?.close();
  storage = null;
  store = null;
  db?.close();
  db = null;
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("createFrameStore", () => {
  test("writeFrame creates file on disk and returns path", async () => {
    const root = makeTmpDir();
    store = createFrameStore(root, null);

    const path = await store.writeFrame("A-01", 1000, FAKE_JPEG);

    expect(path).toBe(join(root, "A-01", "1000.jpg"));
    expect(existsSync(path)).toBe(true);
    const contents = readFileSync(path);
    expect(Buffer.compare(contents, FAKE_JPEG)).toBe(0);
  });

  test("writeFrame with DB records metadata", async () => {
    const root = makeTmpDir();
    db = createDb();
    store = createFrameStore(root, db);

    await store.writeFrame("A-01", 2000, FAKE_JPEG);

    const frames = db.getFrames("A-01");
    expect(frames).toHaveLength(1);
    expect(frames[0].agent_id).toBe("A-01");
    expect(frames[0].timestamp).toBe(2000);
    expect(frames[0].size_bytes).toBe(FAKE_JPEG.length);
    expect(frames[0].path).toBe(join(root, "A-01", "2000.jpg"));
  });

  test("getFrames returns frames in DESC order (newest first)", async () => {
    const root = makeTmpDir();
    db = createDb();
    store = createFrameStore(root, db);

    await store.writeFrame("A-01", 1000, FAKE_JPEG);
    await store.writeFrame("A-01", 3000, FAKE_JPEG);
    await store.writeFrame("A-01", 2000, FAKE_JPEG);

    const frames = store.getFrames("A-01");
    expect(frames).toHaveLength(3);
    expect(frames[0].timestamp).toBe(3000);
    expect(frames[1].timestamp).toBe(2000);
    expect(frames[2].timestamp).toBe(1000);
  });

  test("getFrames with since filter", async () => {
    const root = makeTmpDir();
    db = createDb();
    store = createFrameStore(root, db);

    await store.writeFrame("A-01", 1000, FAKE_JPEG);
    await store.writeFrame("A-01", 2000, FAKE_JPEG);
    await store.writeFrame("A-01", 3000, FAKE_JPEG);

    const frames = store.getFrames("A-01", { since: 2000 });
    expect(frames).toHaveLength(2);
    expect(frames[0].timestamp).toBe(3000);
    expect(frames[1].timestamp).toBe(2000);
  });

  test("getFrames with before filter", async () => {
    const root = makeTmpDir();
    db = createDb();
    store = createFrameStore(root, db);

    await store.writeFrame("A-01", 1000, FAKE_JPEG);
    await store.writeFrame("A-01", 2000, FAKE_JPEG);
    await store.writeFrame("A-01", 3000, FAKE_JPEG);

    const frames = store.getFrames("A-01", { before: 3000 });
    expect(frames).toHaveLength(2);
    expect(frames[0].timestamp).toBe(2000);
    expect(frames[1].timestamp).toBe(1000);
  });

  test("getFrames with limit", async () => {
    const root = makeTmpDir();
    db = createDb();
    store = createFrameStore(root, db);

    for (let i = 0; i < 10; i++) {
      await store.writeFrame("A-01", 1000 + i, FAKE_JPEG);
    }

    const frames = store.getFrames("A-01", { limit: 3 });
    expect(frames).toHaveLength(3);
    expect(frames[0].timestamp).toBe(1009); // newest first
  });

  test("getFrames falls back to filesystem scan when no DB", async () => {
    const root = makeTmpDir();
    store = createFrameStore(root, null);

    await store.writeFrame("A-01", 3000, FAKE_JPEG);
    await store.writeFrame("A-01", 1000, FAKE_JPEG);
    await store.writeFrame("A-01", 2000, FAKE_JPEG);

    const frames = store.getFrames("A-01");
    expect(frames).toHaveLength(3);
    // DESC order even without DB
    expect(frames[0].timestamp).toBe(3000);
    expect(frames[1].timestamp).toBe(2000);
    expect(frames[2].timestamp).toBe(1000);
    // Each entry has correct fields
    expect(frames[0].agent_id).toBe("A-01");
    expect(frames[0].size_bytes).toBe(FAKE_JPEG.length);
    expect(frames[0].path).toBe(join(root, "A-01", "3000.jpg"));
  });

  test("getFrame returns buffer for valid path", async () => {
    const root = makeTmpDir();
    store = createFrameStore(root, null);

    const path = await store.writeFrame("A-01", 1000, FAKE_JPEG);
    const buf = store.getFrame(path);

    expect(buf).not.toBeNull();
    expect(Buffer.compare(buf!, FAKE_JPEG)).toBe(0);
  });

  test("getFrame returns null for path outside rootPath", () => {
    const root = makeTmpDir();
    store = createFrameStore(root, null);

    const result = store.getFrame("/etc/passwd");
    expect(result).toBeNull();
  });

  test("getFrame returns null for nonexistent file", () => {
    const root = makeTmpDir();
    store = createFrameStore(root, null);

    const result = store.getFrame(join(root, "A-01", "9999.jpg"));
    expect(result).toBeNull();
  });

  test("cleanup removes old frames and returns count", async () => {
    const root = makeTmpDir();
    db = createDb();
    store = createFrameStore(root, db);

    await store.writeFrame("A-01", 1000, FAKE_JPEG);
    await store.writeFrame("A-01", 2000, FAKE_JPEG);
    await store.writeFrame("A-01", 3000, FAKE_JPEG);

    // Remove frames older than 2500
    const removed = store.cleanup("A-01", 2500);
    expect(removed).toBe(2);

    // Only the newest remains on disk
    const dir = join(root, "A-01");
    const remaining = readdirSync(dir).filter((f) => f.endsWith(".jpg"));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe("3000.jpg");

    // DB also cleaned
    const dbFrames = db.getFrames("A-01");
    expect(dbFrames).toHaveLength(1);
    expect(dbFrames[0].timestamp).toBe(3000);
  });

  test("flush copies frames to destination directory", async () => {
    const root = makeTmpDir();
    const dest = makeTmpDir();
    store = createFrameStore(root, null);

    await store.writeFrame("A-01", 1000, FAKE_JPEG);
    await store.writeFrame("A-01", 2000, FAKE_JPEG);

    const destSub = join(dest, "flushed");
    const count = store.flush("A-01", destSub);
    expect(count).toBe(2);

    // Files exist in destination
    expect(existsSync(join(destSub, "1000.jpg"))).toBe(true);
    expect(existsSync(join(destSub, "2000.jpg"))).toBe(true);

    // Source files still exist (flush copies, not moves)
    expect(existsSync(join(root, "A-01", "1000.jpg"))).toBe(true);
    expect(existsSync(join(root, "A-01", "2000.jpg"))).toBe(true);
  });
});

describe("createStorage", () => {
  test("returns StorageLayer with correct fields", () => {
    const root = makeTmpDir();
    storage = createStorage({ framePath: root, dbPath: ":memory:" });

    expect(storage.db).not.toBeNull();
    expect(storage.frames).not.toBeNull();
    expect(storage.frames!.rootPath).toBe(root);
    expect(storage.close).toBeFunction();
  });

  test("with just dbPath behaves like v0.2.3 (no frames)", () => {
    storage = createStorage({ dbPath: ":memory:" });

    expect(storage.db).not.toBeNull();
    expect(storage.frames).toBeNull();

    // DB still works for non-frame operations
    storage.db!.insertAgent("A-01", "PROGRESSING", 0.9, "ok", "task", "cmd", 1000, 2000);
    const agents = storage.db!.getAllAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("A-01");
  });
});
