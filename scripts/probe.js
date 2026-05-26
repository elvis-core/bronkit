#!/usr/bin/env node
// Integration probe — run with YOUR real key to confirm the signing port works
// against the LIVE Bron API. This is the gate before building the rest.
//
//   BRON_API_KEY='<your JWK JSON>' BRON_WORKSPACE_ID='<workspace id>' \
//     node scripts/probe.js
//
// Expect: ✅ 200 + your workspace JSON. A ❌ 401 means the signing
// canonicalisation is off, and the next step is capturing real CLI traffic to diff.

import { BronApiClient } from "../src/api/client.js";
import { attachUsdPrices } from "../src/util/prices.js";

const apiKey = process.env.BRON_API_KEY;
const ws = process.env.BRON_WORKSPACE_ID;
if (!apiKey || !ws) {
  console.error("Set BRON_API_KEY (raw JWK JSON) and BRON_WORKSPACE_ID, then re-run.");
  process.exit(2);
}

const client = new BronApiClient({ apiKey });

try {
  console.error(`→ GET /workspaces/${ws}`);
  const info = await client.get(`/workspaces/${ws}`);
  console.log("✅ 200 OK — signing works against the live API.");
  console.log("   workspace:", JSON.stringify(info).slice(0, 300));

  console.error(`→ GET /workspaces/${ws}/balances  +  /dictionary/asset-market-prices (merge)`);
  const bal = await client.get(`/workspaces/${ws}/balances`, { nonEmpty: true });
  const { priced } = await attachUsdPrices(client, bal);
  const total = (bal.balances || []).length;
  console.log(`✅ balances: ${total} rows, ${priced} priced (USD), ${total - priced} unpriced/dust`);
  if (priced === 0) {
    console.error("   ⚠ 0 priced — the price merge isn't attaching usdValue; the dust filter would drop everything. Investigate /dictionary/asset-market-prices.");
  } else {
    console.error(`   → dust filter would keep ${priced} priced rows, drop ${total - priced}.`);
  }
} catch (e) {
  if (e.name === "ApiError") {
    console.error(`❌ ${e.status} ${e.code} — ${e.message}${e.requestId ? " (req " + e.requestId + ")" : ""}`);
    if (e.status === 401) {
      console.error("   401 → signing canonicalisation mismatch. Next: capture real `bron … --debug` traffic and diff the signed message.");
    }
    process.exit(1);
  }
  console.error("❌ error:", e.message);
  process.exit(1);
}
