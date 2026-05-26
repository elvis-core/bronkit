#!/usr/bin/env node
// Validate the staking_opportunities composite end-to-end against your real
// holdings.
//   BRON_API_KEY="$(cat key.jwk)" BRON_WORKSPACE_ID='…' node scripts/staking-probe.js [SYMBOL]
// Optional SYMBOL restricts to one asset (e.g. ETH). Read-only.

import { BronApiClient } from "../src/api/client.js";
import { stakingOpportunitiesTool } from "../src/tools/composites.js";

const apiKey = process.env.BRON_API_KEY;
const ws = process.env.BRON_WORKSPACE_ID;
if (!apiKey || !ws) {
  console.error("Set BRON_API_KEY (raw JWK) and BRON_WORKSPACE_ID, then re-run.");
  process.exit(2);
}

const ctx = { client: new BronApiClient({ apiKey }), workspaceId: ws };
const args = process.argv[2] ? { symbol: process.argv[2] } : {};

try {
  const r = await stakingOpportunitiesTool.handler(ctx, args);
  console.log(`${r.positions.length} positions · ${r.positions.filter((p) => p.eligible).length} on the verified allow-list\n`);
  console.log(["SYMBOL", "NETWORK", "TOTAL", "IDLE", "LOCKED", "IDLE $", "RECOMMENDATION"].join("\t"));
  for (const p of r.positions) {
    console.log([
      p.symbol || p.assetId,
      p.network || "—",
      p.total,
      p.idle,
      p.locked,
      "$" + p.idleUsd,
      p.recommendation,
    ].join("\t"));
  }
  console.log(`\nTOTAL idle $${r.totals.idleUsd} · deployable on allow-list $${r.totals.eligibleIdleUsd}`);
  console.log(r.note);
} catch (e) {
  console.error(`❌ ${e.name === "ApiError" ? e.status + " " + e.code + " — " : ""}${e.message}`);
  process.exit(1);
}
