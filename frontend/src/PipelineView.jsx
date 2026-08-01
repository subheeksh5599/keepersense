import React, { useState, useCallback, useEffect, useRef } from 'react';

const MCP_URL = '/api';

// Chain is config, not hardcoded: override with VITE_CHAIN at build time
// (see .env.example). The server resolves the explorer URL per chain.
// Guarded access so the module also works outside Vite's bundler (SSR/tests).
const CHAIN = (
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CHAIN) ||
  'sepolia'
).toLowerCase();

const EXPLORERS = {
  ethereum: 'https://etherscan.io/tx/',
  sepolia: 'https://sepolia.etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  'base-sepolia': 'https://sepolia.basescan.org/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
};

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

function LogLine({ label, summary, raw, color }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="pl-log" style={{ borderLeftColor: color }}>
      <div className="pl-log-head">
        <span className="label" style={{ color }}>{label}</span>
        {raw !== undefined && raw !== null && (
          <button
            className="pl-log-toggle mono"
            onClick={() => setShowRaw(v => !v)}
            style={{ color }}
          >
            {showRaw ? 'hide json' : 'show json'}
          </button>
        )}
      </div>
      <pre className="pl-log-body">{summary}</pre>
      {showRaw && (
        <pre className="pl-log-raw">
          {typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function PipelineView() {
  const [intent, setIntent] = useState('');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | picking | running | done
  const [logs, setLogs] = useState([]);
  const [txHash, setTxHash] = useState(null);
  const [txUrl, setTxUrl] = useState(null);
  const [error, setError] = useState(null);
  const [matches, setMatches] = useState(null);
  const [selected, setSelected] = useState(null);
  const [lastRun, setLastRun] = useState(null); // {workflow_id, params} for retry
  const successRef = useRef(null);

  useEffect(() => {
    if (txHash && successRef.current) {
      successRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [txHash]);

  const addLog = useCallback((label, summary, raw, color) => {
    setLogs(prev => [...prev, { label, summary, raw, color, ts: Date.now() }]);
  }, []);

  // Steps 4-5: execute a deployed workflow, then pull the audit trail.
  const executeAndAudit = useCallback(async (workflowId, params) => {
    addLog('execute', `Executing workflow ${workflowId}...`, null, STEP_COLORS.execute);
    const executed = await callMCP('ks_execute', {
      workflow_id: workflowId,
      input: params,
      chain: CHAIN,
    });
    if (executed.error) throw new Error(executed.error);
    addLog(
      'execute result',
      `Status: ${executed.status}` +
        (executed.tx_hash ? ` — tx ${executed.tx_hash.slice(0, 18)}…` : '') +
        (executed.retries ? ` · retries: ${executed.retries}` : ''),
      executed,
      STEP_COLORS.execute
    );

    if (executed.tx_hash) {
      setTxHash(executed.tx_hash);
      setTxUrl(
        executed.explorer_url ||
        (EXPLORERS[CHAIN] || EXPLORERS.ethereum) + executed.tx_hash
      );
    }

    if (executed.execution_id || executed.run_id) {
      addLog('audit', 'Polling execution status...', null, STEP_COLORS.audit);
      const status = await callMCP('ks_status', { execution_id: executed.execution_id || executed.run_id });
      if (!status.error) {
        addLog(
          'audit trail',
          `Audit trail retrieved — ${status.status || 'n/a'}` +
            (status.tx_hash ? ` · tx ${status.tx_hash.slice(0, 18)}…` : ''),
          status,
          STEP_COLORS.audit
        );
      }
    }
  }, [addLog]);

  // Retry a failed execution on the SAME deployed workflow (gas/transient failures).
  const retryExecution = useCallback(async () => {
    if (running || !lastRun) return;
    setRunning(true);
    setPhase('running');
    setError(null);
    try {
      addLog('retry', `Retrying execution of ${lastRun.workflow_id}...`, STEP_COLORS.execute);
      await executeAndAudit(lastRun.workflow_id, lastRun.params || {});
      addLog('complete', 'Pipeline finished. KeeperHub executed onchain.', null, STEP_COLORS.complete);
    } catch (e) {
      setError(e.message);
      addLog('error', e.message, null, STEP_COLORS.error);
    } finally {
      setRunning(false);
      setPhase('done');
    }
  }, [running, lastRun, addLog, executeAndAudit]);

  const discover = useCallback(async () => {
    if (!intent.trim() || running) return;
    setRunning(true);
    setPhase('running');
    setLogs([]);
    setTxHash(null);
    setTxUrl(null);
    setError(null);
    setMatches(null);
    setSelected(null);

    try {
      // Step 1: Discover
      addLog('discover', `Searching workflows for: "${intent}"`, null, STEP_COLORS.discover);
      const discovered = await callMCP('ks_discover', { intent });
      if (discovered.error) throw new Error(discovered.error);
      const top = discovered.top_match || (discovered.matches || [])[0];
      addLog(
        'discover result',
        `Found ${(discovered.matches || []).length} matching workflows` +
          (top ? ` — top: "${top.name}" (score ${top.score}, ${top.chain})` : '') +
          (discovered.filtered_paid_count
            ? ` · ${discovered.filtered_paid_count} paid/premium hidden`
            : ''),
        discovered,
        STEP_COLORS.discover
      );

      if (!discovered.matches || discovered.matches.length === 0) {
        throw new Error('No matching workflow found. Try a different intent.');
      }
      setMatches(discovered.matches);
      setSelected(discovered.top_match || discovered.matches[0]);
      setPhase('picking');
    } catch (e) {
      setError(e.message);
      addLog('error', e.message, STEP_COLORS.error);
      setPhase('done');
    } finally {
      setRunning(false);
    }
  }, [intent, running, addLog]);

  const executeSelected = useCallback(async (match) => {
    if (running || !match) return;
    setRunning(true);
    setPhase('running');
    setError(null);

    try {
      // Step 2: Configure
      addLog('configure', `Configuring "${match.name}" (score: ${match.score})`, null, STEP_COLORS.configure);
      const configured = await callMCP('ks_configure', { workflow_id: match.id });
      if (configured.error) throw new Error(configured.error);
      const missing = configured.missing_params || [];
      const onchain = configured.onchain || null;
      addLog(
        'configure result',
        `"${configured.workflow_name || match.name}" configured — ` +
          (missing.length === 0
            ? 'all inputs resolved, ready to deploy'
            : `missing inputs: ${missing.join(', ')}`) +
          (onchain && onchain.reads && onchain.reads.wallet_balance_eth
            ? ` · chain read: balance ${onchain.reads.wallet_balance_eth} ETH`
            : ''),
        configured,
        STEP_COLORS.configure
      );

      const deployParams = configured.configured_params || {};

      // Step 3: Deploy (clone the matched workflow)
      addLog('deploy', 'Deploying workflow to KeeperHub...', null, STEP_COLORS.deploy);
      const deployed = await callMCP('ks_deploy', {
        source_workflow_id: match.id,
        chain: CHAIN,
      });
      if (deployed.error) throw new Error(deployed.error);
      addLog(
        'deploy result',
        `Deployed "${deployed.workflow_name || match.name}" — id ${deployed.workflow_id} · ${deployed.chain || CHAIN}`,
        deployed,
        STEP_COLORS.deploy
      );

      // Step 4-5: Execute + audit (shared with retry)
      setLastRun({ workflow_id: deployed.workflow_id, params: deployParams });
      await executeAndAudit(deployed.workflow_id, deployParams);

      addLog('complete', 'Pipeline finished. KeeperHub executed onchain.', null, STEP_COLORS.complete);

    } catch (e) {
      setError(e.message);
      addLog('error', e.message, null, STEP_COLORS.error);
    } finally {
      setRunning(false);
      setPhase('done');
    }
  }, [running, addLog, executeAndAudit]);

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
            <div className="label" style={{ color: 'var(--zinc-500)' }}>Pipeline · {CHAIN}</div>
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
                {running ? 'Running...' : phase !== 'idle' ? 'Search again' : 'Execute'}
                {!running && <span className="arr">↗</span>}
              </button>
            </div>

            {phase === 'picking' && (
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

            {phase === 'done' && (
              <div className="pl-done">
                <span className="label" style={{ color: 'var(--zinc-500)' }}>
                  Run finished — results below
                </span>
                <span className="mono" style={{ color: 'var(--zinc-400)' }}>search again to start over</span>
              </div>
            )}

            {error && (
              <div className="pl-error">
                <span className="label" style={{ color: '#DC2626', display: 'block', marginBottom: 6 }}>Error</span>
                <span className="mono" style={{ color: 'var(--zinc-600)' }}>{error}</span>
                {lastRun && (
                  <button
                    className="pl-retry"
                    onClick={retryExecution}
                    disabled={running}
                    style={{ marginTop: 10, opacity: running ? 0.5 : 1, cursor: running ? 'wait' : 'pointer' }}
                  >
                    {running ? 'Retrying...' : 'Retry execution ↗'}
                  </button>
                )}
              </div>
            )}

            {txHash && (
              <div className="pl-success" ref={successRef}>
                <span className="label" style={{ color: 'var(--zinc-500)' }}>Tx</span>
                <a href={txUrl} target="_blank" rel="noopener">
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
