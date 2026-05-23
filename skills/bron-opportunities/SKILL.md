---
name: bron-opportunities
description: |
  Detect idle capital and surface staking/lending options against current
  holdings on the Bron treasury platform. Use when the user asks "what
  could I be staking", "what idle capital could I be staking", "where's
  my idle capital", "where could I be earning yield", "show me yield
  options on my holdings", "show me staking options", "what could I lend",
  "what assets aren't earning anything", "what's not earning", "which
  positions should I stake", "what's my opportunity set", or anything
  about deploying idle balances. Read-only — no state changes, no
  confirmation needed. Uses the `withdrawableBalance` field as the
  authoritative idle signal and a curated allow-list of stakeable /
  lendable assets. Never quotes APY — points at protocol dashboards
  instead. For staking transaction creation use `bron-tx-send`; for
  DeFi position reconstruction use `bron-defi-positions`.
license: MIT
allowed-tools: |
  mcp__bron__bron_balances_list
  Bash(jq:*) Bash(test:*)
  Read
metadata:
  vendor: bronlabs
  version: "0.2.0"
  bron-cli-min: "0.3.7"
---

# Bron opportunities: idle capital & yield

Read-only. No state changes; safe without confirmation.

This skill identifies **idle capital** — the spendable portion of every balance — and surfaces staking or lending options against a curated allow-list. It uses `withdrawableBalance` as the authoritative idle signal: anything `totalBalance − withdrawableBalance` is treated as already-working and excluded from recommendations.

## Preferences

Read user-configurable values from `~/.bron/preferences.json`:

```bash
PREFS=~/.bron/preferences.json
if [ -f "$PREFS" ]; then
  DUST=$(jq -r '.dustThreshold // 1' "$PREFS")
  CURRENCY=$(jq -r '.displayCurrency // "USD"' "$PREFS")
else
  DUST=1; CURRENCY=USD
fi
```

If preferences file doesn't exist, use defaults and append this footer to the response:

> ---
> *Using default settings: dust threshold $1, currency USD. Type "bron setup" to customise.*

See `bron-onboarding` for setup.

## Default flow

```text
mcp__bron__bron_balances_list { nonEmpty: true, embed: "prices" }
```

Two fields drive everything:

| Field | Used as |
|---|---|
| `totalBalance` | Total holdings of this asset |
| `withdrawableBalance` | **Idle capital — the only thing eligible for new staking/lending recommendations** |

Anything `totalBalance − withdrawableBalance` is already locked. Surface the locked amount in the table; do **not** comment on what it means — the user is asking about deployable capital, not balance forensics.

The MCP tool descriptor is self-describing for the full filter set.

## Verified stakeable / lendable allow-list

The skill only recommends action for assets on this curated list. **It is conservative on purpose** — when in doubt, the skill says so rather than guessing.

| Bucket | Assets | Where |
|---|---|---|
| Native staking | SOL, ETH, DOT, ATOM, MATIC, AVAX, NEAR, ADA, TIA, DYDX | Native validators / liquid-staking tokens (e.g. Lido for ETH, Marinade for SOL) |
| Stable lending | USDC, USDT, DAI | Aave or Compound on ETH, ARB, POL, BASE |
| BTC lending | WBTC, cbBTC | Aave or Compound on ETH, ARB, POL, BASE |

The list is curated, not exhaustive. Users can extend it for their own positions; treat additions as out-of-scope until added explicitly.

For anything **off** the allow-list, the skill must output exactly:

> *<asset>* — not on the verified stakeable list. Check protocol docs before considering.

Never "might be stakeable", never "check if protocol supports staking" — those phrasings invite false confidence.

## Canonical pipeline

For each row in the `balances` array from the MCP response:

1. Read `totalBalance` (string → number) as `$total`.
2. Read `withdrawableBalance` (string → number) as `$idle`. Default to `0` if missing.
3. Compute `$locked = $total - $idle`.
4. Read `_embedded.usdValue` (string → number) as `$usd_total`. Default to `0`.
5. Compute `$usd_idle = $usd_total * ($idle / $total)` (treating `$total == 0` as `1` to avoid div-by-zero). This prorates the embedded USD value by the idle share — Bron prices the *position*, not the spendable subset.
6. Look up `(symbol, networkId)` against the allow-list buckets above. Produce a `recommendation` string per the bucket rules, or the literal off-list disclaimer.
7. Keep the row if `$usd_idle >= $DUST` **or** `$locked > 0` (so locked positions still appear when there's something worth surfacing).

Sort rows by `$usd_idle` descending.

## Output format

Render as a single table. Columns: **Symbol · Network · Total · Idle · Recommendation**.

Example:

> | Symbol | Network | Total | Idle | Recommendation |
> |---|---|---:|---:|---|
> | ETH | ETH | 0.4261 | 0.4261 | Native staking on ETH — see validator marketplaces or liquid-staking protocols |
> | SOL | SOL | 9.4596 | 0.4488 | Native staking on SOL — see validator marketplaces or liquid-staking protocols |
> | USDT | ETH | 353.80 | 353.80 | Lend on Aave or Compound (ETH) — see Aave dashboard for current rates |
> | BRON | ETH | 10000 | 10000 | BRON — not on the verified stakeable list. Check protocol docs before considering. |
> | CC | CC | 31077.28 | 31077.28 | CC — not on the verified stakeable list. Check protocol docs before considering. |

Never quote an APY or yield % — Bron does not embed protocol rates and the skill must not invent them. Always point at the dashboard / marketplace where the user can read live rates.

## Common questions and how to answer them

| User asks | Approach |
|---|---|
| "What idle capital could I be staking?" | Run canonical pipeline; return rows where idle ≥ dust, sorted by Idle |
| "Where could I be earning yield?" | Same as above |
| "What's not earning?" | Same — Idle column is the answer |
| "Show me staking options for [asset]" | Filter to that symbol; if off-list, return the literal disclaimer |
| "What could I lend?" | Filter table to stable + BTC buckets only |
| "Should I stake my [asset]?" | If on allow-list, return the recommendation. If off-list, return the literal disclaimer. Never guess. |
| "How much of my SOL is idle?" | Filter to SOL row; show Total, Idle, Locked side-by-side |

Workspace IDs in user-facing examples are masked as `ws_xxxxxxxxxxxxxxxxxxxxxxxx`.

## What this skill does NOT do

- **No `bron stakes list` calls.** The endpoint returned `{}` for an account that had ~95% of its SOL locked, and its response shape is undocumented in the public OpenAPI. The `totalBalance − withdrawableBalance` delta is the trustworthy signal instead.
- **No APY / yield-rate quotes.** Bron does not embed protocol yields; the skill points at the relevant dashboard (Aave, validator marketplace) instead.
- **No commentary on what locked balances are doing.** Surface the number, move on.
- **No stake transaction creation** → `bron-tx-send` (`stake-delegation`, `stake-undelegation`, `stake-claim`, `stake-withdrawal`).
- **No DeFi position reconstruction** → `bron-defi-positions`.
- **No transaction history of staking events** → `bron-tx-read`.
- **No portfolio rebalancing advice** → `bron-balances-read`.

## Related skills

- **`bron-balances-read`** — for total portfolio view; cross-check idle capital % of total
- **`bron-tx-send`** — to create `stake-delegation` / `stake-claim` transactions after deciding on an opportunity
- **`bron-defi-positions`** — for protocol-level position reconstruction
- **`bron-onboarding`** — reads `dustThreshold` for the idle-detection filter
