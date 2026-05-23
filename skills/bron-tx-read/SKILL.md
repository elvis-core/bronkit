---
name: bron-tx-read
description: |
  Read and analyse transactions on the Bron treasury platform. Use when the
  user asks "show me my last transactions", "what was the volume last week",
  "who paid me", "find the deposit from X", "show my income last month",
  "what did this swap actually trade", "summarise activity for account Y",
  "did this withdrawal complete?", "stablecoin inflows in March", etc.
  Read-only — no state changes, no confirmation needed.
  Knows the transaction-vs-events mental model (transactions are sagas,
  events carry real money movement), how to drive `bron tx list` with
  `--embed events` for accurate analysis, and the canonical pattern for
  priced inbound transfers from external addresses (income/consultancy/
  salary/staking rewards/anything that came in).
  For state changes (creating, approving, cancelling) use `bron-tx-send`.
  For live streaming, use `bron-tx-subscribe`.
license: MIT
allowed-tools: |
  mcp__bron__bron_tx_list mcp__bron__bron_tx_get mcp__bron__bron_tx_events
  mcp__bron__bron_accounts_list mcp__bron__bron_assets_list
  mcp__bron__bron_address_book_list
  Bash(jq:*) Bash(test:*)
  Read
metadata:
  vendor: bronlabs
  version: "0.2.0"
  bron-cli-min: "0.3.7"
---

# Bron transactions: read

Read-only. No state changes; safe without confirmation.

This skill drives `mcp__bron__bron_tx_list` and `mcp__bron__bron_tx_events`, and adds two opinionated patterns on top: the canonical priced-inbound-transfers query (for "who paid me / show my income" questions) and asset-resolution against the runtime registry.

## Preferences

Some operations use user-configurable values from `~/.bron/preferences.json`:

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

## The mental model that matters: saga vs events

A `Transaction` is a **saga** — the request the user submitted plus the state-machine that walks it to a terminal status. `params`, `transactionType`, `status`, `extra` describe *intent* and *lifecycle*.

Real money movement lives in **events** attached to the saga. Each event = one concrete blockchain transfer (or accounting entry) that actually settled. One saga → 1, 2, or N events:

| Type | Typical events | What's in them |
|---|---|---|
| `deposit` | 1 × `in` | Inbound transfer credited. `params.amount` matches the event (deposits are passive). |
| `withdrawal` | 1 × `out` + 1 × `fee` | What left + the gas fee (often a different `assetId`). |
| `swap` | 1 × `out` (source) + 1 × `in` (destination) + 1 × `fee` | Both legs settle independently. |
| `internal transfer` | 1 × `out` + 1 × `in` (both internal accounts) | Self-transfer; exclude from income/spend analysis. |

For accurate volume/income/spend numbers, **always sum events, not params**. For deposits these match the event; for withdrawals/swaps/bridges they're the *quote*, not the *fill*.

Report `params` when explaining *what was asked for*, events when explaining *what happened*.

## Default flow

```text
mcp__bron__bron_tx_list { embed: "events", limit: 50 }
```

`embed: "events"` is the magic argument — without it you only see the saga, no real-money detail. For lists of dozens of transactions, leave the limit modest. For drill-into-one, use `mcp__bron__bron_tx_get { transactionId: "<id>" }` or `mcp__bron__bron_tx_events { transactionId: "<id>" }`.

For the full filter set and response shape, the MCP tool descriptor is self-describing.

## The canonical inbound-priced pattern (income / "who paid me")

Use it for any "who paid me / show my income / stablecoin inflows / deposits in March" question.

The pattern:
1. Fetch deposits, completed, with events embedded, in the date range.
2. Look up name records for external counterparties via the address book.
3. Exclude self-deposits (addresses that have also received deposits to your accounts — they're yours).
4. Apply dust filter (USD value ≥ `$DUST`).
5. Group by counterparty if the user asks "who paid me".

Calls:

```text
mcp__bron__bron_tx_list {
  transactionTypes: "deposit",
  transactionStatuses: "completed",
  createdAtFrom: "<FROM_ISO>",
  createdAtTo:   "<TO_ISO>",
  embed: "events",
  limit: 500
}

mcp__bron__bron_address_book_list { limit: 500 }
```

The MCP server coerces ISO 8601 dates into the inclusive-upper-bound the API expects — no shell-side date arithmetic needed.

Process the responses:

1. From the tx response, iterate `transactions[]._embedded.events[]` where `eventType == "in"`. Skip events with `extra.in[0].fromAccountId` set (internal transfer's other leg).
2. Build an address-book lookup `address (lowercased) → name` from the address-book response.
3. For each remaining `in` event, surface a row: `{date: createdAt[0:10], asset: symbol, network: networkId, amount, usd: usdAmount, from: extra.in[0].address, name: lookup(from), txId: blockchainTxId, transactionId}`.
4. Drop rows where `usd < $DUST`.
5. Drop rows whose `from` matches any internal `extra.toAddress` (self-deposit exclusion — current behaviour).

For "who paid me the most" — group by `name`, sum `usd`, sort descending.
For an asset filter — add `assetIds: "<comma-list>"` to the `bron_tx_list` call.

## Asset resolution by symbol

Same pattern as `bron-balances-read`. The user names an asset by symbol ("USDT", "USDC"), resolve via the runtime registry, filter on `verified: true`:

```text
mcp__bron__bron_assets_list { limit: 500 }
```

From the response, filter `assets[]` where `symbol == "<requested>"` and `verified == true`. Collect the matching `assetId`s and pass as a comma-list to `assetIds`.

## Naming things in summaries

Label destinations by human-friendly names. The address-book lookup handles external addresses. For internal accounts:

```text
mcp__bron__bron_accounts_list { limit: 200 }
```

Build a lookup `accountId → accountName`. `→ Mainnet 001 (0x7981…1c08)` reads better than `→ 0x7981FE…1c08`. Mask middle of external addresses unless the user wants the full hex.

## Common questions and how to answer them

| User asks | Approach |
|---|---|
| "Who paid me last month?" | Inbound priced pattern + group by name |
| "Show my income last quarter" | Inbound priced pattern + date range + dust filter |
| "Find payments around $150" | Inbound pattern + USD band filter |
| "Did Alice send me anything?" | Inbound pattern + filter on `name == "Alice"` |
| "What did I spend last week?" | `transactionTypes: "withdrawal"`, completed, sum `out` events |
| "Show me last 20 transactions" | Default flow, no filters |
| "What did this swap trade?" | `mcp__bron__bron_tx_events { transactionId: "<id>" }` |
| "Show my activity on Ethereum" | Add `networkIds: "ETH"` to the default flow |

## What this skill does NOT do

- No transaction creation / approval / decline / cancel → `bron-tx-send`
- No live streaming → `bron-tx-subscribe`
- No balance reads → `bron-balances-read`
- No address-book CRUD → `bron-address-book`
- No FIFO cost basis or profit ranking → `bron-cost-basis`

## Related skills

- **`bron-onboarding`** — runs the conversational setup that writes `~/.bron/preferences.json` (dust threshold, currency)
- **`bron-balances-read`** — for "what do I hold right now" follow-ups
- **`bron-address-book`** — to add a counterparty by name after seeing them in inflows
