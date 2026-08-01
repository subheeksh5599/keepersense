# x402 auto-pay helper (paid workflows)

KeeperHub paid workflows settle via **x402** on Base USDC (or MPP on Tempo
USDC.e): each call carries a USDC payment, and the server returns the result
only after the payment is verified onchain.

`ks_pay` implements the flow: probe the target -> expect `402 Payment
Required` with `x-402-*` headers -> the agentic wallet signs an EIP-3009
TransferWithAuthorization -> retry with the authorization -> facilitator
settles and returns the result.

## Setup (one time)

1. Install the helper (needs Node >= 18):
   ```bash
   cd x402 && npm install
   ```
2. Create an agentic wallet in the KeeperHub dashboard
   (AI Tools -> Agentic Wallets) and export its credentials:
   ```bash
   export AGENTIC_WALLET_ORG_ID=...
   export AGENTIC_WALLET_API_KEY=...
   ```
3. Fund the wallet with a small amount of **Base USDC** (a few dollars —
   each paid call is typically $0.01). The 100 USDC per-transfer ceiling
   applies.

## Try it

```bash
node x402/pay.mjs https://app.keeperhub.com/... --max-price-usd 0.10
```

or through the MCP tool:

```
ks_pay(target_url="https://app.keeperhub.com/...", chain="base", max_price_usd=0.10)
```

## Notes

- No ETH/gas needed in the wallet: the facilitator pays gas; your wallet only
  debits the USDC.
- The agentic wallet's EIP-712 signing is allowlisted to Base (8453), Tempo
  mainnet (4217) and Tempo testnet (42431).
- Without the env vars, `ks_pay` returns `x402_requires_agentic_wallet` with
  this setup instead of failing silently — the demo can show the 402 flow
  either way.
