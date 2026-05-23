---
name: bron-cost-basis
description: |
  Compute FIFO cost basis and rank holdings by realised/unrealised P&L on the
  Bron treasury platform. Use when the user asks "which holdings am I up on",
  "what did I pay for X", "rank my positions by profit", "show me my P&L",
  "how much have I made on ETH", "calculate my gains", "what's my break-even
  on Y", "how much have I lost on Z", or anything that requires knowing cost
  basis. Read-only — no state changes, no confirmation needed. Walks the full
  transaction history (paginated, no row cap), reconstructs FIFO cost basis
  from event-level historical USD pricing, folds fees into realised P&L, and
  ranks holdings by unrealised gain. Does not ask the user to provide entry
  prices — reconstructs from `event.usdAmount` recorded at settlement time.
  For current balances use `bron-balances-read`; for raw transaction history
  use `bron-tx-read`.
license: MIT
allowed-tools: |
  Bash(bron tx:*) Bash(bron balances:*)
  Bash(jq:*) Bash(python3:*) Bash(mkdir:*) Bash(test:*) Bash(find:*) Bash(date:*)
  Read
metadata:
  vendor: bronlabs
  version: "0.2.0"
  bron-cli-min: "0.3.7"
---

# Bron cost basis: FIFO P&L

Read-only. No state changes; safe without confirmation.

This skill reconstructs FIFO (first-in-first-out) cost basis directly from transaction history. **It does not ask the user for entry prices** — `event.usdAmount` is recorded at settlement time and is authoritative as historical basis. Verified across recent and 7-month-old events (see "Pricing model" below).

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

## Pricing model

Each event carries `usdAmount` priced at `createdAt` time, not current spot. Verified empirically: e.g. ZAMA at swap time was $0.0342/unit per the recorded `usdAmount`; today it's $0.0268. FIFO can therefore be computed cleanly in USD using `event.usdAmount` directly — no external price-history API needed.

For old events with extreme dust, `usdAmount` may round to "0.0000". Treat as $0 cost (effectively a zero-basis lot — won't affect P&L unless later sold).

## Default flow

The skill runs four stages in order:

1. **Walk all completed transactions across the workspace** with `--embed events`, paginating with `--limit 500 --offset N` until a short page is returned.
2. **Preprocess events**: filter internal transfers, fold same-asset fees into the matching out event, surface different-asset fees as separate disposals against the fee asset's FIFO, lift reward events as zero-basis acquisitions.
3. **Run FIFO** chronologically across the global event timeline, maintaining one queue per `assetId`.
4. **Join with current balances** (`bron balances list --embed prices`) for unrealised P&L against current spot.

## Stage 1 — paginate the full history

```bash
CACHE_DIR=~/.bron/cache
mkdir -p "$CACHE_DIR"
ALL_TX=$(mktemp); : > "$ALL_TX"

OFFSET=0
LIMIT=500
while : ; do
  PAGE=$(bron tx list \
            --transactionStatuses completed,partially-completed \
            --embed events \
            --limit "$LIMIT" \
            --offset "$OFFSET" \
            --output json)
  COUNT=$(echo "$PAGE" | jq '.transactions | length')
  [ "$COUNT" -eq 0 ] && break
  echo "$PAGE" | jq -c '.transactions[]' >> "$ALL_TX"
  [ "$COUNT" -lt "$LIMIT" ] && break
  OFFSET=$((OFFSET + LIMIT))
done
```

`$ALL_TX` is now JSONL — one transaction per line, every event embedded. **No row cap.** Both `completed` and `partially-completed` are valid `TransactionStatus` enum values; including both ensures partial-fill swaps contribute their actual settled events.

## Stage 2 — preprocess into a uniform event stream

The preprocessing step turns raw events into a normalised `{type, asset, amount, usd, ts, ...}` stream:

- **Internal transfers** (where `extra.in[].fromAccountId` or `extra.out[].toAccountId` is set on a workspace account) → **skip**, both legs.
- **`in` events** from deposit / swap-in / bridge-in → emit `buy` with `usd = event.usdAmount`.
- **Reward events** (`stake-earn-reward`, `stake-take-reward`, `canton-reward`, `loyalty-reward`) → emit `buy` with **`usd = 0`** (income realised at sale).
- **`out` events** → look up same-asset fees in the same `transactionId`. If found, **net them in**: `amount = out.amount + fee.amount`, `usd = max(0, out.usdAmount - fee.usdAmount)`. Emit one `sell`. The clamp prevents nonsensical negative-proceeds disposals when same-asset fees approach or exceed the moved amount.
- **`fee` events** with a different assetId from any `out` in the same tx (the common case — ETH gas on an ERC-20 op) → emit `sell` against the fee asset's FIFO with `is_fee: true`.

```bash
EVENTS=$(mktemp)
jq -s '
  def is_internal_in:  any((.extra.in[]?  | .fromAccountId); . != null);
  def is_internal_out: any((.extra.out[]? | .toAccountId);   . != null);
  def is_reward: . as $t | ["stake-earn-reward","stake-take-reward","canton-reward","loyalty-reward"] | index($t) != null;

  [.[] | ._embedded.events[]?] as $events
  | ($events | group_by(.transactionId)) as $by_tx
  | [ $by_tx[] | . as $tx_events
      | ($tx_events | map(select(.eventType == "out"))) as $outs
      | ($tx_events | map(select(.eventType == "fee"))) as $fees
      | ($tx_events | map(select(.eventType == "in" or (.eventType | is_reward)))) as $ins
      | (
          # Buys / rewards
          ($ins[]
            | select(is_internal_in | not)
            | {
                type:    "buy",
                asset:   .assetId,
                symbol:  .symbol,
                network: .networkId,
                amount:  (.amount    // "0" | tonumber),
                usd:     (if (.eventType | is_reward) then 0 else (.usdAmount // "0" | tonumber) end),
                ts:      .createdAt
              }
          ),
          # Sells with same-asset fee netting (clamp to >= 0)
          ($outs[]
            | select(is_internal_out | not)
            | . as $out
            | ($fees | map(select(.assetId == $out.assetId))) as $same_fees
            | ($same_fees | map(.amount    | tonumber) | add // 0) as $fee_amt
            | ($same_fees | map(.usdAmount // "0" | tonumber) | add // 0) as $fee_usd
            | {
                type:    "sell",
                asset:   $out.assetId,
                symbol:  $out.symbol,
                network: $out.networkId,
                amount:  ($out.amount    // "0" | tonumber) + $fee_amt,
                usd:     ((($out.usdAmount // "0" | tonumber) - $fee_usd) | if . < 0 then 0 else . end),
                ts:      $out.createdAt,
                is_fee:  false
              }
          ),
          # Different-asset fees as standalone sells
          ($fees[]
            | . as $fee
            | ($outs | map(.assetId) | index($fee.assetId)) as $matched
            | select($matched == null)
            | {
                type:    "sell",
                asset:   $fee.assetId,
                symbol:  $fee.symbol,
                network: $fee.networkId,
                amount:  ($fee.amount    | tonumber),
                usd:     ($fee.usdAmount // "0" | tonumber),
                ts:      $fee.createdAt,
                is_fee:  true
              }
          )
        )
    ]
  | sort_by(.ts)
' "$ALL_TX" > "$EVENTS"
```

`$EVENTS` is now chronologically-sorted, internal-transfer-stripped, with fees folded.

## Stage 3 — FIFO core (Python helper)

> **Why Python here, not jq.** The previous version of this skill attempted FIFO entirely in jq — nested `reduce` over per-asset queues with partial-lot proportional basis decrements. The result was ~80 lines of mutually-mutating array-of-objects accumulators, with a partial-consume bug that under-counted basis. Python's mutable dict + `Decimal` arithmetic makes this a 25-line state machine that's easy to verify by inspection. Every other transformation in the skill stays in jq; Python is the surgical tool only for the FIFO core.

```bash
FIFO_OUT=$(mktemp)
python3 - "$EVENTS" > "$FIFO_OUT" <<'PYEOF'
import json, sys
from decimal import Decimal
from collections import defaultdict

events = json.load(open(sys.argv[1]))

queues        = defaultdict(list)      # assetId -> [{qty, cost_usd, ts}]
realised      = defaultdict(Decimal)   # assetId -> realised P&L (USD)
symbol_meta   = {}                     # assetId -> {symbol, network}
lifetime_fees = Decimal(0)

def D(x): return Decimal(str(x))

for e in events:
    aid = e["asset"]
    symbol_meta[aid] = {"symbol": e.get("symbol"), "network": e.get("network")}
    amt = D(e["amount"])
    usd = D(e["usd"])

    if e["type"] == "buy":
        queues[aid].append({"qty": amt, "cost_usd": usd, "ts": e["ts"]})

    elif e["type"] == "sell":
        if e.get("is_fee"):
            lifetime_fees += usd
        remaining      = amt
        basis_consumed = Decimal(0)
        while remaining > 0 and queues[aid]:
            lot = queues[aid][0]
            if lot["qty"] <= remaining:
                basis_consumed += lot["cost_usd"]
                remaining      -= lot["qty"]
                queues[aid].pop(0)
            else:
                share          = remaining / lot["qty"]
                partial_basis  = lot["cost_usd"] * share
                basis_consumed += partial_basis
                lot["cost_usd"] -= partial_basis
                lot["qty"]      -= remaining
                remaining       = Decimal(0)
        # If we sold more than was ever acquired, leftover `remaining` has no
        # basis in our records. Treat as a zero-basis disposal: don't add to
        # basis_consumed, so the full proceeds for that portion become
        # realised gain. Covers airdrops without a recorded acquisition event,
        # untracked rewards, and any holdings that pre-date Bron tracking.
        # (No code needed — the loop simply exited without consuming the
        # remainder; basis_consumed stays as-is and the realised line below
        # captures the full unmatched proceeds in the realised total.)
        realised[aid] += usd - basis_consumed

# Per-asset summary (open lots only)
out = []
for aid in set(list(queues.keys()) + list(realised.keys())):
    q     = queues[aid]
    held  = sum((l["qty"] for l in q), Decimal(0))
    basis = sum((l["cost_usd"] for l in q), Decimal(0))
    avg   = (basis / held) if held > 0 else Decimal(0)
    out.append({
        "assetId":   aid,
        "symbol":    symbol_meta.get(aid, {}).get("symbol"),
        "network":   symbol_meta.get(aid, {}).get("network"),
        "held":      float(held),
        "avg_basis": float(avg),
        "realised":  float(realised[aid]),
    })

print(json.dumps({"positions": out, "lifetime_fees": float(lifetime_fees)}))
PYEOF
```

## Stage 4 — join with current spot, build the output

```bash
BAL=$(mktemp)
bron balances list --nonEmpty true --embed prices --output json > "$BAL"

jq --slurpfile bal "$BAL" --argjson dust "$DUST" '
  ($bal[0].balances // []
    | map({key: .assetId, value: (._embedded.usdPrice // "0" | tonumber)})
    | from_entries) as $price

  | .lifetime_fees as $fees
  | [.positions[]
      | . + {
          current_price:  ($price[.assetId] // 0),
          unrealised_usd: ((($price[.assetId] // 0) - .avg_basis) * .held),
          unrealised_pct: (
            if .avg_basis > 0
            then ((($price[.assetId] // 0) - .avg_basis) / .avg_basis * 100)
            else null
            end
          )
        }
      | select(.held >= $dust or .realised != 0)
    ]
  | sort_by(-.unrealised_usd)
  | { positions: ., lifetime_fees: $fees }
' "$FIFO_OUT"
```

## Output format

Render as a single ranked table. Columns:

**Symbol · Network · Held · Avg Basis · Current Price · Unrealised % · Unrealised $ · Realised $ (lifetime)**

Sort by Unrealised $ descending. `Unrealised %` for zero-basis positions (pure rewards / untraced holdings) renders as `—`.

Append footer:

```
Lifetime fees paid (folded into realised P&L above): $X
```

Example (illustrative):

> | Symbol | Network | Held | Avg Basis | Current | Unrealised % | Unrealised $ | Realised $ |
> |---|---|---:|---:|---:|---:|---:|---:|
> | ETH | ETH | 0.4261 | $1,840.20 | $2,222.08 | +20.8% | +$162.74 | -$3.24 |
> | SOL | SOL | 9.4596 | $72.40 | $89.16 | +23.1% | +$158.55 | $0.00 |
> | BRON | ETH | 10000 | $0.0680 | $0.0708 | +4.1% | +$28.00 | $0.00 |
> | CC | CC | 31077.28 | $0.1620 | $0.1568 | -3.2% | -$161.60 | $0.00 |
> | ZAMA | ETH | 14253.55 | $0.0342 | $0.0268 | -21.6% | -$105.45 | $0.00 |
>
> Lifetime fees paid (folded into realised P&L above): $4.18

## Common questions and how to answer them

| User asks | Approach |
|---|---|
| "Which holdings am I up on?" | Run pipeline, filter `unrealised_usd > 0`, return as ranked table |
| "Rank my positions by profit" | Default ordering already does this — present the table |
| "What did I pay for [X]?" | Filter to symbol = X, return `avg_basis` |
| "How much have I made on [X]?" | Filter to X, sum `unrealised_usd + realised` |
| "What's my break-even on [X]?" | Filter to X, return `avg_basis` (= break-even) |
| "How much have I paid in fees?" | `lifetime_fees` footer line |
| "Show realised vs unrealised separately" | Two tables: realised column ranked, then unrealised column ranked |

## What this skill does NOT do

- **Does not ask the user for entry prices.** Reconstructs from `event.usdAmount` recorded at settlement.
- **Does not stop at 100 transactions.** Paginates through full workspace history.
- **Does not invent USD for events that have no `usdAmount`.** Falls back to $0; the position will show inflated unrealised gain — flag in output if any held lot has zero basis.
- **Does not do specific-ID lot selection or wash-sale rules.** FIFO only. Tax planning is your accountant's job.
- **Does not infer cost basis for assets present at workspace creation.** If a holding has no traceable `in` event in history, basis defaults to $0 and the row is flagged. Sells of such untracked acquisitions are treated as zero-basis disposals (full proceeds = realised gain).
- **Does not compute multi-currency P&L.** All numbers in USD via `event.usdAmount`.

## Discovery

```bash
bron tx list --help
bron tx list --schema
bron tx events --schema
bron balances list --help
bron balances list --schema
```

Workspace IDs in user-facing examples are masked as `ws_xxxxxxxxxxxxxxxxxxxxxxxx`.

## Related skills

- **`bron-balances-read`** — for current portfolio view; cross-check held quantities against this skill's `held` column
- **`bron-tx-read`** — to drill into the individual transactions behind a position's basis
- **`bron-defi-positions`** — DeFi-position cost basis lives there; this skill covers spot holdings only
- **`bron-onboarding`** — reads `dustThreshold` for the position filter
