import React, { useState, useCallback } from 'react';

const MCP_URL = '/api';

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

function LogLine({ label, data, color = '#4ade80' }) {
  return (
    <div style={{ padding: '8px 12px', borderLeft: `3px solid ${color}`, marginBottom: 6, background: 'rgba(255,255,255,0.02)', borderRadius: 4 }}>
      <span style={{ color, fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
      <pre style={{ margin: '4px 0 0', fontSize: 12, color: '#a1a1aa', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default function App() {
  const [intent, setIntent] = useState('');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const addLog = useCallback((label, data, color) => {
    setLogs(prev => [...prev, { label, data, color, ts: Date.now() }]);
  }, []);

  const run = useCallback(async () => {
    if (!intent.trim() || running) return;
    setRunning(true);
    setLogs([]);
    setTxHash(null);
    setError(null);

    try {
      // Step 1: Discover
      addLog('discover', `Searching templates for: "${intent}"`, '#60a5fa');
      const discovered = await callMCP('ks_discover', { intent });
      if (discovered.error) throw new Error(discovered.error);
      addLog('discover result', discovered, '#60a5fa');

      const top = discovered.top_match;
      if (!top) throw new Error('No matching template found. Try a different intent.');

      // Step 2: Configure
      addLog('configure', `Configuring "${top.name}" (score: ${top.score})`, '#f59e0b');
      const configured = await callMCP('ks_configure', { template_id: top.id });
      if (configured.error) throw new Error(configured.error);
      addLog('configure result', configured, '#f59e0b');

      // Step 3: Deploy
      addLog('deploy', 'Deploying workflow to KeeperHub...', '#a78bfa');
      const deployParams = configured.configured_params || {};
      const deployed = await callMCP('ks_deploy', {
        template_id: top.id,
        params: deployParams,
        chain: 'sepolia',
      });
      if (deployed.error) throw new Error(deployed.error);
      addLog('deploy result', deployed, '#a78bfa');

      // Step 4: Execute
      addLog('execute', `Executing workflow ${deployed.workflow_id}...`, '#f472b6');
      const executed = await callMCP('ks_execute', { workflow_id: deployed.workflow_id });
      if (executed.error) throw new Error(executed.error);
      addLog('execute result', executed, '#f472b6');

      if (executed.tx_hash) {
        setTxHash(executed.tx_hash);
      }

      // Step 5: Status / Audit
      if (executed.execution_id || executed.run_id) {
        addLog('audit', 'Polling execution status...', '#4ade80');
        const status = await callMCP('ks_status', { run_id: executed.execution_id || executed.run_id });
        if (!status.error) {
          addLog('audit trail', status, '#4ade80');
        }
      }

      addLog('complete', 'Pipeline finished. KeeperHub executed onchain.', '#22c55e');

    } catch (e) {
      setError(e.message);
      addLog('error', e.message, '#ef4444');
    } finally {
      setRunning(false);
    }
  }, [intent, running, addLog]);

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>KeeperSense</h1>
          <p style={styles.subtitle}>Intent → Execution. Agent says what, KeeperHub does it.</p>
        </div>

        <div style={styles.inputRow}>
          <input
            style={styles.input}
            placeholder='What do you want to do onchain? e.g. "protect my vault from liquidation"'
            value={intent}
            onChange={e => setIntent(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            disabled={running}
          />
          <button
            style={{ ...styles.button, opacity: running ? 0.5 : 1 }}
            onClick={run}
            disabled={running || !intent.trim()}
          >
            {running ? 'Running...' : 'Execute'}
          </button>
        </div>

        {error && (
          <div style={styles.error}>
            {error}
          </div>
        )}

        {txHash && (
          <div style={styles.success}>
            <span>Tx: </span>
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener"
              style={styles.link}
            >
              {txHash.slice(0, 10)}...{txHash.slice(-8)}
            </a>
            <span style={{ marginLeft: 12, fontSize: 12, color: '#22c55e' }}>✓ Onchain</span>
          </div>
        )}

        {logs.length > 0 && (
          <div style={styles.logs}>
            {logs.map((log, i) => (
              <LogLine key={i} label={log.label} data={log.data} color={log.color} />
            ))}
          </div>
        )}

        <div style={styles.footer}>
          <span>Powered by KeeperHub MCP · Sepolia Testnet</span>
          <span>Hermes Agent · KeeperHub Plugin</span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#0a0a0a',
    color: '#ebebe5',
    fontFamily: "'Inter', -apple-system, sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 720,
    background: '#141414',
    border: '1px solid #2a2a2a',
    borderRadius: 12,
    padding: '32px 28px',
  },
  header: {
    marginBottom: 28,
    textAlign: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 700,
    color: '#00ff4f',
    margin: 0,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 14,
    color: '#71717a',
    marginTop: 6,
  },
  inputRow: {
    display: 'flex',
    gap: 10,
    marginBottom: 20,
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    fontSize: 14,
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: 8,
    color: '#ebebe5',
    outline: 'none',
  },
  button: {
    padding: '12px 24px',
    background: '#00ff4f',
    color: '#0a0a0a',
    border: 'none',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  error: {
    padding: '12px 16px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8,
    color: '#ef4444',
    fontSize: 14,
    marginBottom: 16,
    fontFamily: 'monospace',
  },
  success: {
    padding: '12px 16px',
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 16,
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
  link: {
    color: '#60a5fa',
    textDecoration: 'none',
  },
  logs: {
    marginBottom: 20,
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#3f3f46',
    borderTop: '1px solid #1f1f1f',
    paddingTop: 16,
  },
};
