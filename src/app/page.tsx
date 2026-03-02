"use client";

import { useEffect, useRef } from "react";
import { Activity, ShieldAlert, Pause, Play, XCircle, Send, Terminal, Cpu, Eye, Code, Shield, CircleStop, Square, Brain, Pin, PinOff } from "lucide-react";
import styles from "./page.module.css";
import { useAgentSocket } from "./useAgentSocket";

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL || "ws://localhost:8000";

export default function Dashboard() {
  const {
    agents,
    selectedAgentId,
    setSelectedAgentId,
    pinnedAgentId,
    setPinnedAgentId,
    selectedAgent,
    sendCommand,
    connected,
  } = useAgentSocket(`${HUB_URL}/ws/dashboard`);

  const pinnedAgents = agents.filter(a => a.id === pinnedAgentId);
  const unpinnedAgents = agents.filter(a => a.id !== pinnedAgentId);
  const isDense = agents.length > 6;

  const logsEndRef = useRef<HTMLDivElement>(null);
  const analysisEndRef = useRef<HTMLDivElement>(null);
  const injectRef = useRef<HTMLTextAreaElement>(null);
  const steerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    analysisEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
                  {agent.id === pinnedAgentId && (
                    <span className={styles.pinnedBadge}><Pin size={10} /></span>
                  )}
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
         <div className={`${styles.agentGrid} ${isDense ? styles.agentGridDense : ''}`}>
           {agents.length === 0 && (
             <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', gap: '1rem', gridColumn: '1 / -1' }}>
               <Terminal size={48} opacity={0.3} />
               <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>No agents connected</p>
               <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', opacity: 0.6 }}>Start a probe: bun run dev:probe</p>
             </div>
           )}
           {[...pinnedAgents, ...unpinnedAgents].map(agent => {
             const isPinned = agent.id === pinnedAgentId;
             const isCompact = isDense && !isPinned && agent.id !== selectedAgentId;
             return (
             <div
               key={agent.id}
               className={`glass-panel ${styles.agentCard} ${isPinned ? styles.agentCardPinned : ''} ${isCompact ? styles.agentCardCompact : ''} ${agent.state === 'DANGEROUS' ? styles.cardDanger : ''} ${agent.state === 'STUCK' ? styles.cardWarning : ''} ${agent.state === 'PAUSED' ? styles.cardPaused : ''} ${agent.state === 'EXITED' ? styles.cardExited : ''}`}
             >
               <div className={styles.agentHeader}>
                 <div className={styles.agentInfo}>
                   <Code size={16} />
                   <strong>{agent.name}</strong>
                   <button
                     className={`${styles.pinButton} ${isPinned ? styles.pinActive : ''}`}
                     onClick={(e) => { e.stopPropagation(); setPinnedAgentId(isPinned ? '' : agent.id); }}
                     title={isPinned ? 'Unpin agent' : 'Pin agent'}
                   >
                     {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                   </button>
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

               {isCompact && agent.vlmEvents.length > 0 && (() => {
                 const last = agent.vlmEvents[agent.vlmEvents.length - 1];
                 return (
                   <div className={styles.compactVerdict}>
                     <span className={styles.compactVerdictTime}>{last.timestamp}</span>
                     <span className={styles.compactVerdictText}>{last.reasoning.slice(0, 80)}{last.reasoning.length > 80 ? '...' : ''}</span>
                   </div>
                 );
               })()}

               {!isCompact && agent.state !== 'PROGRESSING' && (
                 <div className={styles.stateBanner} data-state={agent.state}>
                   {agent.state === 'DANGEROUS' && <><ShieldAlert size={14} /> DANGEROUS BEHAVIOR DETECTED</>}
                   {agent.state === 'HALLUCINATING' && <><ShieldAlert size={14} /> HALLUCINATION DETECTED</>}
                   {agent.state === 'STUCK' && <><Activity size={14} /> POSSIBLE LOOP DETECTED</>}
                   {agent.state === 'PAUSED' && <><Pause size={14} /> AGENT PAUSED BY OPERATOR</>}
                   {agent.state === 'EXITED' && <><CircleStop size={14} /> AGENT EXITED</>}
                 </div>
               )}

               {!isCompact && <div className={styles.dualFeed}>
                 {/* Left pane: visual preview + scrollable logs */}
                 <div className={styles.agentFeed}>
                   <div className={styles.visualPreview}>
                     {agent.ptyScreen ? (
                       <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '10px', lineHeight: '1.1', color: '#0f0', padding: '4px', width: '100%' }}>
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
                         <Terminal size={20} opacity={0.5} />
                         <p style={{ margin: 0, fontSize: '0.7rem' }}>[ Waiting for feed: {agent.id} ]</p>
                       </div>
                     )}
                   </div>
                   <div className={styles.previewDivider}>
                     <Terminal size={10} /> LOG FEED
                   </div>
                   <div className={styles.agentLogs}>
                     {agent.logs.map(log => (
                       <div key={log.id} className={`${styles.logLine} ${styles[log.type]}`}>
                         <span style={{ opacity: 0.5, marginRight: '0.5rem' }}>[{log.timestamp}]</span>
                         {log.text}
                       </div>
                     ))}
                     <div ref={selectedAgentId === agent.id ? logsEndRef : null} />
                   </div>
                 </div>

                 {/* Right pane: VLM analysis timeline */}
                 <div className={styles.analysisFeed}>
                   <div className={styles.analysisFeedHeader}>
                     <Brain size={12} opacity={0.5} />
                     <span>VLM ANALYSIS</span>
                   </div>
                   {agent.vlmEvents.length > 0 ? (
                     <>
                       {agent.vlmEvents.map(ev => (
                         <div
                           key={ev.id}
                           className={`${styles.vlmEvent} ${
                             ev.state === 'PROGRESSING' ? styles.vlmOk
                             : ev.state === 'DANGEROUS' || ev.state === 'HALLUCINATING' ? styles.vlmDanger
                             : styles.vlmWarning
                           } ${ev.tier === 'tier1' ? styles.vlmCompact : ''}`}
                         >
                           <div className={styles.vlmEventHeader}>
                             <span className={styles.vlmEventTier}>{ev.tier === 'tier1' ? '~' : '>'}</span>
                             <span className={styles.vlmEventTime}>{ev.timestamp}</span>
                             <span className={styles.vlmEventState} style={{
                               color: ev.state === 'PROGRESSING' ? 'var(--text-primary)'
                                 : ev.state === 'DANGEROUS' || ev.state === 'HALLUCINATING' ? 'var(--accent-danger)'
                                 : 'var(--accent-warning)'
                             }}>
                               {ev.state}
                             </span>
                             <span className={styles.vlmEventConf}>{ev.confidence}%</span>
                           </div>
                           {ev.tier === 'tier2' && (
                             <div className={styles.vlmEventReasoning}>{ev.reasoning}</div>
                           )}
                         </div>
                       ))}
                       <div ref={selectedAgentId === agent.id ? analysisEndRef : null} />
                     </>
                   ) : (
                     <div className={styles.analysisPlaceholder}>
                       <Brain size={24} opacity={0.3} />
                       <span>VLM analysis pending</span>
                     </div>
                   )}
                 </div>
               </div>}
             </div>
             );
           })}
         </div>
      </main>
    </div>
  );
}
