#!/usr/bin/env node
// PREVIEW ONLY. Validates the bron_tx_withdrawal wire format against your real
// account by calling the dry-run endpoint. It CREATES NOTHING and MOVES NO
// FUNDS — dryRun is hardcoded true and there is no commit path in this script.
//
//   BRON_API_KEY="$(cat key.jwk)" BRON_WORKSPACE_ID='…' \
//   WD_ACCOUNT='acc_id' WD_AMOUNT='0.001' WD_SYMBOL='ETH' WD_NETWORK='ETH' \
//   WD_TO_ADDRESS='0x…' \
//   node scripts/withdrawal-dryrun-probe.js
//
// Asset: set WD_ASSET_ID, or WD_SYMBOL + WD_NETWORK.
// Destination: set one of WD_TO_ADDRESS / WD_TO_ACCOUNT / WD_TO_RECORD.

import { BronApiClient } from "../src/api/client.js";
import { writeTools } from "../src/tools/writes.js";

const apiKey = process.env.BRON_API_KEY;
const ws = process.env.BRON_WORKSPACE_ID;
if (!apiKey || !ws) {
  console.error("Set BRON_API_KEY (raw JWK) and BRON_WORKSPACE_ID, then re-run.");
  process.exit(2);
}

const e = process.env;
const args = {
  accountId: e.WD_ACCOUNT,
  amount: e.WD_AMOUNT,
  assetId: e.WD_ASSET_ID,
  symbol: e.WD_SYMBOL,
  networkId: e.WD_NETWORK,
  toAddress: e.WD_TO_ADDRESS,
  toAccountId: e.WD_TO_ACCOUNT,
  toAddressBookRecordId: e.WD_TO_RECORD,
  feeLevel: e.WD_FEE_LEVEL,
  dryRun: true, // hardcoded — this probe never creates a request
};
for (const k of Object.keys(args)) if (args[k] == null) delete args[k];
args.dryRun = true;

if (!args.accountId || !args.amount) {
  console.error("WD_ACCOUNT and WD_AMOUNT are required.");
  process.exit(2);
}

const withdrawal = writeTools.find((t) => t.name === "bron_tx_withdrawal");
const ctx = { client: new BronApiClient({ apiKey }), workspaceId: ws };

console.log("PREVIEW ONLY — calling /transactions/dry-run, no request will be created.\n");
try {
  const r = await withdrawal.handler(ctx, args);
  console.log("dryRun:", r.dryRun, "| type:", r.transactionType, "| externalId:", r.externalId);
  console.log("\nDry-run result:");
  console.log(JSON.stringify(r.result, null, 2));
} catch (err) {
  console.error(`❌ ${err.name === "ApiError" ? err.status + " " + err.code + " — " : ""}${err.message}`);
  process.exit(1);
}
