import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readTools } from "../src/tools/reads.js";

const balances = readTools.find((t) => t.name === "bron_balances_list");

// Point prefs at a non-existent temp file so dustThreshold falls back to the
// bundled default (1) — never touches the real ~/.bron.
beforeEach(() => {
  process.env.BRON_PREFS_PATH = join(tmpdir(), `bron-prefs-${randomUUID()}.json`);
});
afterEach(() => {
  delete process.env.BRON_PREFS_PATH;
});

// Mock: ETH worth $200 (kept), TINY worth $0.10 (dust), SPAM unpriced (dust).
function mockCtx() {
  return {
    workspaceId: "ws_test",
    client: {
      async get(path) {
        if (path.endsWith("/balances")) {
          return {
            balances: [
              { assetId: "E", symbol: "ETH", networkId: "ETH", totalBalance: "1" },
              { assetId: "T", symbol: "TINY", networkId: "ETH", totalBalance: "100" },
              { assetId: "S", symbol: "SPAM", networkId: "ETH", totalBalance: "5" },
            ],
          };
        }
        if (path === "/dictionary/asset-market-prices") {
          return {
            prices: [
              { baseAssetId: "E", quoteSymbolId: "s09", price: "200" },
              { baseAssetId: "T", quoteSymbolId: "s09", price: "0.001" },
              // S has no price → unpriced → dust
            ],
          };
        }
        return {};
      },
    },
  };
}

test("balances default: keeps priced rows, dust collapsed into a compact summary", async () => {
  const r = await balances.handler(mockCtx(), {});
  assert.deepEqual(r.balances.map((b) => b.symbol), ["ETH"]);
  assert.deepEqual(r.dustSummary, { count: 2, totalUsd: 0.1 }); // TINY $0.10; SPAM unpriced → not summed
  assert.equal(r.dust, undefined); // no full dust list unless asked
});

test("balances includeDust: adds a compact dust list alongside the summary", async () => {
  const r = await balances.handler(mockCtx(), { includeDust: true });
  assert.deepEqual(r.balances.map((b) => b.symbol), ["ETH"]);
  assert.equal(r.dustSummary.count, 2);
  assert.deepEqual(
    r.dust.map((d) => [d.symbol, d.usdValue]),
    [["TINY", "0.1"], ["SPAM", null]],
  );
});
