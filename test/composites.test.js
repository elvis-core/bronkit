import { test } from "node:test";
import assert from "node:assert/strict";
import { accountsOverviewTool, costBasisTool, stakingOpportunitiesTool, stakingRewardsTool } from "../src/tools/composites.js";

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
  // includeOffList:true to keep BRON (off-list) in positions for these legacy assertions.
  const r = await stakingOpportunitiesTool.handler(mockStakingCtx(), { includeOffList: true });
  // Sorted by idle USD desc: USDT(500), ETH(400), BRON(100), SOL(80), DOT(0-but-locked).
  assert.deepEqual(r.positions.map((p) => p.symbol), ["USDT", "ETH", "BRON", "SOL", "DOT"]);

  const eth = r.positions.find((p) => p.symbol === "ETH");
  assert.equal(eth.idle, "2");
  assert.equal(eth.locked, "0");
  assert.equal(eth.idleUsd, "400"); // 400 × (2/2)
  assert.equal(eth.eligible, true);
  assert.equal(eth.bucket, "native-staking");
  assert.match(eth.recommendation, /Native staking/);

  const sol = r.positions.find((p) => p.symbol === "SOL");
  assert.equal(sol.locked, "6"); // 10 − 4
  assert.equal(sol.idleUsd, "80"); // 200 × (4/10)

  // Off-list asset is kept (idle clears dust) but flagged ineligible with the literal disclaimer.
  const bron = r.positions.find((p) => p.symbol === "BRON");
  assert.equal(bron.eligible, false);
  assert.equal(bron.bucket, null);
  assert.equal(bron.recommendation, "Off-list — check protocol docs");

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

// Mock client for staking rewards: one stake-delegation tx (principal 10 ETH
// $20k) + one stake-claim tx with an embedded stake-earn-reward (0.5 ETH $1000).
// Exercises API-level filter, event aggregation, APR math, totals.
function mockRewardsCtx() {
  return {
    workspaceId: "ws_test",
    client: {
      async get(path, q) {
        if (path.endsWith("/transactions")) {
          if (q && q.offset && q.offset > 0) return { transactions: [] };
          return {
            transactions: [
              {
                transactionType: "stake-delegation",
                _embedded: {
                  events: [
                    { eventType: "stake-delegation", assetId: "E", symbol: "ETH", networkId: "ETH", amount: "10", usdAmount: "20000", createdAt: "2026-01-15" },
                  ],
                },
              },
              {
                transactionType: "stake-claim",
                _embedded: {
                  events: [
                    { eventType: "stake-earn-reward", assetId: "E", symbol: "ETH", networkId: "ETH", amount: "0.5", usdAmount: "1000", createdAt: "2026-06-15" },
                  ],
                },
              },
            ],
          };
        }
        return {};
      },
    },
  };
}

test("staking_rewards: aggregates events, computes APR estimate", async () => {
  const r = await stakingRewardsTool.handler(mockRewardsCtx(), {
    from: "2026-01-01T00:00:00Z",
    to: "2026-07-01T00:00:00Z",
  });
  assert.equal(r.positions.length, 1);
  const eth = r.positions[0];
  assert.equal(eth.symbol, "ETH");
  assert.equal(eth.rewards, "0.5");
  assert.equal(eth.rewardsUsd, "1000");
  assert.equal(eth.principal, "10");
  assert.equal(eth.principalUsd, "20000");
  assert.equal(eth.periodPct, "5"); // 1000 / 20000 × 100
  // days = 181 (Jan 1 → Jul 1). APR ≈ 5 × 365/181 ≈ 10.08.
  const apr = parseFloat(eth.aprPct);
  assert.ok(apr > 10 && apr < 10.5, `APR was ${eth.aprPct}`);
  assert.equal(r.totals.rewardsUsd, "1000");
  assert.equal(r.totals.principalUsd, "20000");
  assert.equal(r.transactionsScanned, 2);
});

test("staking_rewards: symbol filter restricts results", async () => {
  const r = await stakingRewardsTool.handler(mockRewardsCtx(), {
    from: "2026-01-01T00:00:00Z",
    to: "2026-07-01T00:00:00Z",
    symbol: "btc",
  });
  assert.equal(r.positions.length, 0);
  assert.equal(r.totals.rewardsUsd, "0");
});

// Capturing mock for the date-format regression test.
function mockRewardsCaptureCtx() {
  const calls = [];
  return {
    calls,
    workspaceId: "ws_test",
    client: {
      async get(path, q) {
        calls.push({ path, q });
        if (path.endsWith("/transactions")) return { transactions: [] };
        return {};
      },
    },
  };
}

test("staking_rewards: sends createdAtFrom/To as Unix-ms strings (not ISO)", async () => {
  const ctx = mockRewardsCaptureCtx();
  await stakingRewardsTool.handler(ctx, {
    from: "2026-01-01T00:00:00Z",
    to: "2026-07-01T00:00:00Z",
  });
  const call = ctx.calls.find((c) => c.path.endsWith("/transactions"));
  assert.ok(call, "expected a /transactions call");
  // 2026-01-01T00:00:00Z = 1767225600000 ; 2026-07-01T00:00:00Z = 1782864000000
  assert.equal(call.q.createdAtFrom, "1767225600000");
  assert.equal(call.q.createdAtTo, "1782864000000");
});

test("staking_opportunities default: off-list rows excluded, summarised separately", async () => {
  const r = await stakingOpportunitiesTool.handler(mockStakingCtx(), {});
  // BRON is off-list and should not appear in positions by default.
  assert.ok(!r.positions.some((p) => p.symbol === "BRON"), "BRON should be hidden by default");
  // Eligible rows remain.
  assert.deepEqual(r.positions.map((p) => p.symbol).sort(), ["DOT", "ETH", "SOL", "USDT"]);
  // Summary captures the off-list aggregate.
  assert.equal(r.offListSummary.count, 1);
  assert.equal(r.offListSummary.idleUsd, "100");
  assert.deepEqual(r.offListSummary.symbols, ["BRON"]);
});

// Mock for bron_accounts_overview: two accounts, balances split across them.
function mockOverviewCtx() {
  return {
    workspaceId: "ws_test",
    client: {
      async get(path) {
        if (path.endsWith("/accounts")) {
          return {
            accounts: [
              { accountId: "a1", accountName: "Main", accountType: "vault", status: "active" },
              { accountId: "a2", accountName: "DeFi", accountType: "vault", status: "active" },
            ],
          };
        }
        if (path.endsWith("/balances")) {
          return {
            balances: [
              { accountId: "a1", assetId: "E", symbol: "ETH", networkId: "ETH", totalBalance: "1" },
              { accountId: "a1", assetId: "U", symbol: "USDC", networkId: "ETH", totalBalance: "500" },
              { accountId: "a2", assetId: "E", symbol: "ETH", networkId: "ETH", totalBalance: "0.05" },
            ],
          };
        }
        if (path === "/dictionary/asset-market-prices") {
          return {
            prices: [
              { baseAssetId: "E", quoteSymbolId: "s09", price: "2000" },
              { baseAssetId: "U", quoteSymbolId: "s09", price: "1" },
            ],
          };
        }
        return {};
      },
    },
  };
}

test("accounts_overview: per-account totals + portfolio total, sorted desc", async () => {
  const r = await accountsOverviewTool.handler(mockOverviewCtx());
  // Main: ETH 1×$2000 + USDC 500×$1 = $2500; DeFi: ETH 0.05×$2000 = $100. Total $2600.
  assert.deepEqual(r.accounts.map((a) => a.accountName), ["Main", "DeFi"]);
  const main = r.accounts.find((a) => a.accountName === "Main");
  const defi = r.accounts.find((a) => a.accountName === "DeFi");
  assert.equal(main.totalUsd, 2500);
  assert.equal(main.assetCount, 2);
  assert.equal(defi.totalUsd, 100);
  assert.equal(defi.assetCount, 1);
  assert.equal(r.totals.holdingsValue, 2600);
  assert.equal(r.totals.accountCount, 2);
});
