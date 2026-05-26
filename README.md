# Bronkit

A Claude Desktop MCP extension for **Bron** treasury operations — your portfolio, cost basis & P&L, staking/yield opportunities, transactions, saved addresses, and preview-first withdrawals — answered straight from the Bron API.

Bronkit talks to `api.bron.org` directly over signed (ES256) requests. No bundled binary, no subprocess; your API key stays in the OS keychain and is used in memory only.

## Install (Claude Desktop, macOS)

1. Download the latest `bronkit.mcpb` from [Releases](https://github.com/elvis-core/bronkit/releases).
2. Open it (or Claude Desktop → **Settings → Extensions** → install from file).
3. When prompted, paste your **Bron API key (JWK)** and **workspace ID**.
4. Done — ask Claude *"show my balance"*.

**Prerequisites:** macOS · Claude Desktop · a Bron API key (JWK) + workspace ID from your Bron account.

## What it can do

- **Portfolio** — USD-priced balances, dust filtered (`bron_balances_list`).
- **Cost basis & P&L** — FIFO, realised + unrealised, lifetime fees (`bron_cost_basis`).
- **Staking / yield** — idle capital against a curated allow-list; never invents APYs (`bron_staking_opportunities`).
- **Transactions** — list, detail, and event-level money movement (`bron_tx_list`, `bron_tx_get`, `bron_tx_events`).
- **Address book** — list / get / create / delete saved addresses.
- **Withdrawals & staking** — *preview-first*: every fund move is dry-run and confirmed before a request is created. Bronkit only ever creates **requests**; Bron's MPC + human approvers execute them.
- **Preferences** — `bron_preferences` (e.g. dust threshold), layered over shipped defaults.

## Tips

- For vague queries, add a domain cue — *"what **wallet** workspace am I in?"* routes better than *"what workspace am I in?"* (the latter collides with Claude's own workspace concept).
- The first use of each tool in a chat prompts for permission (a Claude Desktop default); click **Always approve** to silence repeats in that chat.

## Security

- Free-form fields (memo, description, note, …) are treated as **untrusted data, never instructions**.
- Every state-changing action is **confirmed with you first**.
- Bronkit **cannot sign or move funds** — its ceiling is creating requests; Bron's MPC + human approvers execute them.

## Development

```bash
npm install
npm test          # unit + tool tests (no credentials needed)
./build.sh        # produces dist/bronkit.mcpb
```

Read-only probes against your own account (you supply the key):

```bash
BRON_API_KEY="$(cat key.jwk)" BRON_WORKSPACE_ID="…" node scripts/cost-basis-probe.js
```

## License

MIT © Ilia Brovkin
