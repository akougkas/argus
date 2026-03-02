import { describe, test, expect, afterEach } from "bun:test";
import {
  createTelemetryListener,
  validatePayload,
  VALID_EVENT_TYPES,
  type TelemetryListener,
  type TelemetryPayload,
} from "../../../src/probe/telemetry-listener";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const listeners: TelemetryListener[] = [];
const senders: Array<{ close(): void }> = [];

afterEach(() => {
  for (const l of listeners) {
    try { l.close(); } catch { /* already closed */ }
  }
  listeners.length = 0;
  for (const s of senders) {
    try { s.close(); } catch { /* already closed */ }
  }
  senders.length = 0;
});

function makePayload(overrides: Partial<TelemetryPayload> = {}): TelemetryPayload {
  return {
    timestamp: Date.now(),
    event_type: "tool_execution_start",
    run_id: "run-abc-123",
    data: { tool_name: "bash", args: { command: "ls" } },
    telemetry: { context_percent: 42.5, active_runs: 1 },
    ...overrides,
  };
}

async function sendUdp(port: number, data: string | Buffer): Promise<void> {
  const sender = await Bun.udpSocket({ port: 0 });
  senders.push(sender);
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  sender.send(buf, port, "127.0.0.1");
}

const SETTLE = 80; // ms — give UDP time to deliver + callbacks to fire

// ---------------------------------------------------------------------------
// validatePayload — pure function tests
// ---------------------------------------------------------------------------

describe("validatePayload", () => {
  test("accepts valid payload", () => {
    const p = makePayload();
    const result = validatePayload(p);
    expect(result).toEqual(p);
  });

  test("rejects non-object", () => {
    expect(() => validatePayload("string")).toThrow("non-null object");
    expect(() => validatePayload(null)).toThrow("non-null object");
    expect(() => validatePayload(42)).toThrow("non-null object");
  });

  test("rejects missing timestamp", () => {
    const p = makePayload();
    delete (p as Record<string, unknown>).timestamp;
    expect(() => validatePayload(p)).toThrow("timestamp");
  });

  test("rejects non-finite timestamp", () => {
    expect(() => validatePayload(makePayload({ timestamp: Infinity }))).toThrow("timestamp");
    expect(() => validatePayload(makePayload({ timestamp: NaN }))).toThrow("timestamp");
  });

  test("rejects invalid event_type", () => {
    const p = { ...makePayload(), event_type: "invalid_event" };
    expect(() => validatePayload(p)).toThrow("event_type");
  });

  test("rejects missing event_type", () => {
    const p = makePayload();
    delete (p as Record<string, unknown>).event_type;
    expect(() => validatePayload(p)).toThrow("event_type");
  });

  test("rejects missing run_id", () => {
    const p = makePayload();
    delete (p as Record<string, unknown>).run_id;
    expect(() => validatePayload(p)).toThrow("run_id");
  });

  test("rejects empty run_id", () => {
    expect(() => validatePayload(makePayload({ run_id: "" }))).toThrow("run_id");
  });

  test("rejects missing data", () => {
    const p = makePayload();
    delete (p as Record<string, unknown>).data;
    expect(() => validatePayload(p)).toThrow("data");
  });

  test("rejects null data", () => {
    const p = { ...makePayload(), data: null };
    expect(() => validatePayload(p)).toThrow("data");
  });

  test("rejects missing telemetry", () => {
    const p = makePayload();
    delete (p as Record<string, unknown>).telemetry;
    expect(() => validatePayload(p)).toThrow("telemetry");
  });

  test("rejects missing telemetry.context_percent", () => {
    const p = makePayload();
    delete (p.telemetry as Record<string, unknown>).context_percent;
    expect(() => validatePayload(p)).toThrow("context_percent");
  });

  test("rejects missing telemetry.active_runs", () => {
    const p = makePayload();
    delete (p.telemetry as Record<string, unknown>).active_runs;
    expect(() => validatePayload(p)).toThrow("active_runs");
  });

  test("rejects non-finite telemetry.context_percent", () => {
    const p = makePayload();
    p.telemetry.context_percent = NaN;
    expect(() => validatePayload(p)).toThrow("context_percent");
  });

  test("accepts all 5 valid event types", () => {
    for (const evType of VALID_EVENT_TYPES) {
      const p = makePayload({ event_type: evType });
      expect(validatePayload(p).event_type).toBe(evType);
    }
  });
});

// ---------------------------------------------------------------------------
// createTelemetryListener — integration with UDP
// ---------------------------------------------------------------------------

describe("createTelemetryListener", () => {
  test("creates listener on auto-assigned port", async () => {
    const listener = await createTelemetryListener({ port: 0 });
    listeners.push(listener);

    expect(listener.port).toBeGreaterThan(0);
  });

  test("receives valid payload via UDP and calls onEvent", async () => {
    const events: TelemetryPayload[] = [];
    const listener = await createTelemetryListener({
      port: 0,
      onEvent: (p) => events.push(p),
    });
    listeners.push(listener);

    const payload = makePayload();
    await sendUdp(listener.port, JSON.stringify(payload));
    await new Promise((r) => setTimeout(r, SETTLE));

    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe("tool_execution_start");
    expect(events[0].run_id).toBe("run-abc-123");
    expect(events[0].data.tool_name).toBe("bash");
    expect(events[0].telemetry.context_percent).toBe(42.5);
  });

  test("receives multiple payloads sequentially", async () => {
    const events: TelemetryPayload[] = [];
    const listener = await createTelemetryListener({
      port: 0,
      onEvent: (p) => events.push(p),
    });
    listeners.push(listener);

    await sendUdp(listener.port, JSON.stringify(makePayload({ run_id: "run-1" })));
    await sendUdp(listener.port, JSON.stringify(makePayload({ run_id: "run-2" })));
    await sendUdp(listener.port, JSON.stringify(makePayload({ run_id: "run-3" })));
    await new Promise((r) => setTimeout(r, SETTLE));

    expect(events.length).toBe(3);
    expect(events.map((e) => e.run_id)).toEqual(["run-1", "run-2", "run-3"]);
  });

  test("calls onError for invalid JSON", async () => {
    const errors: Error[] = [];
    const events: TelemetryPayload[] = [];
    const listener = await createTelemetryListener({
      port: 0,
      onEvent: (p) => events.push(p),
      onError: (e) => errors.push(e),
    });
    listeners.push(listener);

    await sendUdp(listener.port, "not json at all{{{");
    await new Promise((r) => setTimeout(r, SETTLE));

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("Invalid JSON");
    expect(events.length).toBe(0);
  });

  test("calls onError for missing required fields", async () => {
    const errors: Error[] = [];
    const events: TelemetryPayload[] = [];
    const listener = await createTelemetryListener({
      port: 0,
      onEvent: (p) => events.push(p),
      onError: (e) => errors.push(e),
    });
    listeners.push(listener);

    // Valid JSON but missing run_id
    const bad = { timestamp: 123, event_type: "agent_start", data: {}, telemetry: { context_percent: 10, active_runs: 1 } };
    await sendUdp(listener.port, JSON.stringify(bad));
    await new Promise((r) => setTimeout(r, SETTLE));

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("run_id");
    expect(events.length).toBe(0);
  });

  test("calls onError for invalid event_type", async () => {
    const errors: Error[] = [];
    const listener = await createTelemetryListener({
      port: 0,
      onError: (e) => errors.push(e),
    });
    listeners.push(listener);

    const bad = makePayload();
    (bad as Record<string, unknown>).event_type = "bogus_event";
    await sendUdp(listener.port, JSON.stringify(bad));
    await new Promise((r) => setTimeout(r, SETTLE));

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("event_type");
    expect(errors[0].message).toContain("bogus_event");
  });

  test("does not crash on invalid payload — keeps receiving", async () => {
    const events: TelemetryPayload[] = [];
    const errors: Error[] = [];
    const listener = await createTelemetryListener({
      port: 0,
      onEvent: (p) => events.push(p),
      onError: (e) => errors.push(e),
    });
    listeners.push(listener);

    // Send bad, then good
    await sendUdp(listener.port, "garbage");
    await new Promise((r) => setTimeout(r, SETTLE));

    await sendUdp(listener.port, JSON.stringify(makePayload({ run_id: "after-error" })));
    await new Promise((r) => setTimeout(r, SETTLE));

    expect(errors.length).toBe(1);
    expect(events.length).toBe(1);
    expect(events[0].run_id).toBe("after-error");
  });

  test("all 5 event types are received correctly", async () => {
    const events: TelemetryPayload[] = [];
    const listener = await createTelemetryListener({
      port: 0,
      onEvent: (p) => events.push(p),
    });
    listeners.push(listener);

    for (const evType of VALID_EVENT_TYPES) {
      await sendUdp(listener.port, JSON.stringify(makePayload({ event_type: evType })));
    }
    await new Promise((r) => setTimeout(r, SETTLE));

    expect(events.length).toBe(5);
    const receivedTypes = events.map((e) => e.event_type);
    for (const evType of VALID_EVENT_TYPES) {
      expect(receivedTypes).toContain(evType);
    }
  });

  test("close() shuts down the socket", async () => {
    const events: TelemetryPayload[] = [];
    const listener = await createTelemetryListener({
      port: 0,
      onEvent: (p) => events.push(p),
    });
    // Don't push to listeners array — we close manually
    const port = listener.port;

    listener.close();
    await new Promise((r) => setTimeout(r, 20));

    // Sending to a closed socket — packet goes into the void
    await sendUdp(port, JSON.stringify(makePayload()));
    await new Promise((r) => setTimeout(r, SETTLE));

    expect(events.length).toBe(0);
  });

  test("defaults work without config", async () => {
    // Just verify it doesn't throw — use port 0 to avoid default port collision
    const listener = await createTelemetryListener({ port: 0 });
    listeners.push(listener);
    expect(listener.port).toBeGreaterThan(0);
  });

  test("payload with extra fields still passes validation", async () => {
    const events: TelemetryPayload[] = [];
    const listener = await createTelemetryListener({
      port: 0,
      onEvent: (p) => events.push(p),
    });
    listeners.push(listener);

    const payload = { ...makePayload(), extra_field: "bonus", nested: { x: 1 } };
    await sendUdp(listener.port, JSON.stringify(payload));
    await new Promise((r) => setTimeout(r, SETTLE));

    expect(events.length).toBe(1);
    expect(events[0].run_id).toBe("run-abc-123");
  });

  test("empty data object is valid", async () => {
    const events: TelemetryPayload[] = [];
    const listener = await createTelemetryListener({
      port: 0,
      onEvent: (p) => events.push(p),
    });
    listeners.push(listener);

    const payload = makePayload();
    payload.data = {};
    await sendUdp(listener.port, JSON.stringify(payload));
    await new Promise((r) => setTimeout(r, SETTLE));

    expect(events.length).toBe(1);
    expect(events[0].data).toEqual({});
  });
});
