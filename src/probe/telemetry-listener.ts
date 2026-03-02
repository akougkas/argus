// ---------------------------------------------------------------------------
// Telemetry Listener — UDP receiver for AWOC telemetry extension
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const VALID_EVENT_TYPES = [
  "tool_execution_start",
  "tool_execution_end",
  "agent_start",
  "turn_start",
  "context_compact",
] as const;

export type TelemetryEventType = (typeof VALID_EVENT_TYPES)[number];

export interface TelemetryPayload {
  timestamp: number;
  event_type: TelemetryEventType;
  run_id: string;
  data: {
    tool_name?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    agent_name?: string;
  };
  telemetry: {
    context_percent: number;
    active_runs: number;
  };
}

// ---------------------------------------------------------------------------
// Config & Interface
// ---------------------------------------------------------------------------

export interface TelemetryListenerConfig {
  port?: number; // default 9100
  onEvent?: (payload: TelemetryPayload) => void;
  onError?: (err: Error) => void;
}

export interface TelemetryListener {
  readonly port: number;
  close(): void;
}

// ---------------------------------------------------------------------------
// Validation — pure function, exported for testing
// ---------------------------------------------------------------------------

const validEventSet = new Set<string>(VALID_EVENT_TYPES);

export function validatePayload(obj: unknown): TelemetryPayload {
  if (typeof obj !== "object" || obj === null) {
    throw new Error("Payload must be a non-null object");
  }

  const p = obj as Record<string, unknown>;

  // timestamp
  if (typeof p.timestamp !== "number" || !Number.isFinite(p.timestamp)) {
    throw new Error("Missing or invalid 'timestamp' (must be a finite number)");
  }

  // event_type
  if (typeof p.event_type !== "string" || !validEventSet.has(p.event_type)) {
    throw new Error(
      `Invalid 'event_type': ${JSON.stringify(p.event_type)}. Must be one of: ${VALID_EVENT_TYPES.join(", ")}`,
    );
  }

  // run_id
  if (typeof p.run_id !== "string" || p.run_id.length === 0) {
    throw new Error("Missing or invalid 'run_id' (must be a non-empty string)");
  }

  // data
  if (typeof p.data !== "object" || p.data === null) {
    throw new Error("Missing or invalid 'data' (must be an object)");
  }

  // telemetry
  if (typeof p.telemetry !== "object" || p.telemetry === null) {
    throw new Error("Missing or invalid 'telemetry' (must be an object)");
  }
  const t = p.telemetry as Record<string, unknown>;
  if (typeof t.context_percent !== "number" || !Number.isFinite(t.context_percent)) {
    throw new Error("Missing or invalid 'telemetry.context_percent' (must be a finite number)");
  }
  if (typeof t.active_runs !== "number" || !Number.isFinite(t.active_runs)) {
    throw new Error("Missing or invalid 'telemetry.active_runs' (must be a finite number)");
  }

  return obj as TelemetryPayload;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 9100;

export async function createTelemetryListener(
  config: TelemetryListenerConfig = {},
): Promise<TelemetryListener> {
  const onEvent = config.onEvent ?? (() => {});
  const onError = config.onError ?? (() => {});
  const requestedPort = config.port ?? DEFAULT_PORT;

  let socket: { port: number; close(): void; unref(): void };
  try {
    socket = await Bun.udpSocket({
      port: requestedPort,
      socket: {
        data(_socket, buf) {
          let text: string;
          try {
            text = buf.toString();
          } catch {
            onError(new Error("Failed to decode UDP datagram as UTF-8"));
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            onError(new Error(`Invalid JSON in UDP datagram: ${text.slice(0, 200)}`));
            return;
          }

          try {
            const payload = validatePayload(parsed);
            onEvent(payload);
          } catch (e) {
            onError(e instanceof Error ? e : new Error(String(e)));
          }
        },
      },
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    onError(err);
    throw err;
  }

  // Don't keep process alive just for the telemetry listener
  socket.unref();

  return {
    get port() {
      return socket.port;
    },
    close() {
      socket.close();
    },
  };
}
