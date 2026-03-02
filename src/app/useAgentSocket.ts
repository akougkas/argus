"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStateLabel = "PROGRESSING" | "STUCK" | "DANGEROUS" | "HALLUCINATING" | "PAUSED" | "EXITED";

export interface LogLine {
  id: string;
  timestamp: string;
  text: string;
  type: "system" | "info" | "error" | "warn";
}

export interface AgentTelemetry {
  eventType: string;
  runId: string;
  toolName?: string;
  toolArgs?: string;
  contextPercent: number;
  activeRuns: number;
  lastUpdated: string;
}

export interface Agent {
  id: string;
  name: string;
  task: string;
  state: AgentStateLabel;
  logs: LogLine[];
  confidence: number;
  reasoning?: string;
  frame?: string;
  ptyScreen?: string;
  telemetry?: AgentTelemetry;
}

// ---------------------------------------------------------------------------
// Message parsing — pure function, testable without React
// ---------------------------------------------------------------------------

let logIdCounter = 0;

function nextLogId(): string {
  return `log-${++logIdCounter}`;
}

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

// ---------------------------------------------------------------------------
// Extracted pure functions — testable without React
// ---------------------------------------------------------------------------

export interface BatchResult {
  agents: Agent[];
  selectFirst: boolean;
  deselectId: string | null;
}

export function applyBatch(
  agents: Agent[],
  batch: Record<string, unknown>[],
): BatchResult {
  let next = agents;
  for (const msg of batch) {
    next = applyMessage(next, msg);
  }
  const lastInit = batch.findLast((m) => m.type === "init");
  const selectFirst = !!(lastInit && next.length > 0);
  const lastDc = batch.findLast((m) => m.type === "agent_disconnected");
  const deselectId = lastDc ? (lastDc.agent_id as string) : null;
  return { agents: next, selectFirst, deselectId };
}

export function buildCommand(
  action: string,
  agentId: string,
  content?: string,
): Record<string, string> | null {
  if (!agentId) return null;
  const msg: Record<string, string> = {
    type: "command",
    agent_id: agentId,
    action,
  };
  if (content !== undefined) msg.content = content;
  return msg;
}

export function parseWsMessage(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function nextReconnectDelay(current: number, maxDelay = 30000): number {
  return Math.min(current * 2, maxDelay);
}

export function resolveSelectedId(
  prevId: string,
  result: BatchResult,
): string {
  let id = prevId;
  if (result.selectFirst && !id && result.agents.length > 0) {
    id = result.agents[0].id;
  }
  if (result.deselectId && id === result.deselectId) {
    id = "";
  }
  return id;
}

export function findAgent(agents: Agent[], id: string): Agent | undefined {
  return agents.find((a) => a.id === id);
}

export function createAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    name: id,
    task: "",
    state: "PROGRESSING",
    confidence: 100,
    logs: [],
    ...overrides,
  };
}

const KNOWN_TYPES = new Set([
  "init", "agent_disconnected", "frame_update",
  "terminal_screen_update", "log_update", "update",
  "telemetry_update",
]);

export function isKnownMessageType(data: Record<string, unknown>): boolean {
  return typeof data.type === "string" && KNOWN_TYPES.has(data.type);
}

export function applyMessage(agents: Agent[], data: Record<string, unknown>): Agent[] {
  if (data.type === "init") {
    const states = data.data as Record<string, Record<string, unknown>>;
    const serverAgents: Agent[] = Object.entries(states).map(([id, s]) => ({
      id,
      name: id,
      task: (s.task as string) || "",
      state: (s.state as AgentStateLabel) || "PROGRESSING",
      confidence: (s.confidence as number) ?? 100,
      reasoning: (s.reasoning as string) || "",
      logs: ((s.logs as Array<Record<string, string>>) || []).map((l) => ({
        ...l,
        id: nextLogId(),
        timestamp: timestamp(),
      })) as LogLine[],
    }));
    const merged = new Map(agents.map((a) => [a.id, a]));
    for (const a of serverAgents) {
      const existing = merged.get(a.id);
      merged.set(
        a.id,
        existing
          ? { ...existing, state: a.state, confidence: a.confidence, reasoning: a.reasoning }
          : a,
      );
    }
    return Array.from(merged.values());
  }

  if (data.type === "agent_disconnected") {
    return agents.filter((a) => a.id !== data.agent_id);
  }

  if (data.type === "frame_update") {
    return agents.map((a) =>
      a.id === data.agent_id ? { ...a, frame: data.frame as string } : a,
    );
  }

  if (data.type === "terminal_screen_update") {
    return agents.map((a) =>
      a.id === data.agent_id ? { ...a, ptyScreen: data.screen as string } : a,
    );
  }

  if (data.type === "log_update") {
    const log = data.log as Record<string, string>;
    return agents.map((a) => {
      if (a.id !== data.agent_id) return a;
      const entry: LogLine = {
        id: nextLogId(),
        timestamp: timestamp(),
        text: log.text,
        type: (log.type || "info") as LogLine["type"],
      };
      return { ...a, logs: [...a.logs, entry].slice(-50) };
    });
  }

  if (data.type === "update") {
    const vlm = data.data as Record<string, unknown>;
    return agents.map((a) => {
      if (a.id !== data.agent_id) return a;
      const entry: LogLine = {
        id: nextLogId(),
        timestamp: timestamp(),
        text: `[VLM] ${vlm.reasoning || `State updated to ${vlm.agent_state}`}`,
        type: vlm.agent_state === "PROGRESSING" ? "info" : "warn",
      };
      return {
        ...a,
        state: vlm.agent_state as AgentStateLabel,
        confidence: (vlm.confidence_score as number) || a.confidence,
        reasoning: vlm.reasoning as string,
        logs: [...a.logs, entry].slice(-20),
      };
    });
  }

  if (data.type === "telemetry_update") {
    return agents.map((a) => {
      if (a.id !== data.agent_id) return a;
      const d = data.data as Record<string, unknown> | undefined;
      const t = data.telemetry as Record<string, unknown> | undefined;
      return {
        ...a,
        telemetry: {
          eventType: data.event_type as string,
          runId: data.run_id as string,
          toolName: (d?.tool_name as string) || undefined,
          toolArgs: d?.args ? JSON.stringify(d.args).slice(0, 80) : undefined,
          contextPercent: (t?.context_percent as number) ?? 0,
          activeRuns: (t?.active_runs as number) ?? 0,
          lastUpdated: timestamp(),
        },
      };
    });
  }

  return agents;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentSocket(url: string) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const msgBufferRef = useRef<Record<string, unknown>[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  useEffect(() => {
    unmountedRef.current = false;

    function flushMessages() {
      const batch = msgBufferRef.current;
      if (batch.length === 0) return;
      msgBufferRef.current = [];
      flushTimerRef.current = null;

      setAgents((prev) => {
        const result = applyBatch(prev, batch);
        setSelectedAgentId((prevId) => resolveSelectedId(prevId, result));
        return result.agents;
      });
    }

    function connect() {
      if (unmountedRef.current) return;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelayRef.current = 1000;
        setConnected(true);
        console.log("Connected to Argus Server");
      };

      ws.onmessage = (event) => {
        const data = parseWsMessage(event.data);
        if (!data) {
          console.warn("[dashboard] Received malformed JSON:", event.data);
          return;
        }
        msgBufferRef.current.push(data);
        if (!flushTimerRef.current) {
          flushTimerRef.current = requestAnimationFrame(flushMessages);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        console.log("Disconnected from Argus Server");
        if (!unmountedRef.current) {
          const delay = reconnectDelayRef.current;
          console.log(`[dashboard] Reconnecting in ${delay / 1000}s...`);
          reconnectTimerRef.current = setTimeout(connect, delay);
          reconnectDelayRef.current = nextReconnectDelay(delay);
        }
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (flushTimerRef.current) cancelAnimationFrame(flushTimerRef.current);
      wsRef.current?.close();
    };
  }, [url]);

  const sendCommand = useCallback(
    (action: string, content?: string) => {
      const msg = buildCommand(action, selectedAgentId, content);
      if (msg && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    [selectedAgentId],
  );

  return {
    agents,
    selectedAgentId,
    setSelectedAgentId,
    selectedAgent: findAgent(agents, selectedAgentId),
    sendCommand,
    connected,
    wsRef,
  };
}
