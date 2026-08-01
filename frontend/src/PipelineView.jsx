import React, { useState, useCallback } from 'react';

const MCP_URL = '/api';

const STEP_COLORS = {
  discover: '#0066FF',
  configure: '#D97706',
  deploy: '#7C3AED',
  execute: '#BE185D',
  audit: '#22C55E',
  complete: '#22C55E',
  error: '#DC2626',
};

async function callMCP(tool, args) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const content = data.result?.content?.[0]?.text;
  return content ? JSON.parse(content) : data.result;
}

function LogLine({ label, data, color }) {
  return (
    <div className="pl-log" style={{ borderLeftColor: color }}>
      <span className="pl-log-label" style={{ color }}>{label}</span>
      <pre className="pl-log-body">
        {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default function PipelineView() {
  const [intent, setIntent] = useState('');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);
  const [matches, setMatches] = useState(null);
  const [selected, setSelected] = useState(null);

  const addLog = useCallback((label, data, color) => {
    setLogs(prev => [...prev, { label, data, color, ts: Date.now() }]);
  }, []);

  const discover = useCallback(async () => {
    if (!intent.trim() || running) return;
    setRunning(true);
    setLogs([]);
    setTxHash(null);
    setError(null);
    setMatches(null);
    setSelected(null);

    try {
      // Step 1: Discover
      addLog('discover', `Searching workflows for: "${intent}"`, STEP_COLORS.discover);
      const discovered = await callMCP('ks_discover', { intent });
      if (discovered.error) throw new Error(discovered.error);
      addLog('discover result', discovered, STEP_COLORS.discover);

      if (!discovered.matches || discovered.matches.length === 0) {
        throw new Error('No matching workflow found. Try a different intent.');
      }
      setMatches(discovered.matches);
      setSelected(discovered.top_match || discovered.matches[0]);
    } catch (e) {
      setError(e.message);
      addLog('error', e.message, STEP_COLORS.error);
    } finally {
      setRunning(false);
    }
  }, [intent, running, addLog]);

  const executeSelected = useCallback(async (match) => {
    if (running || !match) return;
    setRunning(true);
    setError(null);

    try {
      // Step 2: Configure
      addLog('configure', `Configuring "${match.name}" (score: ${match.score})`, STEP_COLORS.configure);
      const configured = await callMCP('ks_configure', { workflow_id: match.id });
      if (configured.error) throw new Error(configured.error);
      addLog('configure result', configured, STEP_COLORS.configure);

      const deployParams = configured.configured_params || {};

      // Step 3: Deploy (clone the matched workflow)
      addLog('deploy', 'Deploying workflow to KeeperHub...', STEP_COLORS.deploy);
      const deployed = await callMCP('ks_deploy', {
        source_workflow_id: match.id,
        chain: 'sepolia',
      });
      if (deployed.error) throw new Error(deployed.error);
      addLog('deploy result', deployed, STEP_COLORS.deploy);

      // Step 4: Execute
      addLog('execute', `Executing workflow ${deployed.workflow_id}...`, STEP_COLORS.execute);
      const executed = await callMCP('ks_execute', {
        workflow_id: deployed.workflow_id,
        input: deployParams,
        chain: 'sepolia',
      });
      if (executed.error) throw new Error(executed.error);
      addLog('execute result', executed, STEP_COLORS.execute);

      if (executed.tx_hash) {
        setTxHash(executed.tx_hash);
      }

      // Step 5: Status / Audit
      if (executed.execution_id || executed.run_id) {
        addLog('audit', 'Polling execution status...', STEP_COLORS.audit);
        const status = await callMCP('ks_status', { execution_id: executed.execution_id || executed.run_id });
        if (!status.error) {
          addLog('audit trail', status, STEP_COLORS.audit);
        }
      }

      addLog('complete', 'Pipeline finished. KeeperHub executed onchain.', STEP_COLORS.complete);

    } catch (e) {
      setError(e.message);
      addLog('error', e.message, STEP_COLORS.error);
    } finally {
      setRunning(false);
    }
  }, [running, addLog]);

  return (
    <div className="pipeline">
      <div className="noise" />
      <div className="grid-lines">
        <div className="gl-inner">
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>

      <header className="header">
        <div className="h-inner">
          <nav className="h-nav">
            <a href="#/">← Landing</a>
            <a href="#tools" onClick={() => { window.location.hash = '#/'; }}>Tools</a>
          </nav>
          <div className="h-logo">
            <span className="serif-i">Keeper</span>
            <span style={{ fontWeight: 900 }}>SENSE</span>
          </div>
          <a className="h-cta" href="https://github.com/subheeksh5599/keepersense" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
        </div>
      </header>

      <main className="pl-main">
        <div className="container">
          <div className="pl-head">
            <div className="label" style={{ color: 'var(--zinc-500)' }}>Pipeline · Sepolia</div>
            <h1 className="pl-title">
              Intent <span className="serif-i">to</span> execution
            </h1>
            <p className="pl-sub mono" style={{ color: 'var(--zinc-500)' }}>
              AGENT SAYS WHAT · KEEPERHUB DOES IT · TX HASH PROVES IT
            </p>
          </div>

          <div className="pl-card">
            <div className="pl-row">
              <input
                className="pl-input"
                placeholder='What do you want to do onchain? e.g. "transfer 0.001 eth to my wallet"'
                value={intent}
                onChange={e => setIntent(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && discover()}
                disabled={running}
              />
              <button
                className="btn-start"
                onClick={discover}
                disabled={running || !intent.trim()}
                style={{ opacity: running ? 0.5 : 1, cursor: running ? 'wait' : 'pointer' }}
              >
                {running ? 'Running...' : matches ? 'Search again' : 'Execute'}
                {!running && <span className="arr">↗</span>}
              </button>
            </div>

            {matches && !running && (
              <div className="pl-pick">
                <div className="pl-pick-head">
                  <span className="label" style={{ color: 'var(--zinc-500)' }}>
                    Select workflow — {matches.length} matches
                  </span>
                  <span className="mono" style={{ color: 'var(--zinc-400)' }}>click to run</span>
                </div>
                {matches.map((m) => (
                  <button
                    key={m.id}
                    className={`pl-match${selected && selected.id === m.id ? ' sel' : ''}`}
                    onClick={() => executeSelected(m)}
                  >
                    <span className="pl-match-score mono">{m.score.toFixed(1)}</span>
                    <span className="pl-match-name">{m.name}</span>
                    <span className="pl-match-chain mono">{m.chain}</span>
                    <span className="pl-match-go">Execute ↗</span>
                  </button>
                ))}
              </div>
            )}

            {error && (
              <div className="pl-error">
                <span className="label" style={{ color: '#DC2626', display: 'block', marginBottom: 6 }}>Error</span>
                {error}
              </div>
            )}

            {txHash && (
              <div className="pl-success">
                <span className="label" style={{ color: 'var(--zinc-500)' }}>Tx</span>
                <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener">
                  {txHash}
                </a>
                <span className="pl-badge">Onchain</span>
              </div>
            )}

            {logs.length > 0 && (
              <div className="pl-logs">
                {logs.map((log, i) => (
                  <LogLine key={i} label={log.label} data={log.data} color={log.color} />
                ))}
              </div>
            )}
          </div>

          <div className="pl-foot">
            <span className="mono">KEEPERHUB API · app.keeperhub.com/api</span>
            <span className="mono">5 TOOLS · 1 PIPELINE · AUDIT TRAIL</span>
          </div>
        </div>
      </main>
    </div>
  );
}
