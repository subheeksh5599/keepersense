"""
Vercel serverless proxy for the KeeperSense MCP server.

The frontend calls /api -> Vercel rewrites to /api/proxy -> this module
forwards the JSON-RPC request to the KeeperSense tool handlers.

KH_API_KEY must be set in Vercel environment variables (production only).
It is read server-side and never reaches the client bundle.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import mcp_server  # noqa: E402  (loads TOOLS/HANDLERS, reads KH_API_KEY)


def _cors_headers() -> dict:
    return {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
    }


def handler(request):
    """Vercel Python function entrypoint.

    Supports both the request-object style (VercelRequest) and the legacy
    event-dict style. Returns a dict Vercel serializes as the HTTP response.
    """
    if hasattr(request, "method"):  # VercelRequest style
        method = (request.method or "POST").upper()
        raw = request.body or b""
        if isinstance(raw, str):
            raw = raw.encode()
    else:  # legacy event dict style
        method = (request.get("httpMethod") or "POST").upper()
        raw = request.get("body") or ""
        if isinstance(raw, str):
            raw = raw.encode()

    if method == "OPTIONS":
        return {"statusCode": 204, "headers": _cors_headers(), "body": ""}

    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        payload = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}

    response = asyncio.run(mcp_server.handle_mcp_request(payload))
    return {"statusCode": 200, "headers": _cors_headers(), "body": json.dumps(response)}
