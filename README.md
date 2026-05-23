# Bronkit

Bronkit is a Claude Desktop integration for the Bron treasury platform. Tell Claude what you want — check your portfolio, look up a transaction, prepare a payment, compute P&L on your holdings — and Claude does the read-work and the prep-work for you. State changes never go through Claude directly: anything that moves money gets surfaced as a clean summary, and you approve it in the Bron app.

**Tell Claude. Approve in Bron.**

## Install

Two steps. Both via Claude Desktop UI — no terminal needed.

### Step 1 — install the server

1. Download `bronkit-0.1.1.mcpb` from the latest GitHub release.
2. Double-click the file.
3. Paste your Bron API key (JWK) and workspace ID when prompted.
4. Installs in a few seconds.

### Step 2 — install the skills

1. Download `bronkit-skills-0.2.0.zip` from the same release.
2. In Claude Desktop, open **Customize → Plugins**.
3. Click **+ → Create plugin → Upload plugin**.
4. Drag the zip into the dialog.
5. All 9 skills register.

## First-run notes

- The first time you use each skill, Claude Desktop asks for permission to run it. Click **Always allow** to silence the prompt for that skill.
- A few skill steps may show shell-command popups. Click **Always allow** on each — they're shell tools (jq, file reads, etc.) the skills use internally.
- After the first run of each skill, prompts go quiet.

## What's included

| Skill | What it does | Try saying |
|---|---|---|
| `bron-balances-read` | Show your portfolio | "show my portfolio" |
| `bron-tx-read` | Read transactions, who paid you, income | "who paid me last month" |
| `bron-tx-send` | Prepare a transaction (you approve in Bron app) | "send 10 USDT to <contact>" |
| `bron-tx-subscribe` | Watch for transaction settlement | "watch for new transactions" |
| `bron-address-book` | View your saved addresses | "show me my bron address book" |
| `bron-cost-basis` | Compute P&L on holdings | "which holdings am I up on" |
| `bron-opportunities` | Find idle capital and yield options | "what could I be staking" |
| `bron-defi-positions` | Reconstruct DeFi positions (approximate) | "show my DeFi exposure" |
| `bron-onboarding` | Configure your preferences | "configure my bron portfolio rules" |

## Honest limitations

- **Skills are guidance the AI follows.** Output shape and details may vary between runs. The AI is non-deterministic — the same question can produce slightly different answers.
- **`bron-defi-positions` is approximate.** Bron's DeFi connectivity is via WalletConnect, not a native API. The skill reconstructs positions from transaction history — known incomplete coverage.
- **macOS Apple Silicon only.** The installer is built for arm64 macOS. Other platforms will be added later.

## Feedback

You're the pilot cohort, and what you flag shapes v0.3.0. Please tell us what broke, what was confusing, and where the output didn't match what you expected — every report helps us tune the skills before wider release.
