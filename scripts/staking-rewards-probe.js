#!/usr/bin/env node
// Read-only probe for bron_staking_rewards. Validates the composite end-to-end
// against your real Bron account using the public GET /transactions endpoint
// (filtered by stake-* types + a date window). No state changes.
//
//   BRON_API_KEY="$(cat key.jwk)" BRON_WORKSPACE_ID='…' node scripts/staking-rewards-probe.js [SYMBOL]
//
// Optional SYMBOL restricts to one asset (e.g. ETH). Defaults to year-to-date.

import { BronApiClient } from "../src/api/client.js";
import { stakingRewardsTool } from "../src/tools/composites.js";

const apiKey = process.env.BRON_API_KEY;
const ws = process.env.BRON_WORKSPACE_ID;
if (!apiKey || !ws) {
  console.error("Set BRON_API_KEY (raw JWK) and BRON_WORKSPACE_ID, then re-run.");
  process.exit(2);
}

const ctx = { client: new BronApiClient({ apiKey }), workspaceId: ws };
const args = process.argv[2] ? { symbol: process.argv[2] } : {};

try {
  const r = await stakingRewardsTool.handler(ctx, args);
  console.log(`window: ${r.from} → ${r.to} (${r.days} days)`);
  console.log(`scanned ${r.transactionsScanned} stake-* tx · ${r.positions.length} positions\n`);
  console.log(["SYMBOL", "NETWORK", "REWARDS", "REWARDS $", "PRINCIPAL", "PRINCIPAL $", "PERIOD %", "APR %"].join("\t"));
  for (const p of r.positions) {
    console.log(
      [
        p.symbol || p.assetId,
        p.network || "—",
        p.rewards,
        "$" + p.rewardsUsd,
        p.principal,
        "$" + p.principalUsd,
        p.periodPct ?? "—",
        p.aprPct ?? "—",
      ].join("\t"),
    );
  }
  console.log(
    `\nTOTAL rewards $${r.totals.rewardsUsd} · principal $${r.totals.principalUsd} · APR ${r.totals.aprPct ?? "—"}%`,
  );
  console.log(r.note);
} catch (e) {
  console.error(`❌ ${e.name === "ApiError" ? e.status + " " + e.code + " — " : ""}${e.message}`);
  process.exit(1);
}
