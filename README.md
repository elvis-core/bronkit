<div align="center">
  <img src="icon.png" width="128" alt="Bronkit">

# Bronkit

**Your Bron treasury, in Claude Desktop.**
Portfolio, cost basis, staking opportunities, transactions, saved addresses, and preview-first withdrawals — answered straight from the Bron API.

[![Latest release](https://img.shields.io/github/v/release/elvis-core/bronkit)](https://github.com/elvis-core/bronkit/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

### [⬇ Download the latest `.mcpb`](https://github.com/elvis-core/bronkit/releases/latest)

</div>

---

## What it is

Bronkit is a Claude Desktop extension that lets you operate your Bron treasury from a chat: ask *"show my balance"*, *"what did I pay for ETH"*, *"where's my idle capital"*, or *"withdraw 0.5 ETH to my saved address"* and Claude calls the right Bron endpoint. It's a from-scratch Node MCP server — no bundled binary, no subprocess. Your API key stays in the OS keychain and is used in memory only. Bronkit never signs or moves funds itself; its ceiling is creating *requests* — Bron's MPC + your Touch ID approve and execute them.

## What you can do

| Capability | What it answers |
|---|---|
| **Portfolio** | *"Show my balance"* — USD-priced balances across all accounts, dust filtered. |
| **Cost basis & P&L** | *"What did I pay for ETH? Am I up or down?"* — FIFO, realised + unrealised, lifetime fees. |
| **Staking / yield** | *"Where's my idle capital?"* — idle holdings against a curated allow-list. No invented APYs. |
| **Transactions** | *"Show my recent transactions"* / *"What moved in transaction X?"* — list, detail, event-level money movement. |
| **Address book** | *"List my saved addresses"* — list, get, create, delete. |
| **Withdrawals & staking** | *"Withdraw 0.5 ETH to my saved Coinbase address"* — preview-first: dry-run → confirm → commit. |
| **Preferences** | Layered over shipped defaults (e.g. dust threshold). |

20 curated tools in total — all annotated and intent-shaped.

## Quickstart

**Before you start:** a Bron workspace where you're an owner · macOS · Claude Desktop · ~5 minutes.

1. [**Create a Bron API key**](#1-create-your-bron-api-key) on developer.bron.org.
2. [**Copy your workspace ID**](#2-copy-your-workspace-id) from Bron Settings.
3. [**Install Bronkit**](#3-install-bronkit) — download the `.mcpb` and double-click.
4. [**Configure and try it**](#4-configure-and-first-call) — paste your key + workspace, ask Claude *"show my balance"*.

---

## Detailed setup

<details>
<summary><b>1. Create your Bron API key</b></summary>
<br>

> 🔑 **Prerequisite (one-off): switch on API key creation in Bron.** If this is your first API key in this workspace, you may need to enable it first: **Settings → Security → Security policies → Other settings → Edit** → switch on **Enable API key creation** → **Save**. Skip if it's already on.

Decide **where you'll save the key** before you generate it. A password manager, an encrypted note app, or a `.txt` / `.jwk` file in an encrypted folder all work. (The advice you may see to "save it to Notepad" just means any text editor — not a physical notepad.)

1. Go to **developer.bron.org** and sign in.
2. **Refresh the page** — ⌘R on macOS, Ctrl+R on Windows. Bron may show a 48-hour security delay notice; that notice applies to a different toggle (address-withdrawal lock), **not** to API keys. A new API key is active immediately after a refresh.
3. Click **+ New API key** and fill in the form:

   | Field | Value |
   |---|---|
   | Name | anything (e.g. `Bronkit on my Mac`) |
   | Team role | **Transaction Operator** |
   | Expiration period | **30 days** (rotate on schedule) |
   | Account access | All accounts |
   | IP whitelist | leave blank |
   | Input public key (JWK) | **leave unticked** |

   > ⚠️ **MPC Transaction Operator — NOT Full Access.** This role prepares transactions and manages your address book but **cannot sign**. Signing needs your **Touch ID on the desktop** (the MPC second key share). Even if Claude does something unexpected, nothing moves without your explicit approval.

4. Click **Generate key** and confirm with **Touch ID** on your Mac.
5. Bron now shows the secret — **once**. The dialog has two values:
   - **Key ID (`kid`)** — you do **NOT** need to copy this; Bronkit doesn't use it.
   - **Private key** — this is the one. Click its **Copy** button: it copies the full JSON, including the `{}` braces (`{"kty":"EC","crv":"P-256","d":"…","x":"…","y":"…","kid":"…"}`). Paste it straight into your password manager / encrypted note.

   <!-- TODO screenshot: bron key dialog with arrow on the Private key Copy button -->

6. Press **"I have saved my key"** to close the dialog.

   > 💡 If you close the dialog without saving the key, you cannot retrieve it later — delete the key and generate a fresh one.

</details>

<details>
<summary><b>2. Copy your workspace ID</b></summary>
<br>

In Bron, go to **Settings → Workspace details** and scroll to the bottom. Copy **Workspace ID** into the same secure place as your key.

Your notepad / password manager now has two things:
- **API key** (the JSON blob from step 1)
- **Workspace ID**

Keep both — you'll need them at install time. After Bronkit is configured, you only need them again if you reinstall or move machines.

<!-- TODO screenshot: bron Workspace details showing Workspace ID at the bottom -->

</details>

<details>
<summary><b>3. Install Bronkit</b></summary>
<br>

1. Download the latest **`bronkit.mcpb`** from [Releases](https://github.com/elvis-core/bronkit/releases/latest).
2. **Open Claude Desktop first** if it isn't already running — the window must be visible on screen, not just a dot under the Dock icon.

   > ⚠️ If Claude Desktop is closed, double-clicking the `.mcpb` does nothing. Open the app first, then double-click.

3. Double-click `bronkit.mcpb`. Claude Desktop opens an install panel for Bronkit.
4. Click **Install**.

<!-- TODO screenshot: Claude Desktop install panel for Bronkit -->

</details>

<details>
<summary><b>4. Configure and first call</b></summary>
<br>

After install, Claude shows a **Configure** dialog with two fields, in this order:

1. **Bron API key (raw JWK JSON)** — paste the full JSON you saved, including the `{}` braces. (The Copy button on the key dialog gave you exactly the right thing; paste as-is.)
2. **Bron workspace ID** — paste the workspace ID.

Click **Save**. Then confirm the connector is **enabled** — the toggle lives in **Settings → Extensions** alongside the Bronkit entry.

<!-- TODO screenshot: Bronkit Configure dialog with the two fields -->
<!-- TODO screenshot: enabled connector toggle in Settings → Extensions -->

Now try it in chat:
- *"show my balance"* — your USD-priced portfolio.
- *"what did I pay for ETH"* — cost basis filtered to one asset.
- *"where's my idle capital"* — idle holdings + on-list staking options.

The first time each tool is used in a chat, Desktop asks for permission — click **Always approve** to silence that tool's prompt for the chat.

<!-- TODO screenshot: a successful "show my balance" answer -->

> ✅ **Proof it worked.** Claude's answer looks something like:
> *"You're holding ~$9,700 across 2 accounts. Largest positions: 0.43 ETH (~$908), 1,680 USDT on ETH, 0.013 WBTC (~$979), with 9.02 SOL currently staked. 14 priced positions; ~$50 of sub-threshold dust hidden."*

</details>

---

## Tips & gotchas

- 💡 **Add a wallet / crypto cue for vague queries.** *"What workspace am I in?"* is ambiguous (Claude has its own workspaces); *"what **wallet** workspace am I in?"* routes straight to Bronkit.
- ✅ **Click Always approve once per tool.** Desktop prompts the first time each tool is used in a chat; click Always approve and it won't ask again.
- 🔄 **Updating Bronkit:** install the new `.mcpb`, then **fully quit Claude (⌘Q) and reopen**. Desktop caches extension icons; the new version (and icon) won't fully appear until restart.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Double-clicking the `.mcpb` does nothing | Open Claude Desktop first (the window must be visible), then double-click. |
| The Configure dialog rejects the key (`401` / `403`) | The JWK got mangled in copy/paste. In Bron, delete the key, generate a fresh one, hit **Copy** on the Private key, paste it as-is (including the `{}` braces). |
| Bronkit replies `404` / "workspace not found" | Workspace ID is wrong. Re-copy from **Bron → Settings → Workspace details**. |
| The extension tile still shows the old icon after an update | Fully quit Claude Desktop (**⌘Q**) and reopen — Desktop caches extension icons. |
| *"What workspace am I in?"* doesn't route to Bronkit | Add a domain cue: *"what **wallet** workspace am I in?"* — `workspace` collides with Claude's own concept. |
| A read tool keeps prompting for permission | First-use prompt per tool per chat (a Desktop default). Click **Always approve** to silence repeats in that chat. |

## Uninstall

In Claude Desktop: **Settings → Extensions → Bronkit → Remove**.
To also revoke API access in Bron: **Settings → API keys → `[your key name]` → Delete**.

## Security

- Free-form text from Bron (memos, descriptions, notes) is treated as **data, never instructions** — Claude won't act on injected text.
- **Every state-changing action is confirmed with you first** — withdrawals, staking, approve / decline / cancel, address-book create / delete.
- **Money moves are preview-first**: Claude runs a dry-run, shows you the fee and the resulting balance, and only creates the real request after you confirm.
- **Bronkit cannot sign or move funds.** Its ceiling is creating *requests* — Bron's MPC + your Touch ID approvers execute them.

## Tools

**Reads** — `bron_workspace_info`, `bron_accounts_list` / `_get`, `bron_balances_list`, `bron_tx_list` / `_get` / `_events`, `bron_address_book_list` / `_get`.

**Composites** — `bron_cost_basis` (FIFO P&L), `bron_staking_opportunities` (idle capital + yield options).

**Writes** (preview-first / state-changing) — `bron_tx_withdrawal`, `bron_tx_staking`, `bron_tx_create_signing_request`, `bron_tx_approve`, `bron_tx_decline`, `bron_tx_cancel`, `bron_address_book_create`, `bron_address_book_delete`.

**Config** — `bron_preferences`.

## Development

```bash
npm install
npm test          # 30 unit + tool tests, no credentials needed
./build.sh        # produces dist/bronkit.mcpb
```

Read-only probes against your own account (you supply the key):

```bash
BRON_API_KEY="$(cat key.jwk)" BRON_WORKSPACE_ID="…" node scripts/cost-basis-probe.js
```

## Licence

MIT © Ilia Brovkin
