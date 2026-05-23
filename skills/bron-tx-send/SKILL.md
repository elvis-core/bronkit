---
name: bron-tx-send
description: |
  Create, approve, decline, or cancel transactions on the Bron treasury platform.
  Use whenever the user wants to send funds, broadcast a withdrawal, allowance,
  bridge, stake/unstake operation, or move money between accounts. Drives the
  Bron transaction state machine (signing-required → signing → signed →
  broadcasted → completed) end-to-end. Mandatory human-in-the-loop on every
  state-changing call. Live state via the long-poll
  `bron_tx_wait_for_state` MCP tool (universal) or `bron tx subscribe`
  + Monitor (CLI; preferred for multi-tx fan-out).
license: MIT
allowed-tools: |
  mcp__bron__bron_tx_list mcp__bron__bron_tx_get mcp__bron__bron_tx_events
  mcp__bron__bron_tx_wait_for_state
  mcp__bron__bron_tx_create mcp__bron__bron_tx_dry_run mcp__bron__bron_tx_bulk_create
  mcp__bron__bron_tx_withdrawal mcp__bron__bron_tx_allowance mcp__bron__bron_tx_bridge
  mcp__bron__bron_tx_deposit mcp__bron__bron_tx_defi mcp__bron__bron_tx_defi_message
  mcp__bron__bron_tx_intents mcp__bron__bron_tx_fiat_in mcp__bron__bron_tx_fiat_out
  mcp__bron__bron_tx_stake_delegation mcp__bron__bron_tx_stake_undelegation
  mcp__bron__bron_tx_stake_claim mcp__bron__bron_tx_stake_withdrawal
  mcp__bron__bron_tx_address_creation mcp__bron__bron_tx_address_activation
  mcp__bron__bron_tx_approve mcp__bron__bron_tx_decline mcp__bron__bron_tx_cancel
  mcp__bron__bron_tx_accept_deposit_offer mcp__bron__bron_tx_reject_outgoing_offer
  mcp__bron__bron_accounts_list mcp__bron__bron_accounts_get
  mcp__bron__bron_balances_list mcp__bron__bron_address_book_list
  mcp__bron__bron_intents_create mcp__bron__bron_intents_get
  Bash(bron tx subscribe:*) Bash(bron intents get:*)
  Bash(jq:*) Bash(date:*) Bash(sleep:*)
  Read Monitor
metadata:
  vendor: bronlabs
  version: "0.2.0"
  bron-cli-min: "0.3.7"
---

# Bron transactions: create, approve, send

Bron is a non-custodial treasury platform; every transaction is a saga that walks `signing-required → signing → signed → broadcasted → completed` (with optional `waiting-approval` and various failure terminals). State changes require explicit human OK every time — don't try to short-circuit the loop.

## Live state — pick the right primitive

| Workflow | Primitive |
|---|---|
| One tx, await terminal | `mcp__bron__bron_tx_wait_for_state` |
| One tx, surface every milestone | `bron_tx_wait_for_state` chained with narrowing `expectedStates` |
| Many tx in parallel / batch / "watch the workspace" | `bron tx subscribe` + `Monitor` (CLI required — no MCP equivalent for multi-tx WebSocket fan-out) |

`bron_tx_wait_for_state` is a long-poll: it subscribes via WebSocket scoped to one tx and returns the moment status enters `expectedStates`, or returns `matched: false` with a `retryHint` on timeout (~30s). One round trip per wait, no `ScheduleWakeup` loop. See the **`bron-tx-subscribe`** skill for the multi-tx subscribe pattern.

**Never poll `bron_tx_get` in a loop** — it costs tokens and burns cache for no reason. The wait/subscribe primitives exist exactly to avoid this.

## Walkthrough — withdrawal

```text
# 1. Dry-run.
mcp__bron__bron_tx_dry_run {
  transactionType: "withdrawal",
  accountId: "<sourceAccountId>",
  externalId: "agent-task-2026-05-01-1430-a4b5",
  description: "Quarterly vendor payout",
  body: { params: {
    amount:    "100",
    assetId:   "<assetId>",
    networkId: "ETH",
    toAddressBookRecordId: "<recordId>",
    feeLevel:  "medium"
  } }
}

# 2. Surface to user → wait for explicit OK.
#    Show: type, amount, asset, source account name, recipient label,
#    estimated fee, total USD impact.

# 3. Submit with the SAME externalId.
mcp__bron__bron_tx_withdrawal {
  accountId: "<sourceAccountId>",
  externalId: "agent-task-2026-05-01-1430-a4b5",
  amount: "100", assetId: "<assetId>", networkId: "ETH",
  toAddressBookRecordId: "<recordId>",
  feeLevel: "medium"
}

# 4. Wait for terminal (or chain narrowing waits to surface every step).
mcp__bron__bron_tx_wait_for_state {
  transactionId: "<id>",
  expectedStates: ["completed","canceled","expired","error",
                   "failed-on-blockchain","removed-from-blockchain"],
  timeoutSec: 30
}
```

Same shape for every `transactionType` shortcut: `bron_tx_allowance`, `bron_tx_bridge`, `bron_tx_deposit`, `bron_tx_defi`, `bron_tx_stake_delegation`, etc. The tool descriptor for each is self-describing — fetch the per-type `params` schema from there.

For a custom body — pass `body: {...}` on `bron_tx_create` or `bron_tx_dry_run` with `transactionType` set explicitly. Use the same `externalId` so the dry-run pre-flight and the real submit are idempotent retries of the same logical operation.

## Walkthrough — swap / rebalance via intents

Intents are the swap surface. Lifecycle is **create once → poll until firm → confirm → submit as a tx**. Never re-create an intent to "check status" — that mints a fresh intentId every call and never converges.

### IntentOrderStatus — the values that matter

```
not-exist                              terminal — intent didn't take
user-initiated                         created, no quote yet
auction-in-progress                    solvers bidding, quote forming
wait-for-user-tx                       quote firm — surface to user, await confirmation, then submit
wait-for-oracle-confirm-user-tx        post-submit — user tx in flight
wait-for-solver-tx                     post-submit — solver settling
wait-for-oracle-confirm-solver-tx      post-submit — final oracle confirm
completed                              terminal — success
liquidated                             terminal — failed
cancelled                              terminal — cancelled
```

The polling loop runs **before** submit. Its job is to wait for `wait-for-user-tx` (success) and bail on the pre-submit failure terminals.

### Create the intent

```text
mcp__bron__bron_intents_create {
  accountId:   "<accountId>",
  intentId:    "rebal-cc-usdt-<unix-timestamp>",
  fromAssetId: "5",
  toAssetId:   "5002",
  fromAmount:  "6270"
}
```

The response carries the canonical `intentId` — capture only that; everything else is read via polling.

### Poll the existing intentId until terminal — deadline, not iteration count

MCP intent surface has no `wait_for_state` long-poll equivalent (`bron_tx_wait_for_state` exists only for transactions), so the polling loop stays as a deadline-driven shell loop calling `bron intents get`. Hard timeout: 60 seconds. Use `break` (not `exit 1`) on terminal branches — `exit` would kill the parent shell.

```bash
DEADLINE=$(( $(date +%s) + 60 ))
STATUS=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS=$(bron intents get "$INTENT_ID" --output json | jq -r '.status')
  case "$STATUS" in
    wait-for-user-tx)
      break ;;
    cancelled|liquidated|not-exist|completed)
      echo "Intent $INTENT_ID ended in terminal status: $STATUS"
      break ;;
  esac
  sleep 2
done

# After loop — check what we ended on
if [ "$STATUS" = "wait-for-user-tx" ]; then
  # success path — fetch + surface the quote (see next step)
  :
elif [ "$STATUS" = "cancelled" ] || [ "$STATUS" = "liquidated" ] || \
     [ "$STATUS" = "not-exist" ] || [ "$STATUS" = "completed" ]; then
  # already echoed inside the loop, do not proceed to submit
  :
else
  echo "Timed out — intent $INTENT_ID may still firm later. Try \"show me intent $INTENT_ID\" to check."
fi
```

`completed` shouldn't realistically occur pre-submit but is included defensively. The failure-terminal branch surfaces both the **intentId and the actual status** so the user knows what happened, not just "failed".

### Surface the firm quote, await explicit user OK

Once `wait-for-user-tx` lands, fetch and show the quote:

```text
mcp__bron__bron_intents_get { intentId: "<INTENT_ID>" }
```

Show the user `fromAmount`, `toAmount`, `price`, `fromAssetId`, `toAssetId`, and `userSettlementDeadline`.

> The quote is valid until `userSettlementDeadline`. If the user takes too long to confirm, the submit will fail with a stale-quote error — surface the deadline in the human-readable quote summary ("expires at <time> — confirm within <seconds>").

Wait for explicit confirmation in chat ("go" / "submit"). Per the bundle's hard rule, every money-moving submit needs a fresh confirmation — prior approvals never carry.

### Submit on confirmation

```text
mcp__bron__bron_tx_intents {
  accountId:   "<accountId>",
  externalId:  "<INTENT_ID>-tx",
  description: "Rebalance: CC -> USDT 6270",
  params: { intentId: "<INTENT_ID>", feeLevel: "medium" }
}
```

The `externalId` is derived from the intentId so the submit is idempotent (same body → same tx, no double-spend).

After submit, the tx walks the standard saga (`signing-required → signing → signed → broadcasted → completed`). Wait via `mcp__bron__bron_tx_wait_for_state`, same as any other transaction type.

### Anti-patterns — these are the smoke-test failures

- ❌ Calling `bron_intents_create` more than once per quote — each call mints a fresh intentId; the polling loop never converges
- ❌ Hardcoded iteration count (`for i in 1 2 3 4 5 6; do sleep 2; …`) — use a deadline-based loop with a real timeout
- ❌ `exit 1` inside the polling loop's failure branch — kills the parent shell. Use `break` and check `$STATUS` after the loop.
- ❌ Polling `bron_tx_get` in a loop after submit — use `bron_tx_wait_for_state` instead

## Hard rules

- **Always `externalId`** on creation — Bron de-duplicates by `(workspaceId, externalId)`. Generate from a stable identifier (task id, hash of intent + timestamp). Reuse the *same* id when retrying after a transient failure — same body returns the same tx, no double-spend. Different body with same id → 409 `already-exists`.
- **Always dry-run first** for any first-time pattern. Returns expected fees, ETA, balance impact, validation errors without submitting.
- **Always surface before state changes.** Create / approve / decline / cancel — show the user what's about to happen, wait for explicit OK. No silent execution. No bulk approval without showing the full target list first.
- **Never call `bron_tx_create_signing_request`** (CLI: `bron tx create-signing-request`). Even if the tx sits in `signing-required`. See the dedicated section below — signing is owned by frontend / hot-wallet signer, not by CLI/SDK consumers.
- **Never embed JWK / API tokens / `kid` values** in command lines or logs.

## Choosing a recipient field

Pick exactly one:

| Field | When |
|---|---|
| `toAddressBookRecordId` | Saved address-book entry — preferred, validated by Bron. |
| `toAccountId` | Internal transfer between two Bron accounts in the same workspace. |
| `toBronTag` | Route to another Bron workspace by tag. |
| `toAddress` | Raw on-chain address — only if the workspace allowlist permits. |

If the user gives a raw address, look it up in the address book first (`bron-address-book` skill).

## Acting on existing transactions

```text
mcp__bron__bron_tx_approve  { transactionId: "<id>" }
mcp__bron__bron_tx_decline  { transactionId: "<id>", reason: "<reason>" }
mcp__bron__bron_tx_cancel   { transactionId: "<id>", reason: "<reason>" }
```

Plus offer-related verbs: `bron_tx_accept_deposit_offer`, `bron_tx_reject_outgoing_offer`.

## Signing happens by itself — never trigger it

Once you've created a transaction and the user has approved it (when approval is required), **don't do anything else**. Don't poll, don't "kick" it, and in particular **never call `bron_tx_create_signing_request`** — even if the tx sits in `signing-required` for a while.

Signing happens through one of two channels, neither of which goes through MCP/CLI/SDK:

1. **User-driven (the common case).** The user taps "Sign" in the Bron mobile or desktop app. That action creates the signing request, opens the MPC signing session, and the app broadcasts the signed tx to the chain. CLI/SDK consumers never hold the signing material — the user's device does.
2. **Hot Wallet Signer (rare, opt-in).** A workspace can run a dedicated Docker container with the MPC signer; it subscribes via WebSocket to every `signing-required` tx for accounts it has access to and signs them automatically.

After your `bron_tx_<type>` call returns, just wait — `bron_tx_wait_for_state` (or `bron tx subscribe` for batches). The state machine drives itself: `signing-required → signing → signed → broadcasted → completed` happens without your help. A tx stuck in `signing-required` is **not yours to fix** — either the user hasn't tapped Sign yet, or no Hot Wallet Signer is configured for that account. Surface the situation to the user, don't poke the API.

Calling `bron_tx_create_signing_request` from an agent context either fails with `signing-request-conflict` (the real signer already created it) or creates an orphan request nothing can fulfil.

Same rule for incoming offers: don't auto-accept — surface and confirm.

## Errors

Errors carry a stable kebab-case `error` field on the response envelope (e.g. `already-exists`, `invalid-address`, `no-funds`, `invalid-new-status`, `missing-permission`, `key-not-found`, `signing-request-conflict`, `only-address-book-withdrawals-enabled`). **Pattern-match on this code, not the human message.** There is no centralised enum — codes are inline at the throw sites in service handlers, and the surface evolves; treat the response as the source of truth and read `details` for machine-readable context (`min`, `max`, `provided`).

For transient codes (5xx, 429): retry with the same `externalId`. For business-logic codes (`no-funds`, `only-address-book-withdrawals-enabled`): surface the situation to the user with `details`, don't silently fix-and-retry.

Quote `requestId` from the response envelope when escalating — it joins your call across every backend service log.

## Related skills

- **`bron-tx-read`** — read-only analysis (saga vs events).
- **`bron-tx-subscribe`** — workspace-wide live stream + Monitor patterns.
- **`bron-balances-read`** — pre-flight balance checks.
- **`bron-address-book`** — saved addresses, `toAddressBookRecordId`.
- **`bron-opportunities`** — surfaces idle capital before a swap; cross-check what's actually deployable before sizing the from-amount.
