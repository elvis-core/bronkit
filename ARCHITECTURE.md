# Bronkit — Architecture

Audience: an AI assistant with zero prior context, advising on Anthropic Desktop Extension (.mcpb) submission readiness. Read-only analysis of the tree at `bronkit-v010-build/`. No git repository is present in the tree.

## 1. Project shape

A Node.js MCP shim that wraps a bundled Go CLI. Runtime: Node `>=18` (manifest `compatibility.runtimes.node`); the real work is done by an arm64 Go binary. Package manager: npm — `server/package.json` declares one dependency, `@modelcontextprotocol/sdk@^1.29.0`, though `server/index.js` does not actually import the SDK (it only spawns the CLI). Layout, two levels deep (node_modules omitted):

```
bronkit-v010-build/
  manifest.json
  README.md  ARCHITECTURE.md  STATUS.md  LESSONS.md  MCP_SURFACE.md
  SESSION_LOG.md  TEST_REPORTS.md
  .claude-plugin/plugin.json
  fix-specs/            # 7 *.md patch specs
  server/
    index.js            # MCP entry point
    package.json
    bin/bron            # bundled Go CLI, Mach-O arm64, 11.5 MB
    node_modules/
  skills/
    SKILL.md  SKIL1L.md  # stray duplicates at skills root
    bron-address-book/ … bron-tx-subscribe/   # 9 dirs, each a SKILL.md
```

Entry point: `server/index.js` (manifest `entry_point`). Started locally by Claude Desktop as `node ${__dirname}/server/index.js` with env `BRON_API_KEY` and `BRON_WORKSPACE_ID`. There is no npm start script.

## 2. MCP server internals

Two processes. `server/index.js` registers no tools itself; it spawns `bron mcp` and pipes `stdin`/`stdout` between Claude Desktop and that subprocess. Transport is **stdio** (binary strings: `*mcp.StdioTransport`, "stdio server, foreground"). The Go binary uses `github.com/modelcontextprotocol/go-sdk`. Tools are generated from the Bron public-API surface (one typed MCP tool per REST endpoint); registration lives inside the compiled binary, not as readable source.

Tool count: **53**, observed on the connected "Bronkit (smoke test)" server. By domain:

- accounts (2), activities (1), assets (3), balances (2), deposit_addresses (1), members (1), networks (2), stakes (1), symbols (3), transaction_limits (2), workspace_info (1) — all **read-only**.
- address_book (4) — `list`/`get` read; `create`/`delete` **state-changing**.
- intents (2) — `get` read; `create` **state-changing**.
- transactions (28) — `get`, `list`, `events`, `intents`, `dry_run`, `wait_for_state` read (6); the other 22 (`create`, `withdrawal`, `bridge`, `allowance`, `deposit`, `defi`, `defi_message`, `fiat_in`, `fiat_out`, `approve`, `decline`, `cancel`, `bulk_create`, `create_signing_request`, `accept_deposit_offer`, `reject_outgoing_offer`, `address_creation`, `address_activation`, `stake_delegation`/`undelegation`/`claim`/`withdrawal`) **state-changing**.

Totals: 28 read-only, 25 state-changing.

## 3. CLI relationship

The Node layer does not hit the API directly; it shells out to the bundled CLI's `mcp` subcommand, which then calls the Bron REST API at `https://api.bron.org`. Chain: Node shim → `bron mcp` (Go) → HTTPS to `api.bron.org`. The binary is **bundled** at `server/bin/bron` (committed, not downloaded on first run). On boot `index.js` also symlinks `~/.local/bin/bron` → the bundled binary so skills that shell out to `bron …` resolve it.

End-to-end, `bron_balances_list`: Claude Desktop sends a JSON-RPC `tools/call` over stdio to `index.js` → piped to the `bron mcp` subprocess → CLI maps it to `bron balances list` → `GET https://api.bron.org/.../balances` with a JWT signed by the JWK → JSON response → CLI serialises it as an MCP tool result → piped back through `index.js` to Claude Desktop. No `jq` or parsing in the Node layer.

## 4. Authentication

The user pastes two values into Claude Desktop's extension config (`user_config`): `bron_api_key` (raw JWK JSON, `sensitive: true`, so Claude Desktop stores it in the OS keychain) and `bron_workspace_id`. Claude Desktop injects both as env vars. On boot, `initBronConfig()` writes the JWK to `~/.config/bron/keys/default.jwk` at mode `0600`, drops a `.bronkit-managed` marker, and runs `bron config init --key-file …`. The CLI signs each API request with that JWK (binary references "Signing" / JWT).

**Plaintext-on-disk flag:** the JWK private key is written verbatim to `~/.config/bron/keys/default.jwk` (mode `0600`, but plaintext). The keychain holds the canonical copy, yet the server materialises a plaintext private key on disk for the CLI. There is no cleanup on shutdown — `rmSync` is imported but never called.

## 5. Tool annotations

The Go SDK annotation fields exist in the binary (`ReadOnlyHint`, `DestructiveHint`, `IdempotentHint`, `OpenWorldHint`, all `,omitempty`). Whether each tool populates them is **not inspectable** from the compiled binary, and the descriptors I can read expose only `name` + `inputSchema` + `description` — no `title`, no `annotations` object surfaced. The read/write signal is carried in **description prose** ("Read-only." / "State-changing — confirm with the user"), which is semantically correct but is not the structured annotation a Desktop Extension review expects. Per-tool detail overflows the budget (see follow-ups); grouped:

| Tool group | title present | readOnly/destructiveHint set | value correct |
|---|---|---|---|
| Read-only groups + tx reads (28) | unclear: no `title` seen; name is snake_case id | unclear: not visible in descriptors | y — prose "Read-only" is correct |
| address_book create/delete, intents create, 22 tx writes (25) | unclear (as above) | unclear (as above) | y — prose "State-changing" is correct |

## 6. Skills

Both bundled and shipped separately. The 9 skills sit inside the .mcpb at `skills/<name>/SKILL.md` and are also distributed as `bronkit-skills-*.zip`, the Claude Desktop plugin described by `.claude-plugin/plugin.json`. README's install flow uses the separate zip.

- `bron-balances-read` — account balances and portfolio views.
- `bron-tx-read` — read/analyse transactions, income, "who paid me".
- `bron-tx-send` — create/approve/decline/cancel transactions (approved in Bron).
- `bron-tx-subscribe` — stream live transaction updates.
- `bron-address-book` — manage saved addresses.
- `bron-cost-basis` — FIFO cost basis and P&L ranking.
- `bron-opportunities` — detect idle capital, surface staking/lending options.
- `bron-defi-positions` — approximate DeFi reconstruction from tx history.
- `bron-onboarding` — conversational setup, writes `~/.bron/preferences.json`.

Fresh-install references that may not resolve: skills shell out to `bron` on PATH and depend on the boot-time `~/.local/bin/bron` symlink plus `~/.local/bin` being on PATH (not guaranteed). Several skills read `~/.bron/preferences.json`, which does not exist until `bron-onboarding` runs (they document a default fallback). The .mcpb `skills/` root also ships stray `SKILL.md` and `SKIL1L.md` (duplicate balances/address-book files) — a packaging error.

## 7. manifest.json state

`manifest_version` `"0.3"`. `user_config`: `bron_api_key` (sensitive), `bron_workspace_id`. No `privacy_policies` array, no `icon`, no `screenshots`. Verbatim (44 lines, under 100):

```json
{
  "manifest_version": "0.3",
  "name": "bronkit",
  "display_name": "Bronkit (smoke test)",
  "version": "0.1.2",
  "description": "Bronkit MCPB bundle for Bron treasury operations: one MCP tool that calls the bundled bron CLI, plus nine skills (portfolio view, transactions, cost basis, DeFi reconstruction, staking opportunities, and admin operations). On first server boot, symlinks ~/.local/bin/bron to the bundled binary so skills can shell out to it.",
  "author": {
    "name": "Ilia Brovkin"
  },
  "server": {
    "type": "node",
    "entry_point": "server/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.js"],
      "env": {
        "BRON_API_KEY": "${user_config.bron_api_key}",
        "BRON_WORKSPACE_ID": "${user_config.bron_workspace_id}"
      }
    }
  },
  "user_config": {
    "bron_api_key": {
      "type": "string",
      "title": "Bron API key (raw JWK JSON)",
      "description": "Paste the contents of your Bron JWK key file. Stored in the OS keychain.",
      "sensitive": true,
      "required": true
    },
    "bron_workspace_id": {
      "type": "string",
      "title": "Bron workspace ID",
      "description": "UUID of the workspace this bundle should talk to.",
      "sensitive": false,
      "required": true
    }
  },
  "compatibility": {
    "platforms": ["darwin"],
    "runtimes": {
      "node": ">=18"
    }
  }
}
```

## 8. Build and packaging

unclear: there is no build script, Makefile, CI workflow, or signing config anywhere in the tree — the .mcpb appears to be a manual zip of `manifest.json` + `server/` + `skills/`. Code signing: the bundled `bron` binary is **adhoc / linker-signed** (`codesign`: `flags=0x20002(adhoc,linker-signed)`, `TeamIdentifier=not set`) — not Developer ID-signed and not notarised. No Windows signing (manifest is `darwin`-only). No auto-update endpoint is declared in the manifest.

## 9. Distribution today

README directs users to download `bronkit-0.1.1.mcpb` and `bronkit-skills-0.2.0.zip` from "the latest GitHub release". unclear: the GitHub repo/owner is not recorded anywhere in the tree, and there is no release metadata or download-count data in the repo. Local artefacts present: `bronkit-0.1.1.mcpb`, `bronkit-0.1.2.mcpb`, and skills zips `0.1.1` / `0.2.0-alpha` / `0.2.0` / `0.2.1`.

## 10. Gaps against Desktop Extension submission

- **(a) Production name/version — missing.** `display_name` is "Bronkit (smoke test)", `version` `0.1.2`, and versions disagree across files (manifest `0.1.2` vs `plugin.json` `0.2.1` vs README `0.1.1`/`0.2.0`).
- **(b) Annotations complete/correct — partial.** Read/write is signalled in description prose; structured `readOnlyHint`/`destructiveHint` and `title` are not verifiable and likely unset.
- **(c) manifest_version 0.2+ — done.** `"0.3"`.
- **(d) privacy_policies populated — missing.** Key absent from manifest.
- **(e) Privacy Policy in README — missing.** No privacy section (no "privacy"/"licence"/"data" matches).
- **(f) Three documented usage examples — partial.** README's "Try saying" column gives one example per skill, but not in the manifest and not a dedicated examples section.
- **(g) user_config for credentials — done.** `bron_api_key` (sensitive) + `bron_workspace_id`.
- **(h) Code signing — missing.** Adhoc/linker-signed only, not notarised; no Windows.
- **(i) Auto-update endpoint — missing.** None in manifest.
- **(j) Icon and screenshots — missing.** No icon/screenshot files; no manifest keys.

### Follow-up questions (overflow)

1. A per-tool annotation audit needs the raw `tools/list` JSON from `bron mcp` — can you capture and share it?
2. Which GitHub repo/owner hosts the releases, and are download counts available?
3. Is the plaintext JWK at `~/.config/bron/keys/default.jwk` meant to persist, or should the unused `rmSync` clean it up on shutdown?
