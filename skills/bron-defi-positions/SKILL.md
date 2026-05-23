---
name: bron-defi-positions
description: |
  Reconstruct DeFi positions approximately from transaction history on the
  Bron treasury platform. Use when the user asks "what's in my DeFi positions",
  "show me my DeFi exposure", "what have I deposited to Aave", "approximate my
  Lido position", "what am I earning from Compound", or anything about holdings
  in external DeFi protocols. Read-only — no state changes, no confirmation
  needed. ⚠ IMPORTANT: positions are RECONSTRUCTED from outflow/inflow events,
  not read from a native endpoint. This is an approximation. Net position =
  deposits to known contract addresses minus withdrawals from those addresses.
  Does not capture: unrealized yields, collateral ratios, liquidation risk, or
  position state changes from protocol interactions (rebalance, claim, etc.).
  For current balances use `bron-balances-read`; for transaction history use
  `bron-tx-read`.
license: MIT
allowed-tools: |
  Bash(bron tx:*) Bash(bron accounts:*) Bash(bron assets:*) Bash(bron address-book:*)
  Bash(bron --schema:*) Bash(jq:*) Bash(mkdir:*) Bash(cat:*) Bash(test:*) Bash(find:*) Bash(date:*)
  Read
metadata:
  vendor: bronlabs
  version: "0.1.0"
  bron-cli-min: "0.3.7"
---

# Bron DeFi positions: reconstructed from history

Read-only. No state changes; safe without confirmation.

**⚠️ Important:** Bron does NOT expose DeFi positions via a native API endpoint. This skill reconstructs positions *approximately* from transaction history. An outflow to a known DeFi protocol contract address counts as a deposit; an inflow from that address counts as a withdrawal. The net is a position estimate only — it does not reflect yields, fee accrual, rebalances, liquidation risk, or collateral ratios. Use this as a "what did I put where" reference, not as source-of-truth for real-time position state.

## DeFi protocol contract addresses

This skill matches transaction destinations (`extra.toAddress`) against known protocol contract addresses. Maintain this map inline; extend it for your own positions.

**Ethereum mainnet** (illustrative; pull official addresses from protocol docs):

| Protocol | Contract | Purpose |
|---|---|---|
| Aave v3 Pool | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | Lending pool entry point |
| Compound v3 comet | `0xc3d688458d02563751f25e912ba832715b337c3f` | USDC market |
| Uniswap v3 Position Manager | `0xC36442b4a4522E871399CD717aBDD847Ab11218f` | LP position creation |
| Curve liquidity gauge | `0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB` | USDC/USDT staking example |
| Lido stETH | `0xae7ab96520de3a18e5e111b5eaab095312d7fe84` | ETH staking |
| EigenLayer StrategyManager | `0x858646983b2f2153d61336217f5d1495ba88d113` | Restaking entry |

For other chains and protocols, derive from:
- Aave: governance.aave.com → Pool Addresses
- Compound: compound.finance → documentation
- Uniswap: uniswap.org → $UNI governance portal
- Curve: curve.fi → address list
- Protocol-specific audit reports or verified contract explorers (Etherscan, etc.)

**Never guess contract addresses.** If unsure, ask the user for the contract or fetch from official governance docs.

## Preferences

Some views use user-configurable values from `~/.bron/preferences.json`:

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

## Default flow

Fetch transactions with events embedded, filter by known DeFi contract addresses, identify deposits/withdrawals, compute net:

```bash
CACHE_DIR=~/.bron/cache
mkdir -p "$CACHE_DIR"

# Define protocol map (in production, load from a file or API)
PROTOCOLS=$(cat <<'EOF'
{
  "aave-v3-pool": "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9",
  "compound-v3-cusdc": "0xc3d688458d02563751f25e912ba832715b337c3f",
  "uniswap-v3-pm": "0xC36442b4a4522E871399CD717aBDD847Ab11218f",
  "curve-gauge": "0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB",
  "lido-steth": "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
  "eigenlayer-sm": "0x858646983b2f2153d61336217f5d1495ba88d113"
}
EOF
)

TX=$(mktemp)
bron tx list \
  --createdAtFrom "$FROM" \
  --createdAtTo "$TO" \
  --embed events \
  --limit 500 \
  --output json > "$TX"

# Asset registry (24h cache)
ASSETS_CACHE="$CACHE_DIR/assets.json"
if [ ! -s "$ASSETS_CACHE" ] || [ -n "$(find "$ASSETS_CACHE" -mtime +1 2>/dev/null)" ]; then
  bron assets list --limit 500 --output json > "$ASSETS_CACHE"
fi
```

Then cross-reference transactions against protocol addresses to identify deposits/withdrawals.

## Position reconstruction — the canonical pattern

Match outflows to known DeFi contracts, compute net deposits minus withdrawals:

```bash
jq --argjson protocols "$PROTOCOLS" --argjson dust "$DUST" '
  # Invert protocol map: address → protocol name
  ($protocols | to_entries | map({key: (.value | ascii_downcase), value: .key}) | from_entries) as $proto_map
  
  | [.transactions[] as $tx
     | $tx._embedded.events[]?
     | select(.eventType == "out" or .eventType == "in")
     | (
         if .eventType == "out"
         then ($tx.extra.toAddress // "" | ascii_downcase)
         else (.extra.in[0].address // "" | ascii_downcase)
         end
       ) as $addr
     | select($proto_map[$addr] != null)
     | {
         protocol:      $proto_map[$addr],
         address:       $addr,
         asset:         .symbol,
         assetId:       .assetId,
         networkId:     .networkId,
         eventType:     .eventType,
         amount:        .amount,
         usd:           ((.usdAmount // "0") | tonumber),
         timestamp:     .createdAt,
         txId:          .transactionId
       }
    ]
    | group_by([.protocol, .asset, .networkId])[]
    | {
        protocol:      .[0].protocol,
        asset:         .[0].asset,
        networkId:     .[0].networkId,
        deposits:      ([.[] | select(.eventType == "out") | .amount | tonumber] | add // 0),
        depositsUsd:   ([.[] | select(.eventType == "out") | .usd] | add // 0),
        withdrawals:   ([.[] | select(.eventType == "in") | .amount | tonumber] | add // 0),
        withdrawalsUsd: ([.[] | select(.eventType == "in") | .usd] | add // 0),
        events:        (length)
      }
    | . + {
        netAmount: (.deposits - .withdrawals),
        netUsd:    (.depositsUsd - .withdrawalsUsd)
      }
    | select(.netUsd > $dust)
    | sort_by(-.netUsd)
'
```

Then format as a table. Columns: Protocol · Asset · Network · Net Amount · Net USD · Deposits · Withdrawals.

Example output to user:

> **⚠️ Reconstructed from history** — these are net positions (total in minus total out), not real-time balances.
>
> **Your DeFi positions** (from Apr 2026 onwards):
>
> | Protocol | Asset | Network | Net Amount | Net USD | Deposits | Withdrawals |
> |---|---|---|---|---|---|---|
> | Lido | stETH | ethereum | 5.20 | $16,900.00 | 5.20 ETH in | 0.00 |
> | Aave v3 | USDC | ethereum | 8,500.00 | $8,500.00 | 12,000 in | 3,500 out |
> | Uniswap v3 | ETH-USDC LP | ethereum | 2.10 LP | ~$6,840.00 | 2.10 LP in | 0.00 |
>
> **Disclaimers:**
> - Lido position reflects ETH deposited, not current stETH balance or earned yields.
> - Aave net USDC = deposits minus withdrawals; does not include yield, fees, or collateral state.
> - Uniswap position is LP tokens minted; does not reflect Impermanent Loss, current pool value, or fee earnings since deposit.

## Common questions and how to answer them

| User asks | Approach |
|---|---|
| "What have I deposited to Aave?" | Filter reconstruction to `protocol == "aave*"`, show `depositsUsd` |
| "What's my Lido position?" | Filter to `protocol == "lido*"`, return net amount + USD value |
| "Am I still in that Uniswap position?" | Filter to `protocol == "uniswap*"`, show `netAmount`; if ≈ 0, position likely closed |
| "What DeFi am I in?" | Run full reconstruction, group by protocol, list non-zero nets |
| "Show me positions on Arbitrum" | Add `--networkIds arbitrum` to tx list, extend protocol map with Arbitrum addresses |
| "What was my biggest DeFi deposit?" | Reconstruction, sort by `.depositsUsd`, return top rows |
| "When did I enter this position?" | Reconstruction, find first `.timestamp` for the protocol |

## Discovery

```bash
bron tx list --help
bron tx list --schema
bron tx events --schema
bron assets list --help
```

## What this skill does NOT do

- No real-time balances → contract ABIs or a real DeFi API is required; use `bron-balances-read` for native assets
- No yield calculation or fees → transaction history alone cannot reconstruct accrued yield or gas costs
- No collateral ratios, liquidation risk, or protocol state → requires reading position state from contracts
- No position rebalancing suggestions → use output with your own risk models
- No transaction execution → use `bron-tx-send` to create DeFi transactions after identifying positions

## Related skills

- **`bron-balances-read`** — for current wallet balances; cross-check against DeFi deposits to find undeployed capital
- **`bron-tx-read`** — for full transaction history; drill into individual DeFi transactions
- **`bron-tx-send`** — to create new `defi` transactions (e.g., supply/borrow, LP mint/burn, stake/unstake)
- **`bron-onboarding`** — reads `dustThreshold` for position filtering
