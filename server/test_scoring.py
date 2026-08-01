"""Unit tests for KeeperSense pure logic (no network, no API key)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp_server import (  # noqa: E402
    score_template,
    rank_workflows,
    extract_inputs,
    input_schema_of,
    tx_hash_of,
    workflow_id_of,
    workflow_chain_of,
    chain_name_of,
    workflow_executes_onchain,
    _is_clone_name,
    explorer_url_for,
)


# ── score_template ─────────────────────────────────────────────────

def test_score_strong_match():
    t = {"name": "Aave V3 Liquidation Protection", "description": "Monitors health factor and protects vault collateral"}
    assert score_template(t, "protect my vault from liquidation") >= 4.0


def test_score_partial_match():
    t = {"name": "Reward Distribution", "description": "Disperses rewards to holders"}
    s = score_template(t, "distribute rewards")
    assert 1.0 <= s < 4.0


def test_score_no_match():
    t = {"name": "NFT Gating", "description": "token gate a community with an NFT"}
    assert score_template(t, "protect my vault") == 0.0


def test_keyword_lists_have_no_duplicates():
    from mcp_server import INTENT_KEYWORDS
    for kw_list in INTENT_KEYWORDS.values():
        assert len(kw_list) == len(set(kw_list)), f"duplicate keyword: {kw_list}"


# ── rank_workflows ─────────────────────────────────────────────────

def test_rank_normalizes_and_sorts():
    items = [
        {"workflowId": "wf_b", "name": "Sweep Dust", "description": "collect small balances"},
        {"id": "wf_a", "name": "Reward Payout", "description": "pay out rewards"},
    ]
    out = rank_workflows(items, "sweep dust")
    assert out[0]["workflow_id"] == "wf_b"
    assert out[0]["id"] == "wf_b"  # alias
    assert out[0]["score"] >= out[1]["score"]


def test_rank_drops_items_without_id():
    out = rank_workflows([{"name": "no id here"}], "anything")
    assert out == []


# ── extract_inputs / input_schema_of ───────────────────────────────

def test_extract_inputs_defaults_and_required():
    workflow = {
        "inputSchema": {
            "type": "object",
            "required": ["toAddress", "amount"],
            "properties": {
                "toAddress": {"type": "string", "description": "recipient"},
                "amount": {"type": "string", "default": "0.01"},
                "chain": {"type": "string", "default": "sepolia"},
            },
        }
    }
    configured, missing = extract_inputs(workflow, {"toAddress": "0xabc"})
    assert configured == {"toAddress": "0xabc", "amount": "0.01", "chain": "sepolia"}
    # amount/chain have defaults -> configured; toAddress was supplied -> nothing missing
    assert missing == []
    # required-but-unsupplied without default:
    workflow2 = {"inputSchema": {"required": ["toAddress"], "properties": {"toAddress": {"type": "string"}}}}
    c2, m2 = extract_inputs(workflow2, {})
    assert c2 == {} and any(m["name"] == "toAddress" for m in m2)


def test_extract_inputs_no_schema_passthrough():
    configured, missing = extract_inputs({"name": "x"}, {"foo": 1})
    assert configured == {"foo": 1} and missing == []


def test_input_schema_nested():
    w = {"workflow": {"inputSchema": {"properties": {"a": {"type": "string"}}}}}
    assert input_schema_of(w) == {"properties": {"a": {"type": "string"}}}


# ── tx_hash_of ─────────────────────────────────────────────────────

def test_tx_hash_direct():
    assert tx_hash_of({"transactionHash": "0x1234"}) == "0x1234"


def test_tx_hash_list():
    data = {"transactionHashes": [{"hash": "0xabc", "nodeName": "Transfer"}]}
    assert tx_hash_of(data) == "0xabc"


def test_tx_hash_missing():
    assert tx_hash_of({"status": "pending"}) == ""


# ── misc ───────────────────────────────────────────────────────────

def test_workflow_id_of():
    assert workflow_id_of({"workflowId": "wf_1"}) == "wf_1"
    assert workflow_id_of({"id": "wf_2"}) == "wf_2"
    assert workflow_id_of({}) == ""


def test_explorer_url_defaults_to_sepolia():
    assert explorer_url_for("0xabc") == "https://sepolia.etherscan.io/tx/0xabc"


# ── chain / execution detection ────────────────────────────────────

def test_chain_from_node_config():
    item = {"name": "Demo", "nodes": [{"data": {"config": {"actionType": "web3/transfer-funds", "network": "11155111"}}}]}
    assert workflow_chain_of(item) == "sepolia"


def test_chain_name_mapping():
    assert chain_name_of("11155111") == "sepolia"
    assert chain_name_of(8453) == "base"
    assert chain_name_of("ethereum") == "ethereum"
    assert chain_name_of(None) == "ethereum"


def test_executes_onchain():
    write = {"nodes": [{"data": {"config": {"actionType": "web3/transfer-funds"}}}]}
    read = {"nodes": [{"data": {"config": {"actionType": "aave-v3/get-user-account-data"}}}]}
    assert workflow_executes_onchain(write) is True
    assert workflow_executes_onchain(read) is False


def test_clone_name_filter():
    assert _is_clone_name("KeeperSense Demo Transfer (Copy)") is True
    assert _is_clone_name("KeeperSense Demo Transfer (Copy) 5") is True
    assert _is_clone_name("KeeperSense Demo Transfer") is False


def test_action_intent_boost_ranks_executors_first():
    from mcp_server import rank_workflows
    items = [
        {"workflowId": "wf_read", "name": "Aave Scanner", "description": "liquidation risk", "nodes": [{"data": {"config": {"actionType": "aave-v3/get-user-account-data"}}}]},
        {"workflowId": "wf_xfer", "name": "ETH Transfer", "description": "send eth", "nodes": [{"data": {"config": {"actionType": "web3/transfer-funds", "network": "11155111"}}}]},
    ]
    out = rank_workflows(items, "transfer 0.001 eth")
    assert out[0]["workflow_id"] == "wf_xfer"
    assert out[0]["chain"] == "sepolia"


if __name__ == "__main__":
    failures = 0
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in tests:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL {fn.__name__}: {e}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)
