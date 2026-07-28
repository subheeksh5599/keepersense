<div align="center">

[![Live Demo](https://img.shields.io/badge/demo-live-00ff4f?style=flat)](https://keepersense.vercel.app)
[![MCP Server](https://img.shields.io/badge/mcp-5_tools-00ff4f?style=flat)](https://github.com/subheeksh5599/keepersense)
[![License](https://img.shields.io/badge/license-MIT-00ff4f?style=flat)](LICENSE)
[![KeeperHub](https://img.shields.io/badge/KeeperHub-execution-14151a?style=flat)](https://keeperhub.com)
[![Hermes Agent](https://img.shields.io/badge/Hermes-agent-14151a?style=flat)](https://github.com/NousResearch/hermes-agent)

### The brain between agent intent and KeeperHub execution

</div>

KeeperSense is the intelligence layer that lets any AI agent execute onchain without knowing how KeeperHub works. An agent says what it wants in English — "protect my vault," "distribute rewards," "monitor this contract" — and KeeperSense discovers the right template, auto-configures every parameter, deploys the workflow, and returns a transaction hash. The agent never touches the workflow builder. 

Built with the Hermes Agent KeeperHub plugin. Five MCP tools. One pipeline. Real Sepolia transactions.

---

## Table of contents

- [See it in one command](#-see-it-in-one-command)
- [The problem KeeperSense solves](#the-problem-keepersense-solves)
- [How KeeperSense works](#how-keepersense-works)
- [Architecture](#architecture)
- [What's real vs pending](#whats-real-vs-pending)
- [Run it locally](#run-it-locally)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Tech stack](#tech-stack)
- [License](#license)

---

## ▶ See it in one command

```bash
# 1. Start the MCP server
cd server
KH_API_KEY=kh_... .venv/bin/python mcp_server.py

# 2. List available tools
curl -s -X POST http://localhost:8765 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | python3 -m json.tool

# 3. Discover workflows for an intent
curl -s -X POST http://localhost:8765 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ks_discover","arguments":{"intent":"protect my vault from liquidation"}}}' | python3 -m json.tool
```

---

## The problem KeeperSense solves

- **KeeperHub exposes 20+ MCP tools** but no intelligence layer. Agents see tools, not what to do with them.
- **Templates exist but can't be discovered autonomously.** Every integration requires a human to browse, evaluate, and configure.
- **Workflow parameters need onchain context.** Vault addresses, collateral thresholds, chain selection — agents don't know these without reading the chain.
- **No bridge between intent and execution.** KeeperHub's blog identified this gap in June 2026: "agents need a read layer and an execute layer." KeeperSense is the bridge.
- **Every builder reinvents the same pipeline.** Observe → decide → configure → execute → audit. KeeperSense makes it a single call.

---

## How KeeperSense works

**1· Agent expresses intent**
```
"protect my vault from liquidation on Aave V3"
```

**2· KeeperSense discovers matching templates**
Searches KeeperHub's template marketplace, scores each against the intent using keyword and semantic matching. Returns ranked results with confidence scores.

**3· KeeperSense configures parameters**
Reads onchain data via KeeperHub to auto-fill: vault address, collateral token, health factor threshold, notification channel. Any missing params are flagged.

**4· KeeperSense deploys the workflow**
Creates the workflow via KeeperHub's API with all parameters filled. Returns a workflow ID ready for execution.

**5· KeeperSense executes and audits**
Triggers execution, polls for the transaction hash, retrieves the full audit trail (trigger → simulate → submit → gas → outcome → timestamp). Returns everything the agent needs to prove the execution happened.

```python
# The agent's entire interaction:
result = await mcp.call("ks_discover", {"intent": "protect my vault"})
configured = await mcp.call("ks_configure", {"template_id": result["top_match"]["id"]})
deployed = await mcp.call("ks_deploy", {"template_id": configured["template_id"], "params": configured["configured_params"]})
executed = await mcp.call("ks_execute", {"workflow_id": deployed["workflow_id"]})
audit = await mcp.call("ks_status", {"run_id": executed["execution_id"]})
```

---

## Architecture

```
Hermes Agent
    │  natural language intent
    ▼
┌──────────────────────────────┐
│     KeeperSense MCP Server   │  ← we built this
│                              │
│  ks_discover()  ──────────┐  │
│  ks_configure() ───┐      │  │  template search + scoring
│  ks_deploy()      │      │  │  onchain param resolution
│  ks_execute()     │      │  │  workflow creation
│  ks_status()      │      │  │  audit trail polling
└────────────────────┼──────┼──┘
                     │      │
                     ▼      ▼
┌──────────────────────────────────┐
│       KeeperHub MCP Server       │  ← they provide this
│                                  │
│  /mcp/templates/search           │
│  /mcp/templates/:id              │
│  /mcp/workflows (POST)           │
│  /mcp/workflows/:id/execute      │
│  /mcp/executions/:id             │
└──────────────────┬───────────────┘
                   │
                   ▼
┌──────────────────────────────────┐
│         KeeperHub Engine         │
│                                  │
│  Gas estimation · Retry logic    │
│  Private routing · Nonce mgmt    │
│  Turnkey signing · Audit trail   │
└──────────────────┬───────────────┘
                   │
                   ▼
              Ethereum · Base · Arbitrum
              Polygon · Sepolia
```

| Component | Technology | Responsibility |
|---|---|---|
| Agent runtime | Hermes Agent | Natural language reasoning, intent formulation |
| KeeperSense MCP | Python + httpx + uvicorn | Intent-to-workflow bridge: discover, configure, deploy, execute, audit |
| KeeperHub MCP | KeeperHub HTTP API | Template marketplace, workflow management, execution engine |
| Frontend | Vite + React 18 | Single-page pipeline visualizer |
| Chains | Sepolia testnet | Transaction execution (mainnet available via gas sponsorship) |

---

## What's real vs pending

| Claim | Status |
|---|---|
| MCP server with 5 tools (discover/configure/deploy/execute/status) | ✅ Real |
| Template discovery with keyword scoring | ✅ Real |
| Parameter auto-configuration from onchain data | ✅ Real |
| Workflow deploy via KeeperHub API | ✅ Real |
| Execution with tx hash return | ✅ Real |
| Full audit trail (trigger→simulate→tx→gas→outcome) | ✅ Real |
| Real Sepolia transactions | ✅ Real |
| Frontend pipeline visualizer | ✅ Real |
| Retry demo (failed tx → gas adjust → success) | ⚠️ Pending — server supports retries, demo pending |
| x402 payment integration | ⚠️ Pending — API client built, live settlement pending |
| ERC-8004 agent identity registration | ⚠️ Pending — schema designed |
| Mainnet Ethereum gas sponsorship demo | ⚠️ Pending |

---

## Run it locally

```bash
# Clone
git clone https://github.com/subheeksh5599/keepersense
cd keepersense

# Backend
cd server
python3 -m venv .venv
.venv/bin/pip install httpx uvicorn
export KH_API_KEY=kh_...   # from app.keeperhub.com → Settings → API Keys
.venv/bin/python mcp_server.py

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Type an intent. Watch it execute.

---

## Configuration

```bash
# Required
KH_API_KEY=kh_...              # KeeperHub organisation API key

# Optional
PORT=8765                       # MCP server port (default: 8765)
KEEPERHUB_ENABLE_WRITES=true    # Enable write/execute tools
```

---

## Project layout

```
keepersense/
├── server/
│   ├── mcp_server.py          # MCP HTTP server with 5 tools
│   └── requirements.txt       # httpx, uvicorn
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Single-page pipeline UI
│   │   └── main.jsx           # React entry
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── README.md
└── LICENSE
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Agent framework | Hermes Agent |
| KeeperHub integration | KeeperHub Hermes Plugin |
| MCP server | Python 3.12, httpx, uvicorn |
| Frontend | Vite 5, React 18 |
| Execution | KeeperHub MCP (Sepolia) |
| Payments (pending) | x402 (Base USDC), MPP (Tempo USDC.e) |
| Identity (pending) | ERC-8004 |

---

## License

MIT
