import { test } from "node:test";
import assert from "node:assert/strict";
import { costBasisTool, stakingOpportunitiesTool } from "../src/tools/composites.js";

// Mock client: one page of history (buy 1 ETH @ $100, sell 0.5 ETH @ $75),
// then a USD price of $200/ETH. Exercises the whole handler — pagination,
// preprocess, FIFO, price merge, enrich, filter, sort — with no real API.
function mockCtx() {
  let txCalls = 0;
  return {
    workspaceId: "ws_test",
    client: {
      async get(path) {
        if (path.endsWith("/transactions")) {
          txCalls++;
          if (txCalls > 1) return { transactions: [] };
          return {
            transactions: [
              { _embedded: { events: [{ transactionId: "t1", eventType: "in", assetId: "E", symbol: "ETH", networkId: "ETH", amount: "1", usdAmount: "100", createdAt: "2024-01-01" }] } },
              { _embedded: { events: [{ transactionId: "t2", eventType: "out", assetId: "E", symbol: "ETH", networkId: "ETH", amount: "0.5", usdAmount: "75", createdAt: "2024-02-01" }] } },
            ],
          };
        }
        if (path === "/dictionary/asset-market-prices") {
          return { prices: [{ baseAssetId: "E", quoteSymbolId: "s09", price: "200" }] };
        }
        return {};
      },
    },
  };
}

test("cost_basis handler: runs end-to-end and computes P&L correctly", async () => {
  const r = await costBasisTool.handler(mockCtx(), {});
  assert.equal(r.transactionsScanned, 2);
  assert.equal(r.lifetimeFees, "0");
  const eth = r.positions.find((p) => p.symbol === "ETH");
  assert.ok(eth, "ETH position present");
  assert.equal(eth.held, "0.5"); // 1 bought − 0.5 sold
  assert.equal(eth.avgBasis, "100"); // remaining lot basis
  assert.equal(eth.currentPrice, "200");
  assert.equal(eth.realised, "25"); // 75 − (100 × 0.5)
  assert.equal(eth.unrealisedUsd, "50"); // (200 − 100) × 0.5
  assert.equal(eth.unrealisedPct, "100");
  assert.equal(eth.currentValue, "100"); // 0.5 × 200
  assert.equal(r.totals.holdingsValue, "100");
  assert.equal(r.totals.unrealisedUsd, "50");
  assert.equal(r.totals.realisedUsd, "25");
});

test("cost_basis handler: symbol filter restricts results", async () => {
  const r = await costBasisTool.handler(mockCtx(), { symbol: "btc" });
  assert.equal(r.positions.length, 0);
});

// Mock client for staking: a balances page (mix of idle/locked, priced/off-list)
// plus a price map. Exercises idle proration, allow-list classification, the
// locked-survives filter, sort, and totals — with no real API.
function mockStakingCtx() {
  return {
    workspaceId: "ws_test",
    client: {
      async get(path) {
        if (path.endsWith("/balances")) {
          return {
            balances: [
              { assetId: "E", symbol: "ETH", networkId: "ETH", totalBalance: "2", withdrawableBalance: "2" },
              { assetId: "S", symbol: "SOL", networkId: "SOL", totalBalance: "10", withdrawableBalance: "4" },
              { assetId: "B", symbol: "BRON", networkId: "ETH", totalBalance: "10000", withdrawableBalance: "10000" },
              { assetId: "U", symbol: "USDT", networkId: "ETH", totalBalance: "500", withdrawableBalance: "500" },
              { assetId: "D", symbol: "DOT", networkId: "DOT", totalBalance: "5", withdrawableBalance: "0" },
            ],
          };
        }
        if (path === "/dictionary/asset-market-prices") {
          return {
            prices: [
              { baseAssetId: "E", quoteSymbolId: "s09", price: "200" },
              { baseAssetId: "S", quoteSymbolId: "s09", price: "20" },
              { baseAssetId: "B", quoteSymbolId: "s09", price: "0.01" },
              { baseAssetId: "U", quoteSymbolId: "s09", price: "1" },
              { baseAssetId: "D", quoteSymbolId: "s09", price: "4" },
            ],
          };
        }
        return {};
      },
    },
  };
}

test("staking_opportunities: idle proration, classification, locked-survives filter, totals", async () => {
  const r = await stakingOpportunitiesTool.handler(mockStakingCtx(), {});
  // Sorted by idle USD desc: USDT(500), ETH(400), BRON(100), SOL(80), DOT(0-but-locked).
  assert.deepEqual(r.positions.map((p) => p.symbol), ["USDT", "ETH", "BRON", "SOL", "DOT"]);

  const eth = r.positions.find((p) => p.symbol === "ETH");
  assert.equal(eth.idle, "2");
  assert.equal(eth.locked, "0");
  assert.equal(eth.idleUsd, "400"); // 400 × (2/2)
  assert.equal(eth.eligible, true);
  assert.equal(eth.bucket, "native-staking");
  assert.match(eth.recommendation, /Native staking on ETH/);

  const sol = r.positions.find((p) => p.symbol === "SOL");
  assert.equal(sol.locked, "6"); // 10 − 4
  assert.equal(sol.idleUsd, "80"); // 200 × (4/10)

  // Off-list asset is kept (idle clears dust) but flagged ineligible with the literal disclaimer.
  const bron = r.positions.find((p) => p.symbol === "BRON");
  assert.equal(bron.eligible, false);
  assert.equal(bron.bucket, null);
  assert.equal(bron.recommendation, "BRON — not on the verified stakeable list. Check protocol docs before considering.");

  // Fully-locked row survives the filter on locked>0 even though idleUsd is 0.
  const dot = r.positions.find((p) => p.symbol === "DOT");
  assert.equal(dot.idleUsd, "0");
  assert.equal(dot.locked, "5");

  assert.equal(r.totals.idleUsd, "1080"); // 500+400+100+80+0
  assert.equal(r.totals.eligibleIdleUsd, "980"); // BRON excluded (off-list)
});

test("staking_opportunities: symbol filter restricts results", async () => {
  const r = await stakingOpportunitiesTool.handler(mockStakingCtx(), { symbol: "eth" });
  assert.equal(r.positions.length, 1);
  assert.equal(r.positions[0].symbol, "ETH");
});
