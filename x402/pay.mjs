#!/usr/bin/env node
/**
 * x402 auto-pay helper for KeeperSense.
 *
 * Calls a paid KeeperHub workflow URL; when the server answers 402 with
 * x-402-* headers, the KeeperHub agentic wallet (@keeperhub/wallet) signs
 * an EIP-3009 TransferWithAuthorization and the facilitator settles the
 * USDC payment onchain. Prints the final JSON response to stdout.
 *
 * Env required:
 *   AGENTIC_WALLET_ORG_ID   - agentic wallet org id (KeeperHub dashboard)
 *   AGENTIC_WALLET_API_KEY  - agentic wallet API key
 *
 * Usage: node x402/pay.mjs <url> [--method POST] [--max-price-usd 1.0]
 */
import { createAgenticWallet } from '@keeperhub/wallet';

const url = process.argv[2];
if (!url) {
  console.error('usage: node x402/pay.mjs <url> [--method POST] [--max-price-usd 1.0]');
  process.exit(2);
}

const argv = process.argv.slice(3);
const method = argv[argv.indexOf('--method') + 1] || 'POST';
const maxPriceUsd = Number(argv[argv.indexOf('--max-price-usd') + 1] || 1.0);

if (!process.env.AGENTIC_WALLET_ORG_ID || !process.env.AGENTIC_WALLET_API_KEY) {
  console.error('AGENTIC_WALLET_ORG_ID and AGENTIC_WALLET_API_KEY must be set');
  process.exit(2);
}

try {
  const wallet = await createAgenticWallet({
    orgId: process.env.AGENTIC_WALLET_ORG_ID,
    apiKey: process.env.AGENTIC_WALLET_API_KEY,
  });

  // autoPay follows the x402 flow: probe -> 402 -> EIP-3009 auth -> retry
  const result = await wallet.autoPay(url, {
    method,
    maxPriceUsd,
    headers: { accept: 'application/json' },
  });

  console.log(JSON.stringify({
    status: 'paid',
    url,
    price_usd: result.priceUsd ?? null,
    settlement: result.settlement ?? null,
    response: result.response ?? result,
  }));
} catch (e) {
  console.error(JSON.stringify({ error: 'x402_payment_failed', detail: String(e?.message || e) }));
  process.exit(1);
}
