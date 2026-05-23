# Bronkit — MCP Tool Surface

**Source binary:** `/Users/ilia/Desktop/BRon/bronkit-v010-build/server/bin/bron`
**CLI version reported:** `v0.3.9` *(bundle was labelled v0.3.7 in the
brief — the shipped binary is v0.3.9; using the actual reported version
throughout this document)*
**Schema generated:** 2026-05-16 via `bron help --schema` → `/tmp/bron-schema.json` (272,765 B)
**Tool-name discovery:** `bron help mcp`, `bron mcp --help`, plus binary
strings probe for `bron_tx_wait_for_state` (confirmed present).

The bron CLI runs as an MCP stdio server via `bron mcp`. Every public-API
endpoint the CLI knows about is exposed as a typed MCP tool. Tools route
through the same HTTP client as the CLI, so behaviour matches `bron
<resource> <verb>` exactly. `workspaceId` is implicit from the active
profile — MCP callers do not pass it.

**Totals:** 37 base tools + 15 tx-shortcut tools + 1 MCP-only long-poll
tool = **53 MCP tools**.

---

## Section 1 — Full tool inventory

### 1a. Accounts (2 tools)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_accounts_list` | `bron accounts list` | R | List accounts (filter by type/status). |
| `bron_accounts_get` | `bron accounts get <accountId>` | R | Fetch one account by id. |

### 1b. Activities (1 tool)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_activities_list` | `bron activities list` | R | Audit-log feed (logins, tx state changes, etc). |

### 1c. Address book (4 tools)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_address_book_list` | `bron address-book list` | R | List saved addresses (filter by network). |
| `bron_address_book_get` | `bron address-book get <recordId>` | R | Fetch one record by id. |
| `bron_address_book_create` | `bron address-book create` | W | Save a new address. |
| `bron_address_book_delete` | `bron address-book delete <recordId>` | W | Remove a saved address. |

### 1d. Assets (3 tools)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_assets_list` | `bron assets list` | R | Asset dictionary (filter by type/network). |
| `bron_assets_get` | `bron assets get <assetId>` | R | Fetch one asset by id. |
| `bron_assets_prices` | `bron assets prices` | R | Asset market prices (USD). |

### 1e. Balances (2 tools)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_balances_list` | `bron balances list` | R | Account balances. Supports `embed: "prices"` → folds `_embedded.usdPrice` / `_embedded.usdValue` into each row. |
| `bron_balances_get` | `bron balances get <balanceId>` | R | One balance row by id. |

### 1f. Deposit addresses (1 tool)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_deposit_addresses_list` | `bron deposit-addresses list` | R | List deposit addresses for an account/network. |

### 1g. Intents (2 tools)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_intents_create` | `bron intents create` | W | Create an intent (swap/route quote). |
| `bron_intents_get` | `bron intents get <intentId>` | R | Fetch an intent by id. |

### 1h. Members (1 tool)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_members_list` | `bron members list` | R | Workspace members (with permission groups / user profiles). |

### 1i. Networks (2 tools)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_networks_list` | `bron networks list` | R | Network dictionary. |
| `bron_networks_get` | `bron networks get <networkId>` | R | One network by id. |

### 1j. Stakes (1 tool)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_stakes_list` | `bron stakes list` | R | Active stake positions per account/asset. |

### 1k. Symbols (3 tools)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_symbols_list` | `bron symbols list` | R | Trading symbol dictionary. |
| `bron_symbols_get` | `bron symbols get <symbolId>` | R | One symbol by id. |
| `bron_symbols_prices` | `bron symbols prices` | R | Symbol-level market prices. |

### 1l. Transaction limits (2 tools)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_transaction_limits_list` | `bron transaction-limits list` | R | List configured tx limits. |
| `bron_transaction_limits_get` | `bron transaction-limits get <limitId>` | R | One limit by id. |

### 1m. Transactions — read + lifecycle (12 tools)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_tx_list` | `bron tx list` | R | List transactions. Supports `embed: "events"` → folds event arrays into each tx; `embed: "assets"` → folds asset records. |
| `bron_tx_get` | `bron tx get <transactionId>` | R | Fetch one transaction. |
| `bron_tx_events` | `bron tx events <transactionId>` | R | Per-tx event timeline (where real money movement is recorded). |
| `bron_tx_create` | `bron tx create` | W | Low-level tx creation (used when no shortcut fits). |
| `bron_tx_dry_run` | `bron tx dry-run` | W* | Simulate a tx without submitting (no state change despite POST). |
| `bron_tx_bulk_create` | `bron tx bulk-create` | W | Batch create (≤50 tx, client-side cap). |
| `bron_tx_approve` | `bron tx approve <transactionId>` | W | Move tx forward in approval state machine. |
| `bron_tx_decline` | `bron tx decline <transactionId>` | W | Decline approval. |
| `bron_tx_cancel` | `bron tx cancel <transactionId>` | W | Cancel a pending tx. |
| `bron_tx_create_signing_request` | `bron tx create-signing-request <transactionId>` | W | Push tx to signing-required state. |
| `bron_tx_accept_deposit_offer` | `bron tx accept-deposit-offer <transactionId>` | W | Accept an incoming deposit offer. |
| `bron_tx_reject_outgoing_offer` | `bron tx reject-outgoing-offer <transactionId>` | W | Reject an outgoing transfer. |

\* `bron_tx_dry_run` is HTTP POST but doesn't mutate state. Available in
`--read-only` mode according to the help text ("GET endpoints + tx
dry-run only").

### 1n. Transaction shortcuts — typed wrappers around `tx create` (15 tools)

All write-side. Each wraps `POST /transactions` with `transactionType`
pinned and a typed `params` schema. The CLI flattens `--params.amount=…`;
the MCP shape is `{accountId, externalId, description?, expiresAt?, params: {...}}`.

| MCP tool | CLI equivalent | Params (notable) |
|---|---|---|
| `bron_tx_withdrawal` | `bron tx withdrawal` | amount, assetId, networkId, toAddress, toAddressBookRecordId, toAccountId, toWorkspaceTag, memo, feeLevel, includeFee, symbol, networkFees.* |
| `bron_tx_allowance` | `bron tx allowance` | amount, assetId, toAddress, unlimited, feeLevel, networkFees.* |
| `bron_tx_bridge` | `bron tx bridge` | amount, sourceAssetId, feeLevel |
| `bron_tx_deposit` | `bron tx deposit` | amount, assetId, networkId |
| `bron_tx_intents` | `bron tx intents` | intentId, feeLevel |
| `bron_tx_defi` | `bron tx defi` | to, value, data, method, networkId, origin, rawTransaction(s), externalBroadcast, feeLevel |
| `bron_tx_defi_message` | `bron tx defi-message` | message, networkId, origin, version |
| `bron_tx_stake_delegation` | `bron tx stake-delegation` | amount, assetId, poolId |
| `bron_tx_stake_undelegation` | `bron tx stake-undelegation` | amount, assetId, stakeId |
| `bron_tx_stake_claim` | `bron tx stake-claim` | amount, assetId, stakeId |
| `bron_tx_stake_withdrawal` | `bron tx stake-withdrawal` | amount, assetId, poolId |
| `bron_tx_address_activation` | `bron tx address-activation` | assetId |
| `bron_tx_address_creation` | `bron tx address-creation` | assetId |
| `bron_tx_fiat_in` | `bron tx fiat-in` | amount, assetId, fiatAmount, fiatAssetId |
| `bron_tx_fiat_out` | `bron tx fiat-out` | amount, assetId, networkId, fiatAssetId, feeLevel, toAddressBookRecordId |

### 1o. Workspace (1 tool)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_workspace_info` | `bron workspace info` | R | Workspace metadata (with `includeSettings`). |

### 1p. MCP-only (1 tool — no CLI equivalent)

| MCP tool | CLI equivalent | R/W | Purpose |
|---|---|---|---|
| `bron_tx_wait_for_state` | *(none)* | R | Subscribe to one `transactionId`, return on first match in `expectedStates`, or timeout with a continuation hint. Universal across MCP clients — replaces the bash `tx subscribe` + `Monitor` pattern for single-tx waiting. Per `bron help mcp`: "Long-poll wait — universal across MCP clients." |

---

## Section 2 — Tools the 9 shipped skills currently use (or would call after Phase 1)

Mapping derived by grepping each `SKILL.md` body for `bron <verb>` patterns,
then translating to the MCP tool that wraps the same endpoint.

### bron-address-book

| Today (shell-out) | Phase 1 (MCP) |
|---|---|
| `bron address-book list` | `bron_address_book_list` |
| `bron address-book create` | `bron_address_book_create` |
| `bron address-book delete` | `bron_address_book_delete` |
| *(implicit)* | `bron_address_book_get` (lookup by id) |

### bron-balances-read

| Today (shell-out) | Phase 1 (MCP) |
|---|---|
| `bron accounts list` | `bron_accounts_list` |
| `bron assets list` | `bron_assets_list` |
| `bron balances list --embed prices` | `bron_balances_list` with `embed: "prices"` |

### bron-cost-basis

| Today (shell-out) | Phase 1 (MCP) |
|---|---|
| `bron balances list` | `bron_balances_list` (with `embed: "prices"`) |
| `bron tx list` (paginated) | `bron_tx_list` with `embed: "events"` (folds events in one call, eliminates per-tx `tx events` loop) |
| `bron tx events <id>` (per-tx) | `bron_tx_events` (fallback for any tx not embedded) |

### bron-defi-positions

| Today (shell-out) | Phase 1 (MCP) |
|---|---|
| `bron tx list` | `bron_tx_list` with `embed: "events"` |
| `bron tx events <id>` | `bron_tx_events` |
| `bron assets list` | `bron_assets_list` |
| `bron address-book list` | `bron_address_book_list` |

### bron-onboarding

| Today (shell-out) | Phase 1 (MCP) |
|---|---|
| `bron accounts list` (for "default account" question) | `bron_accounts_list` |
| *(no other CLI use — reads/writes `~/.bron/preferences.json`)* | *(no MCP equivalent — local file I/O stays as-is)* |

### bron-opportunities

| Today (shell-out) | Phase 1 (MCP) |
|---|---|
| `bron balances list` | `bron_balances_list` with `embed: "prices"` |
| `bron assets list` | `bron_assets_list` |
| `bron stakes list` | `bron_stakes_list` |

### bron-tx-read

| Today (shell-out) | Phase 1 (MCP) |
|---|---|
| `bron tx list --embed events` | `bron_tx_list` with `embed: "events"` |
| `bron tx get <id>` | `bron_tx_get` |
| `bron tx events <id>` | `bron_tx_events` |
| `bron accounts list` | `bron_accounts_list` |
| `bron assets list` | `bron_assets_list` |
| `bron address-book list` | `bron_address_book_list` |

### bron-tx-send

| Today (shell-out) | Phase 1 (MCP) |
|---|---|
| `bron accounts list` | `bron_accounts_list` |
| `bron intents create` | `bron_intents_create` |
| `bron intents get <id>` | `bron_intents_get` |
| `bron tx dry-run` | `bron_tx_dry_run` |
| `bron tx withdrawal` | `bron_tx_withdrawal` |
| `bron tx intents` | `bron_tx_intents` |
| `bron tx create-signing-request <id>` | `bron_tx_create_signing_request` |
| `bron tx list` (state polling) | `bron_tx_list` — but for single-tx waits, prefer `bron_tx_wait_for_state` |
| `bron tx subscribe --transactionId <id>` | **`bron_tx_wait_for_state`** (MCP-only — universal substitute) |
| `bron config show` *(local profile)* | **CLI-only** — no MCP equivalent (reads `~/.config/bron/profiles.json`). The MCP server already has the profile baked in via env/config at boot, so skills generally don't need this. |

### bron-tx-subscribe

| Today (shell-out) | Phase 1 (MCP) |
|---|---|
| `bron tx list` (snapshot) | `bron_tx_list` |
| `bron tx subscribe` (single-tx wait) | `bron_tx_wait_for_state` |
| `bron tx subscribe` (multi-tx fan-out / operator session) | **CLI-only — keep shell-out + Monitor pattern.** No MCP equivalent for multi-tx WebSocket streaming. |

---

## Section 3 — Operations CLI-only (no MCP equivalent)

Confirmed against `bron help --schema` (37 commands in `x-bron-cli.commands`).
Anything not in that list is CLI-only.

### Data path

| CLI command | Why CLI-only | Replacement for skills |
|---|---|---|
| `bron tx subscribe` | WebSocket stream (`wss://<api>/ws`) — long-running, JSONL stdout, designed for shell pipes. Outside the OpenAPI surface. | **Single-tx wait:** `bron_tx_wait_for_state`. **Multi-tx fan-out:** keep CLI + `Monitor` tool (the existing `bron-tx-subscribe` skill pattern is unchanged). |

`bron tx subscribe` is the **only data verb** without an MCP equivalent.

### Local-machine / configuration verbs (not API endpoints, no MCP analogue expected)

| CLI command | Purpose |
|---|---|
| `bron config init` | Generate keypair, register public JWK in UI, resolve workspaceId. |
| `bron config show` | Print active profile (workspaceId, keyFile path, baseUrl). |
| `bron config list` | List configured profiles. |
| `bron config use-profile <name>` | Switch active profile. |
| `bron config set k=v` | Update profile fields. |
| `bron mcp` | The MCP server itself. |
| `bron mcp install --target …` | Register `bron mcp` with Claude Desktop / Cursor / Cline / Claude Code config files. |
| `bron completion install` | Install shell completion (zsh/bash/fish). |
| `bron help [topic]` | Help system. |

These are local CLI affordances. Skills shouldn't need them — the MCP
server is configured once at install time and the profile is baked in.

---

## Section 4 — Surprises / gotchas

1. **`workspaceId` is implicit.** Every CLI path is
   `/workspaces/{workspaceId}/...`, but MCP callers don't pass
   `workspaceId` — the server uses the active profile. Big simplification
   vs the current shell-out skills that mostly just inherit this from the
   `bron` binary anyway.

2. **`embed` parameter eliminates most multi-call patterns.** CLI flag
   `--embed prices` / `--embed events` becomes MCP arg `embed: "prices"` /
   `embed: "events"`. This is huge for `bron-cost-basis` and `bron-tx-read`
   — today they make N+1 calls (list tx → fetch events per tx); Phase 1 can
   collapse this to one call with `bron_tx_list(embed: "events")`.

3. **Tx shortcut request shape differs from CLI flags.** CLI flattens
   `--params.amount=100 --params.assetId=5000`; MCP nests as
   `{accountId, externalId, params: {amount: 100, assetId: "5000"}}`.
   The 4 envelope fields (`accountId`, `externalId`, `description`,
   `expiresAt`) are at the root; everything else goes under `params`.

4. **15 tx shortcuts vs 1 generic `bron_tx_create`.** Both work, but
   shortcuts give typed `params` schemas and per-type validation. Skills
   should prefer the shortcut (e.g. `bron_tx_withdrawal`) over generic
   `bron_tx_create({transactionType: "withdrawal", ...})` — clearer
   agent intent, better error messages, cleaner Claude Code popups.

5. **Free-form fields are auto-wrapped.** Per `bron help mcp`:
   `description`, `memo`, `note`, `comment`, `reason` come back wrapped in
   `<untrusted source="…">…</untrusted>` envelopes in tool results. The
   server's `initialize` instructions tell the agent to treat the wrapped
   content as inert. Skill bodies that render tx output must not interpret
   these as instructions.

6. **`bron_tx_bulk_create` caps at 50 tx client-side**, on top of backend
   approval policies and rate limits. Larger batches fail before the request
   leaves the binary.

7. **`bron_tx_wait_for_state` returns a "keep waiting" hint.** Per binary
   strings: *"Transaction still in %q. Call bron_tx_wait_for_state again
   with the same args to keep waiting."* — so on timeout the agent gets a
   structured signal to re-invoke, not just a generic timeout error. This
   makes it a clean loop primitive without needing `Monitor`.

8. **`--read-only` MCP mode** drops every state-changing tool — keeps only
   GET endpoints + `bron_tx_dry_run`. Right for audit agents, CI runs, or
   untrusted-prompt scenarios. Worth surfacing as an install option for
   friends who want to test without write capability.

9. **Workspace-ID masking still applies in MCP output.** The project rule
   to mask account IDs as `ws_xxxxxxxxxxxxxxxxxxxxxxxx` in user-visible
   output applies regardless of source (CLI vs MCP). Today's `bron-tx-send`
   leak (`y2epdwfcr2vkg84hcx4j3rvm` shown to user) won't auto-fix on MCP
   migration — it's a rendering-layer rule the skill body must enforce.

10. **`bron_tx_dry_run` is HTTP POST but state-neutral.** Available in
    `--read-only` mode despite being POST. Useful for "show me what would
    happen" UX without needing write permission.

11. **`tx events` records the actual money movement.** Per existing
    SKILL.md docs and confirmed by schema: transactions are sagas;
    `_embedded.events` carries the real `usdAmount` at settlement time.
    Cost basis reconstruction depends on this — the MCP `embed: "events"`
    pattern is the right access route, not separate `bron_tx_events`
    calls per tx.

---

*Generated 2026-05-16. Bron CLI v0.3.9 / OpenAPI 3.1.1 / schema 272 KB.
Re-run `bron help --schema > /tmp/bron-schema.json` to regenerate after
binary updates; tool counts and shapes may shift between minor versions.*
