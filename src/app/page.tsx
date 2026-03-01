"use client";

import { useState, useEffect, useRef } from "react";
import { Activity, ShieldAlert, Pause, XCircle, Send, Terminal, Cpu, Eye, Code, Shield } from "lucide-react";
import styles from "./page.module.css";

type AgentState = "PROGRESSING" | "STUCK" | "DANGEROUS" | "HALLUCINATING";

interface LogLine {
  id: string;
  timestamp: string;
  text: string;
  type: "system" | "info" | "error" | "warn";
}

interface Agent {
  id: string;
  name: string;
  task: string;
  state: AgentState;
  logs: LogLine[];
  confidence: number;
  reasoning?: string;
  frame?: string;
  ptyScreen?: string;
}

const MOCK_AGENTS: Agent[] = [
  { id: "A-01", name: "SWE-Frontend", task: "Migrate Auth to NextAuth", state: "PROGRESSING", logs: [], confidence: 95 },
  { id: "A-02", name: "DB-Admin", task: "Postgres Index Optimization", state: "PROGRESSING", logs: [], confidence: 88 },
  { id: "A-03", name: "QA-Runner", task: "E2E Checkout Flow", state: "PROGRESSING", logs: [], confidence: 92 },
  { id: "A-04", name: "DevOps-Bot", task: "K8s Cluster Upgrade", state: "PROGRESSING", logs: [], confidence: 98 },
];

export default function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>(MOCK_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("A-01");
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const injectRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Connect to local python-probe server
    const ws = new WebSocket("ws://localhost:8000/ws/dashboard");
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Connected to Argus Server");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("Received data:", data);

      if (data.type === "init") {
        // Handle init states
        const states = data.data;
        setAgents(prev => prev.map(agent => {
          if (states[agent.id]) {
            const newState = states[agent.id];
            return {
              ...agent,
              state: newState.state,
              confidence: newState.confidence,
              reasoning: newState.reasoning,
              logs: [...agent.logs, ...newState.logs.map((l: any) => ({
                ...l,
                id: Math.random().toString(36).substring(2, 9),
                timestamp: new Date().toLocaleTimeString('en-US', { hour12: false })
              }))]
            };
          }
          return agent;
        }));
      } else if (data.type === "frame_update") {
        setAgents(prev => prev.map(agent => 
          agent.id === data.agent_id ? { ...agent, frame: data.frame } : agent
        ));
      } else if (data.type === "terminal_screen_update") {
        setAgents(prev => prev.map(agent => 
          agent.id === data.agent_id ? { ...agent, ptyScreen: data.screen } : agent
        ));
      } else if (data.type === "log_update") {
        setAgents(prev => prev.map(agent => {
          if (agent.id === data.agent_id) {
            return {
              ...agent,
              logs: [...agent.logs, data.log].slice(-50)
            };
          }
          return agent;
        }));
      } else if (data.type === "update") {
        const agentId = data.agent_id;
        const vlmData = data.data;
        
        setAgents(prev => prev.map(agent => {
          if (agent.id === agentId) {
            const newLog: LogLine = {
              id: Math.random().toString(36).substring(2, 9),
              timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
              text: `[VLM] ${vlmData.reasoning || `State updated to ${vlmData.agent_state}`}`,
              type: vlmData.agent_state === "PROGRESSING" ? "info" : "warn"
            };
            
            return {
              ...agent,
              state: vlmData.agent_state,
              confidence: vlmData.confidence_score || agent.confidence,
              reasoning: vlmData.reasoning,
              logs: [...agent.logs, newLog].slice(-20)
            };
          }
          return agent;
        }));
      }
    };

    ws.onclose = () => {
      console.log("Disconnected from Argus Server");
    };

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    // Scroll to bottom of logs for selected agent
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agents, selectedAgentId]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  const sendCommand = (action: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && selectedAgent) {
      const msg: Record<string, string> = { type: "command", agent_id: selectedAgent.id, action };
      if (action === "inject" && injectRef.current) {
        msg.content = injectRef.current.value;
        injectRef.current.value = "";
      }
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  return (
    <div className={`container ${styles.dashboard}`}>
      {/* Sidebar Navigation */}
      <aside className={`glass-panel ${styles.sidebar}`}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={`${styles.title} glow-text`}><Eye size={24} /> ARGUS</h1>
            <span className={styles.subtitle}>VLM Overseer Layer</span>
          </div>
          <div className={styles.statusIndicator}>
            <div className={styles.dot}></div>
            LIVE
          </div>
        </div>

        <div style={{ padding: '0 1rem' }}>
          <h3 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>ACTIVE AGENTS</h3>
          <div className={styles.activeAgentsList}>
            {agents.map(agent => (
              <div 
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={`${styles.agentListItem} ${selectedAgentId === agent.id ? styles.selected : ''} ${agent.state === 'DANGEROUS' ? styles.danger : ''} ${agent.state === 'STUCK' ? styles.warning : ''}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Cpu size={14} />
                  <span>{agent.id}</span>
                </div>
                {agent.state !== 'PROGRESSING' && (
                   <ShieldAlert size={14} className={agent.state === 'DANGEROUS' ? 'danger-text' : 'warning-text'} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Intervention Panel - Always controls selected agent */}
        {selectedAgent && (
          <div className={styles.interventionPanel} style={{ marginTop: 'auto' }}>
             <h3 className={styles.panelTitle}>
               <Shield size={16} />
               MANUAL OVERRIDE
             </h3>
             <div style={{ fontSize: '0.8rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between'}}>
                <span>Target: <span className="glow-text">{selectedAgent.id}</span></span>
             </div>
             <div className={styles.controls}>
               <button className={styles.btn} onClick={() => sendCommand("pause")}>
                 <Pause size={14} /> Pause
               </button>
               <button className={`${styles.btn} ${styles.danger}`} onClick={() => sendCommand("kill")}>
                 <XCircle size={14} /> Kill
               </button>
             </div>
             <div className={styles.promptArea}>
               <textarea
                 ref={injectRef}
                 className={styles.textarea}
                 placeholder={`Inject context or instructions to ${selectedAgent.id}...`}
               ></textarea>
               <button className={styles.btn} style={{ width: '100%' }} onClick={() => sendCommand("inject")}>
                 <Send size={14} /> Inject Prompt
               </button>
             </div>
          </div>
        )}
      </aside>

      {/* Main Grid Content */}
      <main className={styles.mainContent}>
         <div className={styles.agentGrid}>
           {agents.map(agent => (
             <div 
               key={agent.id} 
               className={`glass-panel ${styles.agentCard} ${agent.state === 'DANGEROUS' ? styles.cardDanger : ''} ${agent.state === 'STUCK' ? styles.cardWarning : ''}`}
             >
               {agent.state === 'DANGEROUS' && (
                 <div className={styles.overlayAlert}>
                   <ShieldAlert size={16} />
                   DANGEROUS BEHAVIOR DETECTED
                 </div>
               )}
               {agent.state === 'STUCK' && (
                 <div className={`${styles.overlayAlert} ${styles.warning}`}>
                   <Activity size={16} />
                   POSSIBLE LOOP DETECTED
                 </div>
               )}

               <div className={styles.agentHeader}>
                 <div className={styles.agentInfo}>
                   <Code size={16} />
                   <strong>{agent.name}</strong>
                 </div>
                 <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                   <span className="glow-text">{agent.confidence}% CONF</span>
                   <span className={`badge ${agent.state === 'DANGEROUS' ? styles.danger : agent.state === 'STUCK' ? styles.warning : ''}`}>
                     {agent.state}
                   </span>
                 </div>
               </div>
               
               <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                  <span>Task: {agent.task}</span>
               </div>

               {/* Mock Video Feed */}
               <div className={styles.visualFeed} style={{ position: 'relative', minHeight: '200px', backgroundColor: '#000', color: '#0f0', padding: '10px', overflow: 'hidden' }}>
                 {agent.ptyScreen ? (
                   <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.2' }}>
                     {agent.ptyScreen}
                   </pre>
                 ) : agent.frame ? (
                   <img 
                     src={`data:image/jpeg;base64,${agent.frame}`} 
                     alt={`Live feed of ${agent.id}`} 
                     style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                   />
                 ) : (
                   <div className={styles.visualPlaceholder}>
                     <Terminal size={32} opacity={0.5} />
                     <p>[ Waiting for PTY Camera Buffer: {agent.id} ]</p>
                   </div>
                 )}
                 {agent.state !== 'PROGRESSING' && (
                   <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(0,0,0,0.8)', padding: '0.5rem', border: '1px dashed currentColor', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', textAlign: 'center', backdropFilter: 'blur(5px)'}}>
                     <Activity size={24} className={agent.state === 'DANGEROUS' ? 'danger-text' : 'warning-text'} />
                     <span>VLM analysis triggered</span>
                     {agent.reasoning && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{agent.reasoning}</span>}
                   </div>
                 )}
               </div>

               {/* Terminal Feed */}
               <div className={styles.terminalFeed}>
                 {agent.logs.map(log => (
                   <div key={log.id} className={`${styles.logLine} ${styles[log.type]}`}>
                     <span style={{ opacity: 0.5, marginRight: '0.5rem' }}>[{log.timestamp}]</span>
                     {log.text}
                   </div>
                 ))}
                 <div ref={selectedAgentId === agent.id ? logsEndRef : null} />
               </div>
             </div>
           ))}
         </div>
      </main>
    </div>
  );
}
