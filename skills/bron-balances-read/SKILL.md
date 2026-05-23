---
name: bron-balances-read
description: |
  Read account balances and produce portfolio views on the Bron treasury
  platform. Use when the user asks "what's in account X", "show me balances",
  "what's my portfolio", "how is my portfolio allocated", "what's my USD
  position", "am I over-concentrated", "show me my top holdings", "list all
  non-zero positions", or anything else about what they hold and how it splits.
  Read-only — no state changes, no confirmation needed. Knows how to filter
  dust and unpriced tokens, compute % allocation per position, flag positions
  over the user's portfolio cap, and aggregate USD totals.
  For transaction history use `bron-tx-read`; for FIFO cost basis use
  `bron-cost-basis`; for DeFi position reconstruction use `bron-defi-positions`.
license: MIT
allowed-tools: |
  mcp__bron__bron_balances_list mcp__bron__bron_accounts_list
  mcp__bron__bron_assets_list
  Bash(jq:*) Bash(test:*)
  Read
metadata:
  vendor: bronlabs
  version: "0.2.0"
  bron-cli-min: "0.3.7"
---

# Bron balances: read

Read-only. No state changes; safe without confirmation.

This skill drives the `mcp__bron__bron_balances_list` MCP tool and adds two things on top: an opinionated portfolio view (dust dropped, USD-priced, % per position, cap-breach flagged), and shared filter / aggregation patterns used by other skills.

## Preferences

Read user-configurable values from `~/.bron/preferences.json`:

```bash
PREFS=~/.bron/preferences.json
if [ -f "$PREFS" ]; then
  CAP=$(jq -r '.portfolioCap // 15' "$PREFS")
  DUST=$(jq -r '.dustThreshold // 1' "$PREFS")
  CURRENCY=$(jq -r '.displayCurrency // "USD"' "$PREFS")
else
  CAP=15; DUST=1; CURRENCY=USD
fi
```

| Setting | Default | Meaning |
|---|---|---|
| `portfolioCap` | 15 | % of total above which a position is flagged as a concentration risk |
| `dustThreshold` | 1 | USD value below which a position is hidden from views |
| `displayCurrency` | USD | Currency used in the formatted view |

**When preferences file is missing**, run with defaults and append this footer to the response:

> ---
> *Using default settings: portfolio cap 15%, dust threshold $1, currency USD. Type "bron setup" to customise.*

Skip the footer once the file exists. See `bron-onboarding` for the setup flow.

## Default flow

```text
mcp__bron__bron_balances_list { nonEmpty: true, embed: "prices" }
```

`embed: "prices"` attaches `_embedded.usdPrice` and `_embedded.usdValue` per balance row. Decimals come back as strings — coerce only when summing.

`nonEmpty: true` is almost always what you want.

For the full request / response shape, the MCP tool descriptor is self-describing — the agent host surfaces typed parameter and result schemas directly.

## Portfolio view — the canonical pattern

For any "show me my portfolio / allocation / breakdown" question:

1. Call `mcp__bron__bron_balances_list { nonEmpty: true, embed: "prices" }`.
2. Per balance row, read `symbol`, `networkId`, `totalBalance` (string), `_embedded.usdPrice` (string), `_embedded.usdValue` (string). Coerce decimals to numbers only when summing or filtering.
3. Drop rows where `_embedded.usdValue < $DUST`.
4. Compute `$total = sum(usdValue across remaining rows)`.
5. Per row, compute `pct = (usdValue / $total) * 100` and `breach = (pct > $CAP)`.
6. Sort by `usdValue` descending.

Render as a table. Columns: **Symbol · Network · Amount · USD · % · (⚠ if breach)**.

Example output to user:

> **Total: $42,318.20** (3 accounts, 7 positions)
>
> | Symbol | Network | Amount | USD | % |
> |---|---|---|---|---|
> | USDC | ETH | 18,420 | $18,420.00 | **43.5%** ⚠ |
> | BTC | BTC | 0.42 | $14,200.00 | 33.6% |
> | ETH | ETH | 2.10 | $6,510.00 | 15.4% |
> | USDT | ARBITRUM | 2,150 | $2,150.00 | 5.1% |
> | MATIC | POLYGON | 1,200 | $872.40 | 2.1% |
> | LINK | ETH | 28 | $396.20 | 0.9% |
> | ARB | ARBITRUM | 450 | $179.60 | 0.4% |
>
> ⚠ USDC over your 15% concentration cap.

## Common variations

| User asks | Approach |
|---|---|
| "What's my biggest position?" | Run canonical pipeline, return top row only |
| "Am I over-concentrated?" | Filter to `breach == true`, list those; if none, say "all positions under cap" |
| "How much USDT across all chains?" | Aggregate by `symbol == "USDT"` after registry lookup (verified only), sum USD |
| "How much do I have on Ethereum?" | Add `networkIds: "ETH"` to the MCP call |
| "Show me account [name] balances" | Resolve name to accountId via `mcp__bron__bron_accounts_list {}`, then pass `accountIds: "<id>"` |
| "Show me only positions over $100" | Replace `$DUST` with the user's threshold |
| "Break down by chain" | After the canonical pipeline, group by `networkId`, sum USD per group |
| "What's my total worth?" | Just `$total` from the pipeline, no breakdown unless asked |

## Asset registry — for symbol lookups

If the user names an asset by symbol ("USDT", "BTC"), resolve via the registry. Multiple `assetId`s per symbol (one per network) — filter on `verified: true`.

```text
mcp__bron__bron_assets_list { limit: 500 }
```

From the response, filter the `assets` array where `symbol == "<requested>"` and `verified == true`. Collect the matching `assetId`s and pass them to subsequent calls (e.g. as `assetIds` on a balances or transactions query).

## What this skill does NOT do

- No transaction reads → `bron-tx-read`
- No transaction sending → `bron-tx-send`
- No FIFO cost basis or P&L → `bron-cost-basis` (planned)
- No DeFi position reconstruction → `bron-defi-positions` (planned)
- No preference writing → `bron-onboarding`

## Related skills

- **`bron-onboarding`** — runs the conversational setup that writes `~/.bron/preferences.json`
- **`bron-tx-read`** — for "what happened" questions; balances tells you what you have *now*
