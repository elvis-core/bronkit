---
name: bron-onboarding
description: |
  Conversational setup for the user's bronkit preferences. Use when the
  user says "bron setup", "bron configure", "configure bron", "configure
  my bron", "set up bron", "set up my bron preferences", "set up my
  preferences", "configure preferences", "edit bron preferences",
  "change my bron settings", "what are my preferences", "what are my
  bron preferences", "show me my preferences", "change my portfolio cap",
  "change my dust threshold", or anything that asks to adjust how bron
  skills behave for them. Writes/updates `~/.bron/preferences.json` —
  a small file every other bron skill reads on each call.
  Five questions: portfolio concentration cap, dust threshold, display
  currency, default account, breach behaviour. Can run the full flow
  or update one value at a time.
license: MIT
allowed-tools: |
  mcp__bron__bron_accounts_list
  Bash(jq:*) Bash(mkdir:*) Bash(cat:*) Bash(test:*) Bash(date:*) Bash(mv:*)
  Read
metadata:
  vendor: bronlabs
  version: "0.2.0"
  bron-cli-min: "0.3.7"
---

# Bron onboarding

This skill operates on the local preferences file, not the Bron API — it uses shell tools, not MCP, for everything except the one read of accounts that validates the default-account answer.

Conversational. Output is a single local file: `~/.bron/preferences.json`.

## When to trigger

- "bron setup", "configure bron", "set up bron preferences"
- "change my [cap / dust / currency / default account] to X"
- "what are my settings", "show my preferences"

If the preferences file already exists, ask whether the user wants to reconfigure or just check current values. Don't blindly overwrite.

## The conversation flow

Walk the user through five questions, one at a time, conversationally. Don't dump all five at once. Wait for each answer, confirm, move to the next.

**Question 1 — portfolio concentration cap**

> "What % of your portfolio should trigger a concentration warning? Most people use 15-25%. Higher means looser, lower means stricter. (Default: 15%)"

Accept any number 1-50. Reject values outside that range and re-ask.

**Question 2 — dust threshold**

> "Below what USD value should I hide tiny positions from your portfolio view? (Default: $1 — anything under a dollar is hidden as dust)"

Accept any positive number. $0 means show everything including unpriced.

**Question 3 — display currency**

> "What currency should I use for displays? (Default: USD)"

Accept ISO currency codes (USD, EUR, GBP, etc.). Note that pricing data still comes through in USD from the Bron API; this is for display formatting only.

**Question 4 — default account**

> "When you don't specify an account, which one should I use by default? Let me list your accounts, or say 'skip' to leave unset."

If the user says skip, leave unset. Otherwise list options with `mcp__bron__bron_accounts_list {}` and validate the chosen accountId against the returned `accounts[].accountId`.

**Question 5 — concentration breach behaviour**

> "When I find a position over your cap, should I just flag it, or also suggest a rebalance? (Default: flag only — you can ask for a rebalance manually)"

Two values: `flag` or `suggest`. Default `flag`.

## Writing the file

After the user confirms answers, write `~/.bron/preferences.json`:

```bash
mkdir -p ~/.bron

cat > ~/.bron/preferences.json <<EOF
{
  "portfolioCap": 15,
  "dustThreshold": 1,
  "displayCurrency": "USD",
  "defaultAccountId": null,
  "breachBehavior": "flag",
  "_lastUpdated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "_version": 1
}
EOF
```

Substitute the user's actual answers for the defaults shown above. Confirm with the user that the file was written and summarise what was saved:

> "Saved. Your settings:
> - Cap: 15%
> - Dust: $1
> - Currency: USD
> - Default account: not set
> - Breach behaviour: flag only
>
> Change any of these any time by saying 'bron setup' or 'change my bron settings'."

## Reading existing preferences

If the user asks "what are my settings" or similar, read and surface the file:

```bash
if [ -f ~/.bron/preferences.json ]; then
  jq . ~/.bron/preferences.json
else
  echo "No preferences set. Run 'bron setup' to configure."
fi
```

## Updating one value at a time

Users will say things like "change my cap to 20" — don't run the full five-question flow. Update just that key:

```bash
jq '.portfolioCap = 20 | ._lastUpdated = "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"' \
  ~/.bron/preferences.json > ~/.bron/preferences.json.tmp \
  && mv ~/.bron/preferences.json.tmp ~/.bron/preferences.json
```

Then confirm: "Updated. Cap is now 20%."

## Hard rules

- Always confirm before writing — show the user the values you're about to save and wait for OK.
- Never write the file if the user is mid-conversation about something else (a tx, a portfolio query, etc.). Setup is its own mode.
- The file is local config only. Never send these values anywhere — they're not credentials, but they're personal preferences that don't need to leave the user's machine.
- If a Bron API call would be required to validate something (e.g. checking that `defaultAccountId` exists), only make read-only calls. Don't write anything to Bron.

## What this skill does NOT do

- No portfolio queries → `bron-balances-read`
- No transaction operations → `bron-tx-send`
- No data analysis → use the relevant read skill after setup completes

## Related skills

- **`bron-balances-read`** — reads `portfolioCap` and `dustThreshold` on every portfolio view
- **`bron-tx-read`** — reads `displayCurrency` for formatted views
- **`bron-tx-send`** — may read `defaultAccountId` if user doesn't specify
