# KeeperHub Onboarding Teardown — where I got stuck, and proposed fixes

> Written Aug 1, 2026 while building [KeeperSense](https://github.com/subheeksh5599/keepersense) for the KeeperHub Agents Onchain Hackathon. All findings are from a first-time builder using the docs + API + hosted MCP server, without prior KeeperHub exposure.

## 1. The API base URL is ambiguous — easy to double the path

The docs show full example URLs like `POST https://app.keeperhub.com/api/workflows/wf_123/execute`, while the API overview describes routes as `/api/workflows`. A client that sets base URL to `https://app.keeperhub.com/api` and calls path `/api/workflows` silently hits `https://app.keeperhub.com/api/api/workflows`.

- Error seen: `{"error":"not_found","detail":"Route GET /api/api/workflows not found"}` — the doubled path IS echoed back, which is how I caught it, but a 404 with no hint is a slow burn.
- **Proposed fix:** either drop `/api` from documented route paths (routes relative to base `https://app.keeperhub.com`), or return a hint in the 404 (`hint: "did you mean /api/workflows?"`). A one-line note in the API overview ("base URL is https://app.keeperhub.com, all routes below include the /api prefix") would have saved an hour.

## 2. No REST endpoint for template search

Docs describe templates/marketplace, and the CLI has `kh template list/deploy`, but there is **no REST equivalent** for searching templates. The closest REST surface is `GET /api/workflows/public` (listed workflows). The hosted MCP server does have `search_templates`, but only MCP clients can use it.

- **Proposed fix:** add `GET /api/templates` (or alias `GET /api/workflows/templates`) mirroring `search_templates`, so non-MCP clients (HTTP agents, cron, Zapier-style) can discover templates without the MCP handshake.

## 3. Strict EIP-55 recipient validation with a misleading error

`POST /api/execute/transfer` rejects recipients with `"Invalid recipient address: 0x..."`. After testing several addresses:

- The **docs' own example recipient** (`0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`) is **rejected** — it is not correctly EIP-55 checksummed.
- A correctly-checksummed variant of the same address is **also rejected**.
- `0x000000000000000000000000000000000000dEaD` passes.
- All-lowercase is rejected.

So the validator is stricter than EIP-55 and the error gives no hint about what "invalid" means (checksum? allowlist? address book?). I only succeeded by brute-forcing addresses.

- **Proposed fixes:**
  - Accept all-lowercase and/or auto-checksum (like MetaMask, ethers `getAddress`).
  - Improve the error: `"Invalid recipient address: 0x… (EIP-55 checksum mismatch — expected 0x…)"` or `"… (not in your org address book — add it at app.keeperhub.com → Wallet Management → Address Book)"`. Right now the message can't distinguish checksum failures from allowlist failures.
  - Fix the docs example to a correctly-checksummed address.

## 4. Address book is dashboard-only — no API

Recipients for transfers appear to require address book membership (dashboard: Wallet Management → Address Book). There is no API to add/label addresses, which blocks programmatic onboarding (agents can't register a recipient without a human in the dashboard).

- **Proposed fix:** expose address book CRUD (`GET/POST/DELETE /api/address-book`). This would unblock fully-autonomous agents from executing transfers to new recipients.

## 5. Wallet address + balance are not in the REST API

The turnkey wallet address is only visible in the dashboard; the REST API has no `GET wallet` route (probed `/api/wallet`, `/api/wallets`, `/api/integrations/wallet` — 404/405). I retrieved the address only through the MCP `list_integrations` tool. Funding guidance ("top up your Turnkey EOA") assumes you can find the address.

- **Proposed fix:** `GET /api/wallet` returning `{address, chains, balances}`; also surface the sender address in `POST /api/execute/transfer` responses or a `GET /api/execute/{id}/status` field (`fromAddress`). Agents need to know which address to fund and which address signed the tx.

## 6. `inputSchema` is `null` on workflows — inputs live in node configs

`GET /api/workflows/{id}` returns `"inputSchema": null` for both marketplace and org workflows. The actual inputs are buried in each node's `data.config` (e.g. `web3/transfer-funds` node config has `amount`, `recipientAddress`, `network`). An agent doing intent→parameter mapping cannot introspect a workflow's required inputs from the schema, and `prepare_test_pin_data` (MCP) exists but is not surfaced in REST.

- **Proposed fix:** populate `inputSchema` (JSON Schema) from node configs — including which fields support `{{...}}` templates — or document the node-config structure as the input contract. This is the single biggest DX gap for agents building on KeeperHub.

## 7. No testnet faucet API

Getting Sepolia ETH into the wallet required an external faucet (the docs' "funding" section links nothing; `kh wallet fund` only prints a Coinbase Onramp URL for Base USDC). For a hackathon/testnet workflow this is pure friction.

- **Proposed fix:** a rate-limited testnet faucet endpoint (`POST /api/wallet/fund {chainId, amount}`) for enabled testnets, or at least a documented faucet link per testnet chain in the Wallet tab.

---

## Summary table

| # | Gap | Where | Effort | Impact |
|---|---|---|---|---|
| 1 | Base URL `/api` double-path | docs | S | High |
| 2 | No REST template search | API | M | Med |
| 3 | Strict EIP-55 + unhelpful error | API | S | High |
| 4 | Address book has no API | API | M | Med |
| 5 | No wallet address/balance endpoint | API | S | Med |
| 6 | `inputSchema` null — inputs in node configs | API | M | High |
| 7 | No testnet faucet | Product | M | Med |

The pattern across all seven: **KeeperHub is agent-ready on the execution side but the discovery/configuration side still assumes a human in the dashboard.** Fixing 3 and 6 alone would make first-time agent integrations dramatically smoother.
