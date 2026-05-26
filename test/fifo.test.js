import { test } from "node:test";
import assert from "node:assert/strict";
import { preprocessEvents, runFifo } from "../src/util/fifo.js";

const ev = (o) => ({ ts: "t", ...o });

test("FIFO: consumes oldest lot first; realised + remaining basis correct", () => {
  const { positions } = runFifo([
    ev({ type: "buy", asset: "E", amount: "1", usd: "100" }),
    ev({ type: "buy", asset: "E", amount: "1", usd: "200" }),
    ev({ type: "sell", asset: "E", amount: "1", usd: "250" }),
  ]);
  const e = positions.find((p) => p.assetId === "E");
  assert.equal(e.realised, "150"); // 250 − 100 (first lot)
  assert.equal(e.held, "1");
  assert.equal(e.avgBasis, "200"); // remaining lot
});

test("FIFO: partial-lot proportional basis", () => {
  const { positions } = runFifo([
    ev({ type: "buy", asset: "E", amount: "2", usd: "200" }),
    ev({ type: "sell", asset: "E", amount: "1", usd: "150" }),
  ]);
  const e = positions.find((p) => p.assetId === "E");
  assert.equal(e.realised, "50"); // 150 − (200 × 0.5)
  assert.equal(e.held, "1");
  assert.equal(e.avgBasis, "100");
});

test("FIFO: oversell beyond holdings → zero-basis remainder (full proceeds = gain)", () => {
  const { positions } = runFifo([
    ev({ type: "buy", asset: "E", amount: "1", usd: "100" }),
    ev({ type: "sell", asset: "E", amount: "2", usd: "300" }),
  ]);
  const e = positions.find((p) => p.assetId === "E");
  assert.equal(e.realised, "200"); // 300 − 100
  assert.equal(e.held, "0");
});

test("FIFO: rewards are zero-basis acquisitions", () => {
  const { positions } = runFifo([
    ev({ type: "buy", asset: "R", amount: "5", usd: "0" }),
    ev({ type: "sell", asset: "R", amount: "5", usd: "50" }),
  ]);
  const r = positions.find((p) => p.assetId === "R");
  assert.equal(r.realised, "50");
  assert.equal(r.held, "0");
});

test("FIFO: is_fee sells accumulate lifetime fees", () => {
  const { lifetimeFees } = runFifo([
    ev({ type: "sell", asset: "E", amount: "0.01", usd: "1.2", is_fee: true }),
    ev({ type: "sell", asset: "E", amount: "0.005", usd: "0.6", is_fee: true }),
  ]);
  assert.equal(lifetimeFees, "1.8");
});

test("preprocess: folds same-asset fees, splits different-asset fees, skips internal transfers", () => {
  const stream = preprocessEvents([
    { _embedded: { events: [{ transactionId: "t1", eventType: "in", assetId: "E", symbol: "ETH", networkId: "ETH", amount: "1", usdAmount: "100", createdAt: "2024-01-01" }] } },
    { _embedded: { events: [
      { transactionId: "t2", eventType: "out", assetId: "E", symbol: "ETH", networkId: "ETH", amount: "0.5", usdAmount: "60", createdAt: "2024-01-02" },
      { transactionId: "t2", eventType: "fee", assetId: "E", symbol: "ETH", networkId: "ETH", amount: "0.01", usdAmount: "1.2", createdAt: "2024-01-02" },
    ] } },
    { _embedded: { events: [
      { transactionId: "t3", eventType: "out", assetId: "U", symbol: "USDC", networkId: "ETH", amount: "100", usdAmount: "100", createdAt: "2024-01-03" },
      { transactionId: "t3", eventType: "fee", assetId: "E", symbol: "ETH", networkId: "ETH", amount: "0.005", usdAmount: "0.6", createdAt: "2024-01-03" },
    ] } },
    { _embedded: { events: [{ transactionId: "t4", eventType: "in", assetId: "E", amount: "5", usdAmount: "500", createdAt: "2024-01-04", extra: { in: [{ fromAccountId: "acc1" }] } }] } },
  ]);

  assert.equal(stream.filter((e) => e.type === "buy").length, 1); // internal in skipped
  const sellE = stream.find((e) => e.asset === "E" && e.type === "sell" && !e.is_fee);
  assert.equal(sellE.amount.toString(), "0.51"); // 0.5 + 0.01 same-asset fee
  assert.equal(sellE.usd.toString(), "58.8"); // 60 − 1.2
  const feeSell = stream.find((e) => e.is_fee);
  assert.equal(feeSell.asset, "E");
  assert.equal(feeSell.usd.toString(), "0.6");
  assert.equal(stream.some((e) => e.amount.toString() === "5"), false); // internal transfer absent
});
