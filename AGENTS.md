# AGENTS.md — KeeperSense

Guidance for AI agents and contributors working in this repo.

## What this is

KeeperSense is an MCP server (JSON-RPC over HTTP) that lets any AI agent go from
natural-language intent to a real, executed KeeperHub workflow transaction.
The same server powers the demo site (landing + pipeline UI) and the live
deployment's `/api` endpoint.

## Layout

- `server/mcp_server.py` — the 7 MCP tools (ks_discover, ks_configure, ks_deploy,
  ks_execute, ks_status, ks_pay, ks_identity) + the KeeperHub REST client.
- `server/test_scoring.py` — unit tests (24) for scoring, schema extraction,
  tx parsing, onchain resolution, free-tier filtering. Run: `python server/test_scoring.py`.
- `api/index.py` — ASGI entrypoint for Vercel (guarded import of mcp_server).
- `frontend/` — Vite + React SPA (landing + pipeline). Build: `npm run build` (from frontend/).
- `x402/` — node helper for ks_pay (@keeperhub/wallet auto-pay).
- `docs/ONBOARDING-TEARDOWN.md` — KeeperHub onboarding gaps (bounty deliverable).

## Environment

- `KH_API_KEY` (required for live calls) — set via `export KH_API_KEY=$(grep KH_API_KEY .env | cut -d= -f2)`
  or read from `.env`. `.env` is gitignored, chmod 600.
- `VITE_CHAIN` (frontend, default `sepolia`) · `KEEPERHUB_CHAIN` · `KEEPERHUB_BASE`.
- Optional: `AGENTIC_WALLET_*` (ks_pay), `KEEPERHUB_IDENTITY_REGISTRY` (ks_identity),
  `KEEPERHUB_RPC_OVERRIDE`.

## Rules

- Never commit secrets or `.env`.
- Free-tier only: ks_discover excludes paid/marketplace workflows by default
  (they 402/404 on the free plan).
- Don't hardcode chain/address values in the frontend — use env vars with defaults.
- Verify before presenting: tests pass, server boots, live `/api` responds.
- Granular conventional commits (feat:/fix:/docs:/chore:/test:).
