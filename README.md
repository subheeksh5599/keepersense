<div align="center">

[![MCP Server](https://img.shields.io/badge/mcp-5_tools-00ff4f?style=flat)](https://github.com/subheeksh5599/zenith)
[![License](https://img.shields.io/badge/license-MIT-00ff4f?style=flat)](LICENSE)
[![KeeperHub](https://img.shields.io/badge/KeeperHub-execution-14151a?style=flat)](https://keeperhub.com)
[![Hermes Agent](https://img.shields.io/badge/Hermes-agent-14151a?style=flat)](https://github.com/NousResearch/hermes-agent)

### The brain between agent intent and KeeperHub execution

</div>

Zenith is the intelligence layer that lets any AI agent execute onchain without knowing how KeeperHub works. An agent says what it wants in English — "protect my vault," "distribute rewards," "monitor this contract" — and Zenith discovers the right workflow, auto-configures every parameter from its input schema, deploys a workflow instance, executes it, and returns the transaction hash plus the full audit trail. The agent never touches the workflow builder.

Built with the Hermes Agent KeeperHub plugin. Five MCP tools. One pipeline.

**Live onchain — executed through KeeperHub (Sepolia):**

| Tx | Hash | Explorer |
|---|---|---|
| Direct transfer (0.001 ETH) | `0x8a9dc43e…b6768dd` | https://sepolia.etherscan.io/tx/0x8a9dc43e09d9023f7d61f5f17808f846e2fc9dec2c4f5740b81c112b2f6768dd |
| Full Zenith pipeline (configure → deploy → execute → audit) | `0xb461d675…f9842d9` | https://sepolia.etherscan.io/tx/0xb461d6750a1c2d47eb68e1ffcb2b577cf7869b56d54a4bd3ad5005b69f9842d9 |
| Pipeline via the live deployment (zenithagent.vercel.app → /api) | `0xadcc65a1…4005ee` | https://sepolia.etherscan.io/tx/0xadcc65a125de3a0a1a6a379d093db8f9ed2969f2845dfe683f581016934005ee |
| Pipeline transfer to the demo recipient wallet (0xc143…2957) | `0x89c3e7d6…8fabdd` | https://sepolia.etherscan.io/tx/0x89c3e7d670045dfc36be5a55e037cb7861456cd5199a8d19c72d33e04b8fabdd |
| Retry demo: failed attempt (999 ETH) → adjusted → success | `0xccb87e52…c703d` | https://sepolia.etherscan.io/tx/0xccb87e52bdcfda6d5c8c0fadcd5fe6db875e9b08a625b0e01ecf75c134cc703d |
| Direct org-workflow execution (source demo transfer) | `0xb942c4a8…97c7f` | https://sepolia.etherscan.io/tx/0xb942c4a8d9ef00209b2dbf4009e9330f898908d7db1b93cddffee121de297c7f |

---

## Table of contents

- [See it in one command](#see-it-in-one-command)
- [The problem Zenith solves](#the-problem-zenith-solves)
- [How Zenith works](#how-zenith-works)
- [Architecture](#architecture)
- [What's real vs pending](#whats-real-vs-pending)
- [Run it locally](#run-it-locally)
- [Verify it works](#verify-it-works)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Tech stack](#tech-stack)
- [License](#license)

---

## See it in one command

```bash
# 1. Start the MCP server (execution tools need KH_API_KEY — see Configuration)
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

Until `KH_API_KEY` is set, the tools return a structured `kh_api_key_not_set` error with a hint and docs link — nothing crashes, and the agent can fail gracefully.

---

## The problem Zenith solves

- **KeeperHub exposes 20+ MCP tools** but no intelligence layer. Agents see tools, not what to do with them.
- **Workflows exist but can't be discovered autonomously.** Every integration requires a human to browse, evaluate, and configure.
- **Workflow inputs need context.** Recipient addresses, amounts, thresholds, chain selection — agents don't know these without reading the schema and the chain.
- **No bridge between intent and execution.** KeeperHub's blog identified this gap in June 2026: "agents need a read layer and an execute layer." Zenith is the bridge.
- **Every builder reinvents the same pipeline.** Observe → decide → configure → execute → audit. Zenith makes it a single call.

---

## How Zenith works

**1· Agent expresses intent**
```
"protect my vault from liquidation on Aave V3"
```

**2· Zenith discovers matching workflows**
Searches KeeperHub's workflow API (`GET /api/workflows/public`), scores each against the intent using keyword and semantic matching. Returns ranked results with confidence scores.

**3· Zenith configures parameters**
Fetches the workflow's `inputSchema` and auto-fills defaults, flagging any required parameters the agent must supply.

**4· Zenith deploys the workflow**
Clones the matched workflow (`POST /api/workflows/{id}/duplicate`), returning a new workflow ID ready for execution.

**5· Zenith executes and audits**
Triggers execution (`POST /api/workflows/{id}/execute`), polls until terminal state, retries on failure, then retrieves the full audit trail (`status` + `logs`): trigger → simulate → submit → gas → outcome → timestamp. Returns everything the agent needs to prove the execution happened.

```python
# The agent's entire interaction:
result = await mcp.call("ks_discover", {"intent": "protect my vault"})
configured = await mcp.call("ks_configure", {"workflow_id": result["top_match"]["id"]})
deployed = await mcp.call("ks_deploy", {"source_workflow_id": configured["workflow_id"]})
executed = await mcp.call("ks_execute", {"workflow_id": deployed["workflow_id"], "input": configured["configured_params"]})
audit = await mcp.call("ks_status", {"execution_id": executed["execution_id"]})
```

---

## Architecture

```
Hermes Agent
    │  natural language intent
    ▼
┌──────────────────────────────┐
│     Zenith MCP Server   │  ← we built this
│                              │
│  ks_discover()  ──────────┐  │
│  ks_configure() ───┐      │  │  workflow search + scoring
│  ks_deploy()      │      │  │  input schema resolution
│  ks_execute()     │      │  │  workflow cloning + execution
│  ks_status()      │      │  │  audit trail polling
└────────────────────┼──────┼──┘
                     │      │
                     ▼      ▼
┌──────────────────────────────────┐
│        KeeperHub API             │  ← they provide this
│  https://app.keeperhub.com/api   │
│                                  │
│  GET  /workflows/public          │
│  GET  /workflows/{id}            │
│  POST /workflows/{id}/duplicate  │
│  POST /workflows/{id}/execute    │
│  GET  /workflows/executions/{id} │
│       /status · /logs            │
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
| Zenith MCP | Python + httpx + uvicorn | Intent-to-workflow bridge: discover, configure, deploy, execute, audit |
| KeeperHub API | `app.keeperhub.com/api` (Bearer `kh_` key) | Workflow registry, execution engine, audit logs |
| Frontend | Vite + React 18 | Single-page pipeline visualizer |
| Chains | Sepolia testnet | Transaction execution (mainnet available via gas sponsorship) |

---

## What's real vs pending

| Claim | Status |
|---|---|
| MCP server with 5 tools (discover/configure/deploy/execute/status) | ✅ Real |
| Workflow discovery with keyword scoring | ✅ Real (against `/api/workflows/public`) |
| Parameter auto-configuration from the workflow `inputSchema` (defaults + required flags) | ✅ Real |
| Workflow deploy via clone (`/duplicate`) | ✅ Real — verified live (deployed clone `8tb5p6…cufi`) |
| Execution with tx hash return + retry-on-failure loop | ✅ Real — verified live (tx `0xb461d675…f9842d9`) |
| Audit trail retrieval (`status` + `logs`) | ✅ Real — verified live |
| Unit tests (14) for scoring/schema/tx-extraction logic | ✅ Real |
| Real Sepolia transactions | ✅ Real — see the live-execution table at the top (6 txs, all confirmed on-chain) |
| Live demo deployment (zenithagent.vercel.app) | ✅ Real — landing + pipeline + /api proxy all live, verified end-to-end (3rd tx executed through it) |
| Onchain param resolution (reads chain data to fill inputs) | ✅ Real — ks_configure reads live chain state (eth_getBalance / eth_blockNumber) and caps transfer amounts by wallet balance |
| Retry demo (failed tx → adjust → success) | ✅ Real — executed live: 999 ETH attempt failed (retry loop fired, 3 attempts), amount fixed → success tx `0xccb87e52…c703d` |
| x402 / MPP payment integration | ✅ Code complete — `ks_pay` implements the x402 flow; activates when the agentic wallet is configured (x402/README.md) |
| ERC-8004 agent identity registration | ✅ Implemented — `ks_identity` (config-gated); KeeperHub exposes no identity API, so registration runs via contract-call when `KEEPERHUB_IDENTITY_REGISTRY` is set |
| Free-tier only (no paid-plan errors) | ✅ Real — discovery returns org workflows only by default (marketplace workflows 402/404 on the free plan); `paid_plan_required` errors are structured and explain why |
| Mainnet Ethereum gas sponsorship demo | ⚠️ Pending |

---

## Run it locally

```bash
# Clone
git clone https://github.com/subheeksh5599/zenith
cd zenith

# Backend
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
export KH_API_KEY=kh_...   # from app.keeperhub.com → Settings → API Keys
.venv/bin/python mcp_server.py

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Type an intent. Watch it execute.

## Verify it works

```bash
# Unit tests (no network, no key needed)
cd server
.venv/bin/python test_scoring.py        # plain asserts
.venv/bin/python -m pytest test_scoring.py -q

# Server smoke test (no key — tools/list works, tools return structured errors)
curl -s -X POST http://localhost:8765 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## Configuration

```bash
# Required for execution tools
KH_API_KEY=kh_...              # KeeperHub organisation API key

# Optional
PORT=8765                      # MCP server port (default: 8765)
KEEPERHUB_BASE=https://app.keeperhub.com   # API base (default: same)
KEEPERHUB_CHAIN=sepolia        # default chain for explorer links
KEEPERHUB_MAX_RETRIES=2        # retries on failed executions
KEEPERHUB_POLL_SECONDS=3       # execution poll interval
KEEPERHUB_POLL_LIMIT=20        # max poll iterations (~60s)

# Frontend (frontend/.env.local, see .env.example)
VITE_CHAIN=sepolia             # chain used by the pipeline UI (default: sepolia)
```

---

## Project layout

```
zenith/
├── server/
│   ├── mcp_server.py          # MCP HTTP server with 5 tools (real KeeperHub API)
│   ├── test_scoring.py        # unit tests for scoring/schema/tx logic
│   └── requirements.txt       # httpx, uvicorn
├── api/
│   └── proxy.py               # Vercel serverless proxy (key stays server-side)
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Single-page pipeline UI
│   │   └── main.jsx           # React entry
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── vercel.json                # Vercel build + /api rewrites
├── requirements.txt           # Vercel Python runtime deps (httpx)
├── README.md
└── LICENSE
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Agent framework | Hermes Agent |
| KeeperHub integration | KeeperHub API (Bearer `kh_` key) |
| MCP server | Python 3.12, httpx, uvicorn |
| Frontend | Vite 5, React 18 |
| Execution | KeeperHub workflows (Sepolia) |
| Payments (pending) | x402 (Base USDC), MPP (Tempo USDC.e) |
| Identity (pending) | ERC-8004 |

---

## License

MIT
