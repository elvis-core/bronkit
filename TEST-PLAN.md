# Bronkit — manual UI test plan

Run each test from the Claude Desktop chat after reinstalling the extension. Fill in **Time** and **✅/❌** as you go. `<…>` = data you supply (most are captured from an earlier read test — see Step 0).

**20 tools total**: 9 reads · 2 composites · 1 config · 8 writes.

---

## How to use this doc

- **Cold vs warm timing.** The *first* bron call after a fresh launch pays the tool-schema load (cold). Repeats are warm. Note both where it matters.
- **One prompt per row.** Type it as written (tweak the `<…>` blanks). Time from pressing enter to the answer being fully rendered.
- **Confirmations / permission prompts.** Claude Desktop prompts on the *first* use of each tool **per chat — including read-only ones** (a Desktop default, not a bronkit bug). Click **"Always approve"** once per tool to silence repeats within that chat; a new chat resets it. Write tools additionally surface our own confirmation by design. So when a read "pops," that's expected — note it but don't count it as a failure.
- **Baselines to compare against** (earlier Desktop runs): greeting ~11 s · portfolio ~16 s · cost_basis ~23–25 s · old 53-tool cold ~38 s.

---

## Step 0 — setup & data to capture

| ✔ | Setup |
|---|---|
| ☐ | Reinstall `dist/bronkit.mcpb`; confirm the extension shows **connected**. |
| ☐ | Confirm `BRON_API_KEY` (JWK) + `BRON_WORKSPACE_ID` are set in the extension config. |
| ☐ | Ask: *"What bron tools do you have?"* → expect **20** tools listed. (Also a cold-start timing point.) |

As you run Section A, jot these down — later tests reuse them:

| Token | Where it comes from | Value |
|---|---|---|
| `<accountId>` | accounts_list (A2) | |
| `<assetSymbol>` you hold (e.g. ETH) | balances (A4) | |
| `<transactionId>` | tx_list (A5) | |
| `<recordId>` (if any saved) | address_book_list (A8) | |

---

## A. Read tools (9) — all safe, none should prompt

| # | Prompt | Data | Expect | Time | ✅/❌ |
|---|---|---|---|---|---|
| A1 | "What workspace am I in?" | — | Workspace name/metadata | | |
| A2 | "List my accounts" | — | Accounts w/ ids+types → **capture `<accountId>`** | | |
| A3 | "Show me account `<accountId>`" | accountId | That account's details | | |
| A4 | "Show my balance" | — | USD-priced portfolio, dust hidden; total looks right → **capture `<assetSymbol>`** | | |
| A5 | "Show everything including dust" | — | More rows than A4 (unpriced/sub-$1 included) | | |
| A6 | "Show my recent transactions" | — | Tx metadata list → **capture `<transactionId>`** | | |
| A7 | "Show transaction `<transactionId>`" | txId | That transaction's detail | | |
| A8 | "What moved in transaction `<transactionId>`?" | txId | Event-level money movement | | |
| A9 | "List my saved addresses" | — | Address-book records → **capture `<recordId>`** (may be empty) | | |

---

## B. Composite tools (2) — safe

| # | Prompt | Data | Expect | Time | ✅/❌ |
|---|---|---|---|---|---|
| B1 | "What did I pay for my holdings — show cost basis and P&L" | — | FIFO table: held, avg basis, current, unrealised/realised, totals | | |
| B2 | "What did I pay for `<assetSymbol>`?" | symbol | Same, filtered to one asset | | |
| B3 | "What could I be staking / where's my idle capital?" | — | Idle-capital table; on-list vs off-list; "deployable" total; no APY quoted | | |
| B4 | "How much of my `<assetSymbol>` is idle?" | symbol | Single row: total / idle / locked | | |

---

## C. Config (1) — safe & reversible

| # | Prompt | Data | Expect | Time | ✅/❌ |
|---|---|---|---|---|---|
| C1 | "Show my bronkit preferences" | — | Effective config (dustThreshold), the shipped default, file path | | |
| C2 | "Set my dust threshold to 5" | — | Confirms, writes file, dustThreshold=5 | | |
| C3 | "Show my balance" | — | Fewer rows than A4 (now hides <$5) — proves the setting took effect | | |
| C4 | "Set my dust threshold back to 1" | — | Reverts to 1 | | |

---

## D. Safe writes — address book round-trip (no money)

| # | Prompt | Data | Expect | Time | ✅/❌ |
|---|---|---|---|---|---|
| D1 | "Save this address as 'Bronkit Test': `<address>` on `<network>`" | a throwaway/known address + network (e.g. ETH) | Confirmation prompt → record created | | |
| D2 | "List my saved addresses" | — | The 'Bronkit Test' record appears → capture its `<newRecordId>` | | |
| D3 | "Delete the 'Bronkit Test' saved address" | newRecordId | Confirmation prompt → deleted | | |
| D4 | "List my saved addresses" | — | 'Bronkit Test' is gone | | |

---

## E. Money previews — SAFE (dry-run only, nothing is created, no funds move)

> Note: because these tools *can* move money, Desktop may ask you to confirm even the preview. Allowing it is safe — the preview calls the dry-run endpoint and **creates no request**. Stop after the preview; do **not** approve a follow-up "create" unless you intend Section F.

| # | Prompt | Data | Expect | Time | ✅/❌ |
|---|---|---|---|---|---|
| E1 | "Preview withdrawing `<tinyAmount>` `<assetSymbol>` from `<accountId>` to `<address>` — just show me the fees, don't send it" | tiny amount, asset, account, a destination address | Fee + balance-impact preview; **no request created** | | |
| E2 | "Preview staking `<tinyAmount>` `<stakeableSymbol>` from `<accountId>`" | small amount, a stakeable asset you hold (e.g. SOL) | Staking preview; no request created | | |

---

## F. OPTIONAL — real request lifecycle (your discretion; involves a real pending request)

> **Read before running.** This creates a *real* withdrawal **request** (it does **not** execute — Bron's MPC + approvers do that), then cancels it. Only you initiate it, you confirm each step, use the **smallest possible amount to an address you control**, and cancel at the end. Skip this section entirely if you'd rather not create a real request. I won't run any of this for you.

| # | Prompt | Data | Expect | Time | ✅/❌ |
|---|---|---|---|---|---|
| F1 | "Withdraw `<tinyAmount>` `<assetSymbol>` from `<accountId>` to `<yourOwnAddress>`" | tiny amount, your own address | Preview → you confirm → request **created** (pending) → capture `<reqId>` | | |
| F2 | "What's pending — show me requests awaiting action" | — | tx_list surfaces the pending `<reqId>` | | |
| F3 | "Cancel request `<reqId>`" | reqId | Confirmation → request cancelled | | |
| F4 *(only if workspace has an approval policy and something is pending approval)* | "Approve request `<reqId>`" / "Decline request `<reqId>`" | reqId | Confirmation → approved/declined | | |
| F5 *(only if a request reached signing-required)* | "Create a signing request for `<reqId>`" | reqId | Confirmation → signing request created | | |

---

## Tally

| Metric | Result |
|---|---|
| Tools listed (expect 20) | |
| Cold start (first prompt after launch) | |
| Cold first bron call | |
| Warm portfolio (A4 repeat) | |
| cost_basis (B1) | |
| Tests passed / total run | |
| Anything that felt slow or wrong | |
