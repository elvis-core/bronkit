---
name: bron-tx-subscribe
description: |
  Stream live transaction updates from the Bron treasury platform in real time
  via the bron CLI's WebSocket transport. Use when the user wants to "watch"
  many transactions in parallel, react to status changes across the workspace,
  build a live dashboard, or run an operator-style session over several
  minutes. For single-tx wait-for-completion, prefer the
  `bron_tx_wait_for_state` MCP tool from `bron-tx-send` — it's universal across
  MCP clients and doesn't need a bash background process. Same filters as
  `bron tx list`. Read-only, transparent auto-reconnect, no state changes.
  Pair with the `Monitor` tool so each pushed frame wakes the agent immediately
  — no polling, no manual `tail`.
license: MIT
allowed-tools: Bash(bron tx subscribe:*) Bash(bron tx:*) Bash(bron --schema:*) Read Monitor
metadata:
  vendor: bronlabs
  version: "0.3.0"
  bron-cli-min: "0.3.7"
---

# Bron live transaction stream

`bron tx subscribe` opens a long-lived WebSocket and prints transaction updates as JSONL on stdout — same filters as `bron tx list`, one frame per state transition. Read-only. Auto-reconnect on idle/network drops is transparent.

## When to use this skill (vs `bron_tx_wait_for_state`)

- **Single-tx, await terminal** → `bron_tx_wait_for_state` (MCP, see `bron-tx-send`). Universal, no bash process, returns instantly on match.
- **Multi-tx batch / workspace-wide / "watch the next 10 minutes"** → this skill. One subscription, `Monitor` wakes the agent on every frame across all matching tx.

This skill requires `bron-cli` in PATH. MCP-only environments use parallel `bron_tx_wait_for_state` calls — there's no workspace-wide stream primitive on MCP today. (The MCP spec defines server-initiated notifications, but no major client surfaces them to the LLM session yet — that's why the workspace-wide lane lives in bash.)

## The pattern: subscribe-first, send-second

```
1. Bash run_in_background: bron tx subscribe > /tmp/bron-tx-stream.log 2>&1
2. Capture bash_id.
3. Monitor { bash_id: <id> } — each new stdout line wakes the agent.
4. THEN start submitting / approving / acting on transactions.
5. As Monitor wakes you, surface progress to the user, take next actions, etc.
```

**Why subscribe first:** the stream is live-only by default — if you submit a tx and *then* subscribe, you may miss the `signing-required` frame. Subscribing first guarantees every frame.

`Monitor` doesn't block other tools — while it's active you can still call `bron_tx_*`, read files, etc. Each new line is a notification, not a wait.

If the host doesn't expose `Monitor`, fall back to a `ScheduleWakeup` cycle that re-reads the log file. Don't `tail -f` and freeze — that wastes the entire turn.

## Mental model: GET extended

A subscription is "GET extended": same query as `bron tx list`, server keeps the connection open, pushes JSONL on each state transition. **No snapshot replay on connect** — that's the right default for agent flows. Pass `--with-history` if you genuinely need the snapshot too (rare in agents — just do a separate `bron tx list` for context first).

```bash
# Workspace-wide (recommended for proactive sessions — usually 0–10 frames/min).
bron tx subscribe
# Follow one tx through the rest of its lifecycle (Mode C single-tx wait).
bron tx subscribe --transactionId <id>
# Narrow to specific statuses or types.
bron tx subscribe --transactionStatuses signing-required,waiting-approval
bron tx subscribe --transactionTypes withdrawal,bridge --accountId <id>
# Time-window or account-batch filters.
bron tx subscribe --createdAtFrom 2026-04-01 --transactionStatusNotIn canceled,expired,error
bron tx subscribe --accountIds a,b,c
```

Filters mirror `bron tx list` 1:1: `--accountId`, `--accountIds`, `--transactionId`, `--transactionIds`, `--transactionTypes`, `--transactionStatuses`, `--transactionStatusNotIn`, `--createdAtFrom`, `--createdAtTo`. Read `bron tx subscribe --help` for the full set.

## Auto-reconnect

Transparent. The CLI's WebSocket transport re-dials on idle timeout (~60s) and abnormal closure with linear backoff (1s → 10s, cap; resets after a stable ≥30s connection). You don't see the reconnects — frames keep flowing on stdout. With `--with-history`, the server replays the snapshot on each reconnect — dedupe by `transactionId` if it matters; the default empty snapshot avoids that entirely.

For verbose transport tracing, run `bron --debug tx subscribe …` — pings, dials, frame byte counts go to stderr; auth tokens never appear.

## Common bad pattern, don't do it

```
1. Approve N pending tx in a loop with bron_tx_approve.
2. After each, poll bron_tx_get to confirm.
3. Burn tokens; lose intermediate states.
```

The right shape: subscribe first, approve in a loop, let Monitor wake you with each transition.

## Auto-rule examples — only after explicit user opt-in

If the user wants the agent to react to live frames (e.g. auto-approve withdrawals matching a rule), get explicit confirmation of the rule first, then on each Monitor frame: parse the JSON, check the rule, surface the proposed action to the user, wait for OK, then call the matching `bron_tx_*` tool. Never wire a no-confirm auto-action loop without an explicit user authorisation.

## Discovery

```bash
bron tx subscribe --help     # filters (mirror of `bron tx list`) and flags
bron tx subscribe --schema   # falls back to tx list schema with streaming: websocket
```

## What this skill does NOT do

- No state changes. To approve / decline / cancel from a stream frame, hand off to `bron-tx-send` (and confirm with the user first).
- No balance stream. Balances move as a side-effect of transactions — subscribe to tx and recompute.
- No long-term storage. For past tx, use `bron tx list` / `bron-tx-read`.
