"""
KeeperSense MCP Server — Autonomous Workflow Engine
Bridges agent intent to KeeperHub execution.

Talks to the real KeeperHub API (base: https://app.keeperhub.com/api, auth: Bearer kh_...):
    GET  /api/workflows/public                    — marketplace discovery
    GET  /api/workflows                          — org workflows (fallback)
    GET  /api/workflows/{id}                      — workflow schema / inputSchema
    POST /api/workflows/{id}/duplicate            — deploy (clone) a workflow
    POST /api/workflows/{id}/execute              — trigger execution  {"input": {...}}
    GET  /api/workflows/executions/{id}/status    — execution status + result
    GET  /api/workflows/executions/{id}/logs      — audit trail

Endpoints verified against docs.keeperhub.com on 2026-08-01.
Error responses follow KeeperHub's shape: {"error","detail","hint","docs","request_id"}.

Run:
    KH_API_KEY=kh_... .venv/bin/python mcp_server.py
"""
import json
import os
import asyncio
import httpx
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

KH_API_KEY = os.environ.get("KH_API_KEY", "").strip()
KH_BASE = os.environ.get("KEEPERHUB_BASE", "https://app.keeperhub.com/api")
KH_TIMEOUT = float(os.environ.get("KEEPERHUB_TIMEOUT", "30"))
KH_MAX_RETRIES = int(os.environ.get("KEEPERHUB_MAX_RETRIES", "2"))
KH_POLL_SECONDS = float(os.environ.get("KEEPERHUB_POLL_SECONDS", "3"))
KH_POLL_LIMIT = int(os.environ.get("KEEPERHUB_POLL_LIMIT", "20"))
DEFAULT_CHAIN = os.environ.get("KEEPERHUB_CHAIN", "sepolia")

EXPLORER_URLS = {
    "ethereum": "https://etherscan.io/tx/{}",
    "sepolia": "https://sepolia.etherscan.io/tx/{}",
    "base": "https://basescan.org/tx/{}",
    "arbitrum": "https://arbiscan.io/tx/{}",
    "polygon": "https://polygonscan.com/tx/{}",
}


# ── Pure helpers (unit-tested) ─────────────────────────────────────

def missing_key_error() -> dict:
    return {
        "error": "kh_api_key_not_set",
        "detail": "KH_API_KEY environment variable is not set.",
        "hint": "Get an org API key from app.keeperhub.com → Settings → API Keys, then export KH_API_KEY=kh_...",
        "docs": "https://docs.keeperhub.com/api",
    }


def _walk(obj: Any, *keys: str) -> Any:
    """First non-None value found by walking candidate keys at the top level."""
    if not isinstance(obj, dict):
        return None
    for k in keys:
        if k in obj and obj[k] is not None:
            return obj[k]
    return None


def workflow_id_of(item: dict) -> str:
    return str(_walk(item, "workflowId", "id", "workflow_id", "uuid") or "")


def workflow_name_of(item: dict) -> str:
    return str(_walk(item, "name", "title", "workflowName") or "Unknown")


def workflow_chain_of(item: dict) -> str:
    chains = _walk(item, "chains", "chainIds")
    if isinstance(chains, list) and chains:
        return str(chains[0])
    return str(_walk(item, "chain", "network", "chainId") or "ethereum")


INTENT_KEYWORDS = {
    "protect": ["liquidation", "health", "collateral", "vault", "safety"],
    "monitor": ["watch", "track", "alert", "notify", "event"],
    "distribute": ["reward", "send", "transfer", "pay", "disperse"],
    "rebalance": ["rebalance", "adjust"],
    "sweep": ["sweep", "dust", "collect", "consolidate"],
    "trade": ["swap", "trade", "exchange", "buy", "sell"],
    "stake": ["stake", "yield", "earn", "farm", "deposit"],
    "bridge": ["bridge", "cross-chain", "move chain", "transfer chain"],
}


def score_template(template: dict, intent: str) -> float:
    """Score how well a workflow matches the user's intent."""
    name = (template.get("name") or "").lower()
    desc = (template.get("description") or "").lower()
    text = name + " " + desc
    intent_lower = intent.lower()
    score = 0.0

    for keywords in INTENT_KEYWORDS.values():
        for kw in keywords:
            if kw in intent_lower and kw in text:
                score += 2.0
            elif kw in text:
                score += 0.5

    # boost for name matches
    for word in intent_lower.split():
        if len(word) > 3 and word in name:
            score += 1.0

    return round(score, 2)


def rank_workflows(items: list, intent: str, limit: int = 5) -> list:
    """Normalize raw API items and rank them against the intent."""
    scored = []
    for t in items:
        if not isinstance(t, dict):
            continue
        wid = workflow_id_of(t)
        if not wid:
            continue
        s = score_template(t, intent)
        scored.append({
            "workflow_id": wid,
            "id": wid,  # alias kept for frontend compatibility
            "name": workflow_name_of(t),
            "description": _walk(t, "description") or "",
            "score": s,
            "chain": workflow_chain_of(t),
        })
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:limit]


def input_schema_of(workflow: dict) -> dict:
    """Extract a JSON-Schema-ish input shape from a workflow payload."""
    schema = _walk(workflow, "inputSchema", "input_schema", "schema")
    if isinstance(schema, dict):
        return schema
    # some responses nest it
    if isinstance(workflow, dict):
        for key in ("workflow", "definition", "data"):
            nested = workflow.get(key)
            if isinstance(nested, dict):
                inner = _walk(nested, "inputSchema", "input_schema", "schema")
                if isinstance(inner, dict):
                    return inner
    return {}


def extract_inputs(workflow: dict, provided: dict | None = None) -> tuple[dict, list]:
    """Return (configured_params, missing_params) from the workflow's inputSchema."""
    provided = provided or {}
    schema = input_schema_of(workflow)
    properties = schema.get("properties", {})
    required = set(schema.get("required", []) or [])

    configured: dict = {}
    missing: list = []

    if not properties:
        # no declared schema — pass through what the caller supplied
        return dict(provided), []

    for pname, pdef in properties.items():
        if pname in provided:
            configured[pname] = provided[pname]
            continue
        default = None
        if isinstance(pdef, dict):
            default = _walk(pdef, "default", "defaultValue")
            if isinstance(pdef.get("type"), list):  # JSON schema allows arrays
                pass
        if default is not None:
            configured[pname] = default
        elif pname in required:
            ptype = pdef.get("type", "string") if isinstance(pdef, dict) else "string"
            missing.append({"name": pname, "type": ptype})

    return configured, missing


def parse_api_error(payload: Any, fallback: str) -> dict:
    """Turn a KeeperHub error payload into a readable KeeperSense error dict."""
    if isinstance(payload, dict) and payload.get("error"):
        return {
            "error": payload["error"],
            "detail": payload.get("detail") or fallback,
            "hint": payload.get("hint"),
            "docs": payload.get("docs"),
        }
    return {"error": "keeperhub_request_failed", "detail": fallback}


def explorer_url_for(tx_hash: str, chain: str = DEFAULT_CHAIN) -> str:
    if not tx_hash:
        return ""
    return EXPLORER_URLS.get(chain, EXPLORER_URLS["ethereum"]).format(tx_hash)


def tx_hash_of(result: dict) -> str:
    """Find a tx hash in an execution payload (several shapes in the wild)."""
    direct = _walk(result, "transactionHash", "tx_hash", "txHash", "hash")
    if direct:
        return str(direct)
    hashes = _walk(result, "transactionHashes", "txHashes", "transactions")
    if isinstance(hashes, list) and hashes:
        first = hashes[0]
        if isinstance(first, dict):
            return str(_walk(first, "hash", "transactionHash", "txHash") or "")
        return str(first)
    return ""


# ── KeeperHub API client (per-call, stateless) ─────────────────────

async def kh_request(method: str, path: str, **kwargs) -> tuple[int, Any]:
    """One authenticated request to KeeperHub. Returns (status, parsed_json)."""
    if not KH_API_KEY:
        return 401, missing_key_error()
    headers = {"Authorization": f"Bearer {KH_API_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(base_url=KH_BASE, headers=headers, timeout=KH_TIMEOUT) as c:
        resp = await c.request(method, path, **kwargs)
        try:
            data = resp.json()
        except Exception:
            data = resp.text
        return resp.status_code, data


# ── MCP Tool implementations ───────────────────────────────────────

async def ks_discover(intent: str) -> dict:
    """Search KeeperHub's marketplace/org workflows and return best matches."""
    if not KH_API_KEY:
        return missing_key_error()

    items: list = []
    for path in ("/api/workflows/public", "/api/workflows"):
        status, data = await kh_request("GET", path, params={"limit": 50})
        if status == 200:
            items = data if isinstance(data, list) else _walk(data, "workflows", "data", "items") or []
            if isinstance(items, dict):
                items = list(items.values())
            break
        if status == 401 or status == 403:
            return parse_api_error(data, f"KeeperHub auth failed ({status})")
    else:
        return parse_api_error(data, "KeeperHub workflow discovery failed")

    matches = rank_workflows([i for i in items if isinstance(i, dict)], intent)
    return {
        "intent": intent,
        "matches": matches,
        "top_match": matches[0] if matches else None,
    }


async def ks_configure(workflow_id: str, chain: str = DEFAULT_CHAIN, params: dict | None = None,
                       template_id: str | None = None) -> dict:
    """Fetch a workflow's input schema and auto-fill parameters."""
    wid = workflow_id or template_id  # template_id kept for frontend compatibility
    if not wid:
        return {"error": "missing_workflow_id", "detail": "Pass workflow_id (or template_id)."}
    if not KH_API_KEY:
        return missing_key_error()

    status, data = await kh_request("GET", f"/api/workflows/{wid}")
    if status != 200:
        return parse_api_error(data, f"Workflow fetch failed ({status})")

    workflow = data if isinstance(data, dict) else {}
    configured, missing = extract_inputs(workflow, params)
    return {
        "workflow_id": wid,
        "template_id": wid,
        "workflow_name": workflow_name_of(workflow),
        "chain": chain,
        "configured_params": configured,
        "missing_params": missing,
        "ready": len(missing) == 0,
    }


async def ks_deploy(source_workflow_id: str, chain: str = DEFAULT_CHAIN,
                    name: str | None = None,
                    template_id: str | None = None) -> dict:
    """Deploy a workflow instance by cloning an existing workflow."""
    wid = source_workflow_id or template_id
    if not wid:
        return {"error": "missing_workflow_id", "detail": "Pass source_workflow_id (or template_id)."}
    if not KH_API_KEY:
        return missing_key_error()

    body: dict = {}
    if name:
        body["name"] = name

    status, data = await kh_request("POST", f"/api/workflows/{wid}/duplicate", json=body)
    if status not in (200, 201):
        return parse_api_error(data, f"Workflow deploy failed ({status})")

    new_id = str(_walk(data, "workflowId", "id", "workflow_id") or "")
    return {
        "workflow_id": new_id,
        "workflow_name": _walk(data, "name") or name,
        "status": "deployed",
        "chain": chain,
    }


async def _poll_execution(execution_id: str) -> dict:
    """Poll an execution until terminal or timeout. Returns the status payload."""
    for _ in range(KH_POLL_LIMIT):
        status, data = await kh_request("GET", f"/api/workflows/executions/{execution_id}/status")
        if status != 200:
            return {"error": "status_poll_failed", "detail": f"Status endpoint returned {status}", "payload": data}
        state = str(_walk(data, "status", "state") or "").lower()
        if state in ("success", "succeeded", "failed", "error", "cancelled", "canceled", "reverted"):
            return data if isinstance(data, dict) else {"status": state}
        await asyncio.sleep(KH_POLL_SECONDS)
    return {"status": "pending", "detail": "Timed out waiting for terminal state."}


async def ks_execute(workflow_id: str, input: dict | None = None, chain: str = DEFAULT_CHAIN,
                     retries: int | None = None) -> dict:
    """Execute a deployed workflow. Retries on failure (KeeperHub gas handling)."""
    if not workflow_id:
        return {"error": "missing_workflow_id", "detail": "Pass workflow_id."}
    if not KH_API_KEY:
        return missing_key_error()

    max_retries = KH_MAX_RETRIES if retries is None else int(retries)
    attempt = 0
    last_error = None
    retry_log: list = []

    while attempt <= max_retries:
        status, data = await kh_request("POST", f"/api/workflows/{workflow_id}/execute",
                                        json={"input": input or {}})
        if status not in (200, 201):
            return parse_api_error(data, f"Execution trigger failed ({status})")

        execution_id = str(_walk(data, "executionId", "execution_id", "runId", "run_id") or "")
        if not execution_id:
            return {"error": "no_execution_id", "detail": "Trigger response did not include an execution id.", "payload": data}

        result = await _poll_execution(execution_id)
        if result.get("error"):
            return result

        state = str(_walk(result, "status", "state") or "").lower()
        tx_hash = tx_hash_of(result)
        if state in ("success", "succeeded") or tx_hash:
            return {
                "workflow_id": workflow_id,
                "execution_id": execution_id,
                "run_id": execution_id,
                "tx_hash": tx_hash,
                "status": "success" if tx_hash else state,
                "retries": attempt,
                "retry_log": retry_log,
                "explorer_url": explorer_url_for(tx_hash, chain),
            }

        attempt += 1
        last_error = _walk(result, "error", "failureReason", "message") or state
        retry_log.append({"attempt": attempt, "status": state, "error": last_error})

    return {
        "workflow_id": workflow_id,
        "status": "failed",
        "retries": max_retries,
        "retry_log": retry_log,
        "error": last_error or "execution failed after retries",
    }


async def ks_status(execution_id: str, chain: str = DEFAULT_CHAIN, run_id: str | None = None) -> dict:
    """Return the execution status plus the full audit trail (logs)."""
    eid = execution_id or run_id  # run_id kept for frontend compatibility
    if not eid:
        return {"error": "missing_execution_id", "detail": "Pass execution_id."}
    if not KH_API_KEY:
        return missing_key_error()

    status, data = await kh_request("GET", f"/api/workflows/executions/{eid}/status")
    if status != 200:
        return parse_api_error(data, f"Status check failed ({status})")
    result = data if isinstance(data, dict) else {"status": data}

    trail: Any = []
    try:
        lstatus, ldata = await kh_request("GET", f"/api/workflows/executions/{eid}/logs")
        if lstatus == 200:
            trail = ldata if isinstance(ldata, list) else _walk(ldata, "logs", "entries", "auditTrail") or []
    except Exception:
        trail = []

    tx_hash = tx_hash_of(result)
    return {
        "run_id": eid,
        "execution_id": eid,
        "status": _walk(result, "status", "state"),
        "tx_hash": tx_hash,
        "gas_used": _walk(result, "gasUsed", "gas_used"),
        "simulation": _walk(result, "simulation", "simulationResult"),
        "retries": _walk(result, "retries", "retryCount") or 0,
        "audit_trail": trail,
        "explorer_url": explorer_url_for(tx_hash, chain),
        "timestamp": _walk(result, "completedAt", "timestamp") or datetime.now(timezone.utc).isoformat(),
    }


# ── MCP tool registry ──────────────────────────────────────────────

TOOLS = {
    "ks_discover": {
        "name": "ks_discover",
        "description": "Discover KeeperHub workflows matching natural-language intent. Returns scored matches with confidence levels.",
        "parameters": {
            "type": "object",
            "properties": {
                "intent": {"type": "string", "description": "Natural language description of what you want to do onchain"}
            },
            "required": ["intent"],
        },
    },
    "ks_configure": {
        "name": "ks_configure",
        "description": "Get a workflow's input schema and auto-configure parameters (defaults + required flags).",
        "parameters": {
            "type": "object",
            "properties": {
                "workflow_id": {"type": "string", "description": "Workflow ID from ks_discover"},
                "template_id": {"type": "string", "description": "Alias for workflow_id (kept for compatibility)"},
                "chain": {"type": "string", "description": "Target chain (default: sepolia)"},
                "params": {"type": "object", "description": "Optional manual parameter overrides"},
            },
            "required": ["workflow_id"],
        },
    },
    "ks_deploy": {
        "name": "ks_deploy",
        "description": "Deploy a workflow instance by cloning an existing KeeperHub workflow.",
        "parameters": {
            "type": "object",
            "properties": {
                "source_workflow_id": {"type": "string", "description": "Workflow to clone"},
                "template_id": {"type": "string", "description": "Alias for source_workflow_id (kept for compatibility)"},
                "chain": {"type": "string", "description": "Target chain (default: sepolia)"},
                "name": {"type": "string", "description": "Optional name for the new workflow"},
            },
            "required": ["source_workflow_id"],
        },
    },
    "ks_execute": {
        "name": "ks_execute",
        "description": "Execute a deployed workflow and return the transaction hash. Retries on failure.",
        "parameters": {
            "type": "object",
            "properties": {
                "workflow_id": {"type": "string"},
                "input": {"type": "object", "description": "Inputs matching the workflow's inputSchema"},
                "chain": {"type": "string", "description": "Target chain (default: sepolia)"},
                "retries": {"type": "integer", "description": "Max retries on failure (default: 2)"},
            },
            "required": ["workflow_id"],
        },
    },
    "ks_status": {
        "name": "ks_status",
        "description": "Poll execution status and return the full audit trail (trigger, simulation, tx, gas, outcome).",
        "parameters": {
            "type": "object",
            "properties": {
                "execution_id": {"type": "string"},
                "run_id": {"type": "string", "description": "Alias for execution_id (kept for compatibility)"},
                "chain": {"type": "string", "description": "Target chain (default: sepolia)"},
            },
            "required": ["execution_id"],
        },
    },
}

HANDLERS: dict[str, Callable[..., Awaitable[dict]]] = {
    "ks_discover": ks_discover,
    "ks_configure": ks_configure,
    "ks_deploy": ks_deploy,
    "ks_execute": ks_execute,
    "ks_status": ks_status,
}


# ── JSON-RPC dispatch (shared by the ASGI server and Vercel proxy) ─

async def handle_mcp_request(request: dict) -> dict:
    """Handle a JSON-RPC MCP request."""
    method = request.get("method", "")
    req_id = request.get("id")

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": list(TOOLS.values())}}

    if method == "tools/call":
        params = request.get("params", {})
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {}) or {}

        if tool_name not in HANDLERS:
            return {"jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}}

        try:
            result = await HANDLERS[tool_name](**arguments)
            return {"jsonrpc": "2.0", "id": req_id,
                    "result": {"content": [{"type": "text", "text": json.dumps(result)}]}}
        except TypeError as e:
            return {"jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32602, "message": f"Invalid arguments: {e}"}}
        except Exception as e:
            return {"jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32000, "message": str(e)}}

    return {"jsonrpc": "2.0", "id": req_id,
            "error": {"code": -32601, "message": f"Unknown method: {method}"}}


async def mcp_app(scope, receive, send):
    """ASGI app for MCP HTTP server."""
    if scope["type"] == "http":
        body = b""
        more_body = True
        while more_body:
            msg = await receive()
            body += msg.get("body", b"")
            more_body = msg.get("more_body", False)

        try:
            request = json.loads(body)
            response = await handle_mcp_request(request)
        except json.JSONDecodeError:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}

        response_body = json.dumps(response).encode()
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"content-type", b"application/json"),
                (b"access-control-allow-origin", b"*"),
                (b"access-control-allow-headers", b"content-type"),
            ],
        })
        await send({"type": "http.response.body", "body": response_body})
    elif scope["type"] == "lifespan":
        while True:
            msg = await receive()
            if msg["type"] == "lifespan.startup":
                print(f"KeeperSense MCP running with {len(TOOLS)} tools")
                await send({"type": "lifespan.startup.complete"})
            elif msg["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8765))
    uvicorn.run(mcp_app, host="0.0.0.0", port=port, log_level="info")
