"""
Vercel serverless entrypoint for the KeeperSense MCP server.

The frontend calls /api -> Vercel rewrites to /api/index -> this ASGI app
dispatches the JSON-RPC request to the KeeperSense tool handlers.

KH_API_KEY must be set in Vercel environment variables (production only).
It is read server-side and never reaches the client bundle.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from server import mcp_server  # loads TOOLS/HANDLERS, reads KH_API_KEY
except Exception:  # pragma: no cover - import guard for Vercel's export scan
    mcp_server = None

_CORS = [
    (b"content-type", b"application/json"),
    (b"access-control-allow-origin", b"*"),
    (b"access-control-allow-methods", b"POST, OPTIONS"),
    (b"access-control-allow-headers", b"content-type, authorization, x-api-key"),
]


async def app(scope, receive, send):
    """ASGI app — Vercel routes api/index.py here."""
    if scope["type"] != "http":
        return

    if scope.get("method") == "OPTIONS":
        await send({"type": "http.response.start", "status": 204, "headers": _CORS})
        await send({"type": "http.response.body", "body": b""})
        return

    body = b""
    more = True
    while more:
        msg = await receive()
        body += msg.get("body", b"")
        more = msg.get("more_body", False)

    if mcp_server is None:
        payload = {"jsonrpc": "2.0", "id": None,
                   "error": {"code": -32000, "message": "server import failed"}}
    else:
        # BYOK: forward the request-scoped key from headers (mcp_app does this
        # under uvicorn; Vercel calls handle_mcp_request directly, so do it here).
        mcp_server._request_key.set("")
        try:
            for k, v in scope.get("headers", []):
                name = k.decode("latin-1").lower()
                val = v.decode("latin-1").strip()
                if name == "authorization" and val.lower().startswith("bearer "):
                    mcp_server._request_key.set(val[7:].strip())
                elif name == "x-api-key" and not mcp_server._request_key.get():
                    mcp_server._request_key.set(val)
        except Exception:
            pass
        try:
            payload = json.loads(body) if body else {}
            payload = await mcp_server.handle_mcp_request(payload)
        except json.JSONDecodeError:
            payload = {"jsonrpc": "2.0", "id": None,
                       "error": {"code": -32700, "message": "Parse error"}}

    resp = json.dumps(payload).encode()
    await send({"type": "http.response.start", "status": 200, "headers": _CORS})
    await send({"type": "http.response.body", "body": resp})
