// Composite tools — server-side multi-call orchestration + computation that
// returns a finished result, so the model makes one call instead of being made
// to orchestrate. Read-only.

import Decimal from "decimal.js";
import { preprocessEvents, runFifo } from "../util/fifo.js";
import { fetchUsdPriceMap, attachUsdPrices } from "../util/prices.js";
import { readDustThreshold } from "../util/dust.js";

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const ws = (ctx) => `/workspaces/${ctx.workspaceId}`;
const PAGE = 500;
const MAX_PAGES = 200; // safety cap: 200 × 500 = 100k transactions

// Walk the full completed/partially-completed history with events embedded.
async function fetchHistoryWithEvents(ctx) {
  const all = [];
  for (let page = 0, offset = 0; page < MAX_PAGES; page++, offset += PAGE) {
    const resp = await ctx.client.get(`${ws(ctx)}/transactions`, {
      transactionStatuses: "completed,partially-completed",
      includeEvents: true,
      limit: PAGE,
      offset,
    });
    const txs = (resp && resp.transactions) || [];
    all.push(...txs);
    if (txs.length < PAGE) break;
  }
  return all;
}

export const costBasisTool = {
  name: "bron_cost_basis",
  title: "Cost basis & P&L",
  description:
    "FIFO cost basis with realised + unrealised P&L per holding, reconstructed from full transaction history (event-level USD pricing, fees folded in). Read-only. Use for 'what did I pay for X', 'which holdings am I up on', 'rank by profit', 'lifetime fees'.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Optional: restrict to one asset symbol, e.g. ETH" },
      includeDust: { type: "boolean", description: "Include sub-threshold positions (default false)" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  handler: async (ctx, a = {}) => {
    const txs = await fetchHistoryWithEvents(ctx);
    const stream = preprocessEvents(txs);
    const { positions, lifetimeFees } = runFifo(stream);

    const heldAssets = positions.filter((p) => new Decimal(p.held).gt(0)).map((p) => p.assetId);
    const priceMap = await fetchUsdPriceMap(ctx.client, heldAssets);
    const dust = new Decimal(readDustThreshold());

    const usd = (d) => new Decimal(d).toDecimalPlaces(2).toString(); // 2 dp for $ amounts
    const px = (d) => new Decimal(d).toDecimalPlaces(6).toString(); // 6 dp for per-unit prices
    let rows = positions.map((p) => {
      const held = new Decimal(p.held);
      const avg = new Decimal(p.avgBasis);
      const price = new Decimal(priceMap.get(p.assetId)?.price ?? 0);
      return {
        symbol: p.symbol,
        network: p.network,
        assetId: p.assetId,
        held: p.held, // full precision — quantities matter
        avgBasis: px(avg),
        currentPrice: px(price),
        currentValue: usd(held.times(price)),
        unrealisedUsd: usd(price.minus(avg).times(held)),
        unrealisedPct: avg.gt(0) ? price.minus(avg).div(avg).times(100).toDecimalPlaces(2).toString() : null,
        realised: usd(p.realised),
      };
    });

    // USD-value dust filter (not the skill's buggy held-quantity compare).
    if (!a.includeDust) {
      rows = rows.filter((p) => new Decimal(p.currentValue).gte(dust) || !new Decimal(p.realised).eq(0));
    }
    if (a.symbol) {
      const s = a.symbol.toUpperCase();
      rows = rows.filter((p) => (p.symbol || "").toUpperCase() === s);
    }
    rows.sort((x, y) => new Decimal(y.unrealisedUsd).cmp(new Decimal(x.unrealisedUsd)));

    const sum = (pick) => usd(rows.reduce((s, p) => s.plus(new Decimal(pick(p))), new Decimal(0)));
    const totals = {
      holdingsValue: sum((p) => p.currentValue), // total USD you currently hold
      unrealisedUsd: sum((p) => p.unrealisedUsd),
      realisedUsd: sum((p) => p.realised),
    };
    return { positions: rows, totals, lifetimeFees: usd(lifetimeFees), transactionsScanned: txs.length };
  },
};

// Curated stakeable / lendable allow-list (ported from the bron-opportunities
// skill). Conservative on purpose: off-list assets get a "check protocol docs"
// disclaimer rather than a guess. APY is NEVER quoted — Bron embeds no protocol
// rates, so we point at the venue's dashboard for live numbers instead.
const STAKE_BUCKETS = {
  "native-staking": new Set(["SOL", "ETH", "DOT", "ATOM", "MATIC", "AVAX", "NEAR", "ADA", "TIA", "DYDX"]),
  "stable-lending": new Set(["USDC", "USDT", "DAI"]),
  "btc-lending": new Set(["WBTC", "CBBTC"]),
};

function classifyIdle(symbol) {
  const s = (symbol || "").toUpperCase();
  if (STAKE_BUCKETS["native-staking"].has(s)) {
    return {
      bucket: "native-staking",
      recommendation: `Native staking on ${symbol} — see validator marketplaces or liquid-staking protocols`,
    };
  }
  if (STAKE_BUCKETS["stable-lending"].has(s) || STAKE_BUCKETS["btc-lending"].has(s)) {
    const bucket = STAKE_BUCKETS["stable-lending"].has(s) ? "stable-lending" : "btc-lending";
    return { bucket, recommendation: "Lend on Aave or Compound — see the Aave dashboard for current rates" };
  }
  return {
    bucket: null,
    recommendation: `${symbol} — not on the verified stakeable list. Check protocol docs before considering.`,
  };
}

const dec = (v) => {
  try {
    return new Decimal(v == null || v === "" ? 0 : v);
  } catch {
    return new Decimal(0);
  }
};

export const stakingOpportunitiesTool = {
  name: "bron_staking_opportunities",
  title: "Staking & yield opportunities",
  description:
    "Idle capital + staking/lending options across current holdings. Derives idle from withdrawableBalance (totalBalance − withdrawable = already-working), classifies each asset against a curated allow-list, and points at the venue's dashboard for rates. Never quotes APY. Read-only. Use for 'what could I be staking', 'where's my idle capital', 'what's not earning yield', 'show staking/lending options', 'how much of my X is idle'.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Optional: restrict to one asset symbol, e.g. ETH" },
      includeDust: { type: "boolean", description: "Include sub-threshold idle positions (default false)" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  handler: async (ctx, a = {}) => {
    // Raw balances (NOT the dust-filtered read tool) + prices, so we keep every
    // row and apply the idle-specific filter ourselves. withdrawableBalance is
    // the authoritative idle signal; Bron prices the whole position, so we
    // prorate usdValue by the idle share.
    const data = await ctx.client.get(`${ws(ctx)}/balances`, { nonEmpty: true });
    await attachUsdPrices(ctx.client, data);
    const dust = new Decimal(readDustThreshold());
    const usd = (d) => new Decimal(d).toDecimalPlaces(2).toString();
    const balances = (data && Array.isArray(data.balances) && data.balances) || [];

    let rows = balances.map((b) => {
      const total = dec(b.totalBalance);
      const idle = dec(b.withdrawableBalance); // missing → 0 (treated as fully locked)
      const locked = total.minus(idle);
      const usdTotal = dec(b._embedded && b._embedded.usdValue);
      const ratio = total.gt(0) ? idle.div(total) : new Decimal(0);
      const idleUsd = usdTotal.times(ratio);
      const cls = classifyIdle(b.symbol);
      return {
        symbol: b.symbol,
        network: b.networkId,
        assetId: b.assetId,
        total: total.toString(), // full precision — quantities matter
        idle: idle.toString(),
        locked: locked.toString(),
        idleUsd: usd(idleUsd),
        eligible: cls.bucket !== null,
        bucket: cls.bucket,
        recommendation: cls.recommendation,
      };
    });

    // Keep a row if its idle USD clears the dust threshold OR it has something
    // locked worth surfacing (mirrors the skill's filter).
    if (!a.includeDust) {
      rows = rows.filter((p) => new Decimal(p.idleUsd).gte(dust) || new Decimal(p.locked).gt(0));
    }
    if (a.symbol) {
      const s = a.symbol.toUpperCase();
      rows = rows.filter((p) => (p.symbol || "").toUpperCase() === s);
    }
    rows.sort((x, y) => new Decimal(y.idleUsd).cmp(new Decimal(x.idleUsd)));

    const sumIdle = (list) => usd(list.reduce((s, p) => s.plus(new Decimal(p.idleUsd)), new Decimal(0)));
    const totals = {
      idleUsd: sumIdle(rows), // total deployable idle USD across all rows
      eligibleIdleUsd: sumIdle(rows.filter((p) => p.eligible)), // idle USD on assets we can act on
    };
    return {
      positions: rows,
      totals,
      note: "APY/yield is not quoted — check the linked protocol dashboards for live rates.",
    };
  },
};

export const compositeTools = [costBasisTool, stakingOpportunitiesTool];
