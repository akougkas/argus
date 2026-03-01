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

export function applyMessage(agents: Agent[], data: Record<string, unknown>): Agent[] {
  if (data.type === "init") {
    const states = data.data as Record<string, Record<string, unknown>>;
    const serverAgents: Agent[] = Object.entries(states).map(([id, s]) => ({
      id,
      name: id,
      task: "",
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
        let next = prev;
        for (const msg of batch) {
          next = applyMessage(next, msg);
        }
        // Handle selection for init/disconnect
        const lastInit = batch.findLast(m => m.type === "init");
        if (lastInit && next.length > 0) {
          setSelectedAgentId((prevId) => prevId || next[0].id);
        }
        const lastDc = batch.findLast(m => m.type === "agent_disconnected");
        if (lastDc) {
          setSelectedAgentId((prevId) => prevId === lastDc.agent_id ? "" : prevId);
        }
        return next;
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
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(event.data);
        } catch {
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
          reconnectDelayRef.current = Math.min(delay * 2, 30000);
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
      if (wsRef.current?.readyState === WebSocket.OPEN && selectedAgentId) {
        const msg: Record<string, string> = {
          type: "command",
          agent_id: selectedAgentId,
          action,
        };
        if (content !== undefined) msg.content = content;
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    [selectedAgentId],
  );

  return {
    agents,
    selectedAgentId,
    setSelectedAgentId,
    selectedAgent: agents.find((a) => a.id === selectedAgentId),
    sendCommand,
    connected,
    wsRef,
  };
}
