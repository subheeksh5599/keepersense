"""
KeeperSense MCP Server — Autonomous Workflow Engine
Bridges agent intent to KeeperHub execution.
"""
import os
import json
import asyncio
import httpx
from datetime import datetime, timezone
from typing import Any

KH_API_KEY = os.environ.get("KH_API_KEY", "")
KH_BASE = "https://app.keeperhub.com/api"
KH_MCP_BASE = "https://app.keeperhub.com/mcp"

if not KH_API_KEY:
    raise RuntimeError("KH_API_KEY not set — export KH_API_KEY=kh_...")

client = httpx.AsyncClient(
    base_url=KH_BASE,
    headers={"Authorization": f"Bearer {KH_API_KEY}", "Content-Type": "application/json"},
    timeout=30.0,
)

# ── Template scoring ──────────────────────────────────────────────

INTENT_KEYWORDS = {
    "protect": ["liquidation", "health", "collateral", "vault", "safety"],
    "monitor": ["watch", "track", "alert", "notify", "event"],
    "distribute": ["reward", "send", "transfer", "pay", "disperse"],
    "rebalance": ["rebalance", "rebalance", "adjust", "rebalance"],
    "sweep": ["sweep", "dust", "collect", "consolidate"],
    "trade": ["swap", "trade", "exchange", "buy", "sell"],
    "stake": ["stake", "yield", "earn", "farm", "deposit"],
    "bridge": ["bridge", "cross-chain", "move chain", "transfer chain"],
}

def score_template(template: dict, intent: str) -> float:
    """Score how well a template matches the user's intent."""
    name = (template.get("name") or "").lower()
    desc = (template.get("description") or "").lower()
    text = name + " " + desc
    intent_lower = intent.lower()
    score = 0.0

    for category, keywords in INTENT_KEYWORDS.items():
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


# ── MCP Tool implementations ───────────────────────────────────────

async def ks_discover(intent: str) -> dict:
    """Search KeeperHub templates and return best matches with confidence scores."""
    try:
        resp = await client.get("/mcp/templates/search", params={"q": intent, "limit": 10})
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return {"error": f"Template search failed: {e}", "matches": []}

    templates = data.get("templates", data.get("data", data if isinstance(data, list) else []))
    if isinstance(templates, dict):
        templates = list(templates.values())

    scored = []
    for t in templates:
        s = score_template(t, intent)
        if s > 0:
            scored.append({
                "id": t.get("id"),
                "name": t.get("name", "Unknown"),
                "description": t.get("description", ""),
                "score": s,
                "chain": t.get("chain", t.get("network", "ethereum")),
                "protocol": t.get("protocol", ""),
            })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return {
        "intent": intent,
        "matches": scored[:5],
        "top_match": scored[0] if scored else None,
    }


async def ks_configure(template_id: str, chain: str = "sepolia", params: dict | None = None) -> dict:
    """Get template details and auto-fill parameters from onchain data."""
    try:
        resp = await client.get(f"/mcp/templates/{template_id}")
        resp.raise_for_status()
        template = resp.json()
    except Exception as e:
        return {"error": f"Template fetch failed: {e}"}

    # Extract required parameters from the template
    required_params = template.get("parameters", template.get("params", []))
    configured = {}
    missing = []

    for p in required_params:
        pname = p.get("name", p if isinstance(p, str) else "")
        ptype = p.get("type", "string")
        default = p.get("default")

        # Try to auto-fill from provided params
        if params and pname in params:
            configured[pname] = params[pname]
        elif default is not None:
            configured[pname] = default
        else:
            missing.append({"name": pname, "type": ptype})

    return {
        "template_id": template_id,
        "template_name": template.get("name", "Unknown"),
        "chain": chain,
        "configured_params": configured,
        "missing_params": missing,
        "ready": len(missing) == 0,
    }


async def ks_deploy(template_id: str, params: dict, chain: str = "sepolia") -> dict:
    """Deploy a workflow from a template with the given parameters."""
    payload = {
        "template_id": template_id,
        "parameters": params,
        "chain": chain,
    }
    try:
        resp = await client.post("/mcp/workflows", json=payload)
        resp.raise_for_status()
        workflow = resp.json()
    except Exception as e:
        return {"error": f"Workflow deploy failed: {e}"}

    return {
        "workflow_id": workflow.get("id"),
        "workflow_name": workflow.get("name"),
        "status": "deployed",
        "chain": chain,
    }


async def ks_execute(workflow_id: str) -> dict:
    """Execute a deployed workflow and return the transaction hash."""
    try:
        resp = await client.post(f"/mcp/workflows/{workflow_id}/execute")
        resp.raise_for_status()
        result = resp.json()
    except Exception as e:
        return {"error": f"Execution failed: {e}"}

    return {
        "workflow_id": workflow_id,
        "execution_id": result.get("execution_id", result.get("run_id")),
        "tx_hash": result.get("tx_hash", result.get("transactionHash")),
        "status": result.get("status", "submitted"),
        "explorer_url": result.get("explorer_url", ""),
    }


async def ks_status(run_id: str) -> dict:
    """Poll execution status and return the full audit trail."""
    try:
        resp = await client.get(f"/mcp/executions/{run_id}")
        resp.raise_for_status()
        result = resp.json()
    except Exception as e:
        return {"error": f"Status check failed: {e}"}

    return {
        "run_id": run_id,
        "status": result.get("status"),
        "tx_hash": result.get("tx_hash", result.get("transactionHash")),
        "gas_used": result.get("gas_used"),
        "simulation": result.get("simulation"),
        "retries": result.get("retries", 0),
        "audit_trail": result.get("audit_trail", result.get("logs", [])),
        "explorer_url": result.get("explorer_url", ""),
        "timestamp": result.get("timestamp", datetime.now(timezone.utc).isoformat()),
    }


# ── MCP HTTP Server ─────────────────────────────────────────────────

TOOLS = {
    "ks_discover": {
        "name": "ks_discover",
        "description": "Discover KeeperHub workflow templates matching natural-language intent. Returns scored matches with confidence levels.",
        "parameters": {
            "type": "object",
            "properties": {
                "intent": {"type": "string", "description": "Natural language description of what you want to do onchain"}
            },
            "required": ["intent"]
        }
    },
    "ks_configure": {
        "name": "ks_configure",
        "description": "Get template details and auto-configure parameters from onchain data.",
        "parameters": {
            "type": "object",
            "properties": {
                "template_id": {"type": "string", "description": "Template ID from ks_discover"},
                "chain": {"type": "string", "description": "Target chain (default: sepolia)"},
                "params": {"type": "object", "description": "Optional manual parameter overrides"}
            },
            "required": ["template_id"]
        }
    },
    "ks_deploy": {
        "name": "ks_deploy",
        "description": "Deploy a workflow from a template with configured parameters.",
        "parameters": {
            "type": "object",
            "properties": {
                "template_id": {"type": "string"},
                "params": {"type": "object"},
                "chain": {"type": "string"}
            },
            "required": ["template_id", "params"]
        }
    },
    "ks_execute": {
        "name": "ks_execute",
        "description": "Execute a deployed workflow and return the transaction hash.",
        "parameters": {
            "type": "object",
            "properties": {
                "workflow_id": {"type": "string"}
            },
            "required": ["workflow_id"]
        }
    },
    "ks_status": {
        "name": "ks_status",
        "description": "Poll execution status and return the full audit trail (trigger, simulation, tx, gas, outcome).",
        "parameters": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string"}
            },
            "required": ["run_id"]
        }
    }
}

HANDLERS = {
    "ks_discover": ks_discover,
    "ks_configure": ks_configure,
    "ks_deploy": ks_deploy,
    "ks_execute": ks_execute,
    "ks_status": ks_status,
}


async def handle_mcp_request(request: dict) -> dict:
    """Handle a JSON-RPC MCP request."""
    method = request.get("method", "")
    req_id = request.get("id")

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": list(TOOLS.values())}}

    if method == "tools/call":
        params = request.get("params", {})
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})

        if tool_name not in HANDLERS:
            return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}}

        try:
            result = await HANDLERS[tool_name](**arguments)
            return {"jsonrpc": "2.0", "id": req_id, "result": {"content": [{"type": "text", "text": json.dumps(result)}]}}
        except Exception as e:
            return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e)}}

    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Unknown method: {method}"}}


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
                await client.aclose()
                await send({"type": "lifespan.shutdown.complete"})
                return


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8765))
    uvicorn.run(mcp_app, host="0.0.0.0", port=port, log_level="info")
