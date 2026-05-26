#!/usr/bin/env node
// Validate the cost_basis composite end-to-end against your real history.
//   BRON_API_KEY="$(cat key.jwk)" BRON_WORKSPACE_ID='…' node scripts/cost-basis-probe.js [SYMBOL]
// Optional SYMBOL restricts to one asset (e.g. ETH). Read-only.

import { BronApiClient } from "../src/api/client.js";
import { costBasisTool } from "../src/tools/composites.js";

const apiKey = process.env.BRON_API_KEY;
const ws = process.env.BRON_WORKSPACE_ID;
if (!apiKey || !ws) {
  console.error("Set BRON_API_KEY (raw JWK) and BRON_WORKSPACE_ID, then re-run.");
  process.exit(2);
}

const ctx = { client: new BronApiClient({ apiKey }), workspaceId: ws };
const args = process.argv[2] ? { symbol: process.argv[2] } : {};

try {
  const r = await costBasisTool.handler(ctx, args);
  console.log(`scanned ${r.transactionsScanned} completed txs · ${r.positions.length} positions\n`);
  console.log(["SYMBOL", "HELD", "VALUE $", "AVG BASIS", "CURRENT", "UNREAL %", "UNREAL $", "REALISED $"].join("\t"));
  for (const p of r.positions) {
    console.log([
      p.symbol || p.assetId,
      p.held,
      "$" + p.currentValue,
      "$" + p.avgBasis,
      "$" + p.currentPrice,
      p.unrealisedPct === null ? "—" : p.unrealisedPct + "%",
      "$" + p.unrealisedUsd,
      "$" + p.realised,
    ].join("\t"));
  }
  console.log(`\nTOTAL held $${r.totals.holdingsValue} · unrealised $${r.totals.unrealisedUsd} · realised $${r.totals.realisedUsd} · lifetime fees $${r.lifetimeFees}`);
} catch (e) {
  console.error(`❌ ${e.name === "ApiError" ? e.status + " " + e.code + " — " : ""}${e.message}`);
  process.exit(1);
}
