"use client";

import { useEffect, useRef } from "react";
import { Activity, ShieldAlert, Pause, Play, XCircle, Send, Terminal, Cpu, Eye, Code, Shield, CircleStop, Square } from "lucide-react";
import styles from "./page.module.css";
import { useAgentSocket } from "./useAgentSocket";

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL || "ws://localhost:8000";

export default function Dashboard() {
  const {
    agents,
    selectedAgentId,
    setSelectedAgentId,
    selectedAgent,
    sendCommand,
    connected,
  } = useAgentSocket(`${HUB_URL}/ws/dashboard`);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const injectRef = useRef<HTMLTextAreaElement>(null);
  const steerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agents, selectedAgentId]);

  const handleSendCommand = (action: string) => {
    if (action === "inject" && injectRef.current) {
      sendCommand(action, injectRef.current.value);
      injectRef.current.value = "";
    } else if (action === "stoprun" && selectedAgent?.telemetry) {
      sendCommand(action, selectedAgent.telemetry.runId);
    } else if (action === "steer" && steerRef.current) {
      sendCommand(action, steerRef.current.value);
      steerRef.current.value = "";
    } else {
      sendCommand(action);
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
            <div className={styles.dot} style={connected ? undefined : { backgroundColor: '#ff003c', boxShadow: '0 0 10px #ff003c' }}></div>
            {connected ? 'LIVE' : 'RECONNECTING'}
          </div>
        </div>

        <div style={{ padding: '0 1rem' }}>
          <h3 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>ACTIVE AGENTS</h3>
          <div className={styles.activeAgentsList}>
            {agents.map(agent => (
              <div
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={`${styles.agentListItem} ${selectedAgentId === agent.id ? styles.selected : ''} ${agent.state === 'DANGEROUS' ? styles.danger : ''} ${agent.state === 'STUCK' ? styles.warning : ''} ${agent.state === 'PAUSED' ? styles.paused : ''} ${agent.state === 'EXITED' ? styles.exited : ''}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Cpu size={14} />
                  <span>{agent.id}</span>
                </div>
                {agent.state !== 'PROGRESSING' && agent.state !== 'PAUSED' && agent.state !== 'EXITED' && (
                   <ShieldAlert size={14} className={agent.state === 'DANGEROUS' ? 'danger-text' : 'warning-text'} />
                )}
                {agent.state === 'PAUSED' && <Pause size={14} style={{ color: '#4a9eff' }} />}
                {agent.state === 'EXITED' && <Square size={14} style={{ color: '#666' }} />}
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
             {selectedAgent.telemetry && (
               <div className={styles.telemetryPanel}>
                 <div className={styles.telemetryRow}>
                   <span className={styles.telemetryLabel}>RUN</span>
                   <span className={styles.telemetryValue}>{selectedAgent.telemetry.runId}</span>
                 </div>
                 {selectedAgent.telemetry.toolName && (
                   <div className={styles.telemetryRow}>
                     <span className={styles.telemetryLabel}>TOOL</span>
                     <span className={styles.telemetryValue}>{selectedAgent.telemetry.toolName}</span>
                   </div>
                 )}
                 <div className={styles.telemetryRow}>
                   <span className={styles.telemetryLabel}>CTX</span>
                   <div className={styles.contextBar}>
                     <div
                       className={styles.contextFill}
                       style={{
                         width: `${selectedAgent.telemetry.contextPercent}%`,
                         backgroundColor: selectedAgent.telemetry.contextPercent > 80
                           ? 'var(--accent-danger)'
                           : selectedAgent.telemetry.contextPercent > 60
                           ? 'var(--accent-warning)'
                           : 'var(--text-primary)',
                       }}
                     />
                     <span className={styles.contextText}>
                       {selectedAgent.telemetry.contextPercent.toFixed(1)}%
                     </span>
                   </div>
                 </div>
               </div>
             )}
             <div className={styles.controls}>
               <button className={styles.btn} onClick={() => handleSendCommand("pause")}>
                 <Pause size={14} /> Pause
               </button>
               <button className={styles.btn} onClick={() => handleSendCommand("resume")}>
                 <Play size={14} /> Resume
               </button>
               <button className={`${styles.btn} ${styles.danger}`} onClick={() => handleSendCommand("kill")}>
                 <XCircle size={14} /> Kill
               </button>
             </div>
             <div className={styles.promptArea}>
               <textarea
                 ref={injectRef}
                 className={styles.textarea}
                 placeholder={`Inject context or instructions to ${selectedAgent.id}...`}
               ></textarea>
               <button className={styles.btn} style={{ width: '100%' }} onClick={() => handleSendCommand("inject")}>
                 <Send size={14} /> Inject Prompt
               </button>
             </div>
             {selectedAgent.telemetry && (
               <>
                 <div className={styles.controls}>
                   <button
                     className={`${styles.btn} ${styles.danger}`}
                     onClick={() => handleSendCommand("stoprun")}
                   >
                     <CircleStop size={14} /> Halt Run
                   </button>
                 </div>
                 <div className={styles.promptArea}>
                   <textarea
                     ref={steerRef}
                     className={styles.textarea}
                     placeholder={`Steer ${selectedAgent.id} (run: ${selectedAgent.telemetry.runId})...`}
                     style={{ height: '60px' }}
                   ></textarea>
                   <button className={styles.btn} style={{ width: '100%' }} onClick={() => handleSendCommand("steer")}>
                     <Send size={14} /> Steer Agent
                   </button>
                 </div>
               </>
             )}
          </div>
        )}
      </aside>

      {/* Main Grid Content */}
      <main className={styles.mainContent}>
         <div className={styles.agentGrid}>
           {agents.length === 0 && (
             <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', gap: '1rem', gridColumn: '1 / -1' }}>
               <Terminal size={48} opacity={0.3} />
               <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>No agents connected</p>
               <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', opacity: 0.6 }}>Start a probe: bun run dev:probe</p>
             </div>
           )}
           {agents.map(agent => (
             <div
               key={agent.id}
               className={`glass-panel ${styles.agentCard} ${agent.state === 'DANGEROUS' ? styles.cardDanger : ''} ${agent.state === 'STUCK' ? styles.cardWarning : ''} ${agent.state === 'PAUSED' ? styles.cardPaused : ''} ${agent.state === 'EXITED' ? styles.cardExited : ''}`}
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
               {agent.state === 'PAUSED' && (
                 <div className={`${styles.overlayAlert} ${styles.pausedAlert}`}>
                   <Pause size={16} />
                   AGENT PAUSED BY OPERATOR
                 </div>
               )}
               {agent.state === 'EXITED' && (
                 <div className={`${styles.overlayAlert} ${styles.exitedAlert}`}>
                   <CircleStop size={16} />
                   AGENT EXITED
                 </div>
               )}

               <div className={styles.agentHeader}>
                 <div className={styles.agentInfo}>
                   <Code size={16} />
                   <strong>{agent.name}</strong>
                 </div>
                 <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                   {agent.telemetry && (
                     <span className={styles.telemetryBadge} style={{
                       color: agent.telemetry.contextPercent > 80 ? 'var(--accent-danger)'
                            : agent.telemetry.contextPercent > 60 ? 'var(--accent-warning)'
                            : 'var(--text-muted)'
                     }}>
                       CTX {agent.telemetry.contextPercent.toFixed(0)}%
                     </span>
                   )}
                   <span className="glow-text">{agent.confidence}% CONF</span>
                   <span className={`badge ${agent.state === 'DANGEROUS' ? styles.danger : agent.state === 'STUCK' ? styles.warning : agent.state === 'PAUSED' ? styles.paused : agent.state === 'EXITED' ? styles.exited : ''}`}>
                     {agent.state}
                   </span>
                 </div>
               </div>

               <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                  <span>Task: {agent.task}</span>
               </div>

               {/* Visual Feed */}
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
                 {(agent.state === 'STUCK' || agent.state === 'DANGEROUS' || agent.state === 'HALLUCINATING') && (
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
