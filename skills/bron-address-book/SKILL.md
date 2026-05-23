---
name: bron-address-book
description: |
  Manage saved addresses (the address book) on the Bron treasury platform.
  Use when the user wants to list saved addresses, save a new one, delete
  one, or look up a record id to use as `toAddressBookRecordId` in a withdrawal.
  State-changing actions (create, delete) require human-in-the-loop confirmation.
license: MIT
allowed-tools: |
  mcp__bron__bron_address_book_list mcp__bron__bron_address_book_get
  mcp__bron__bron_address_book_create mcp__bron__bron_address_book_delete
  Read
metadata:
  vendor: bronlabs
  version: "0.2.0"
  bron-cli-min: "0.3.7"
---

# Bron address book

The address book is the workspace's trusted recipient list, keyed by `(workspaceId, networkId, address)`. Bron validates withdrawals against it — passing `toAddressBookRecordId` is safer and more readable than a raw `toAddress`. Two `recordType`s: `address` (raw on-chain) and `tag` (Bron internal routing).

## List

```text
mcp__bron__bron_address_book_list { networkIds: "ETH,TRX" }
```

Returns a `records` array. Each record has `recordId`, `name`, `networkId`, `address`, `recordType`, `status`, `memo`. Omit `networkIds` to get every network.

The MCP tool descriptor is self-describing for the full filter set.

## Get one record

```text
mcp__bron__bron_address_book_get { recordId: "<id>" }
```

Use when you already have a `recordId` and want its full details.

## Create — state-changing, confirm first

```text
mcp__bron__bron_address_book_create {
  name: "Alice (vendor)",
  address: "0xabcd…",
  networkId: "ETH",
  memo: "primary payout address"
}
```

Pass `recordType: "tag"` with a Bron tag in `address` for internal routing.

The new `recordId` comes back in the response — pass it as `params.toAddressBookRecordId` in subsequent withdrawals (see `bron-tx-send`).

## Delete — state-changing, irreversible, confirm first

```text
mcp__bron__bron_address_book_delete { recordId: "<id>" }
```

If a pending transaction references the record, deletion fails with a 400 — resolve those first.

## Resolving a recipient before sending

Standard pattern: user gives a name, you turn it into a `recordId`.

1. Call `mcp__bron__bron_address_book_list { networkIds: "<network>" }`.
2. Filter the `records` array for `name == "<requested>"`.
3. If exactly one match, take its `recordId`.
4. If multiple matches, surface them all (name + network + masked-middle address) and let the user pick — don't blindly take the first.
5. If no match, tell the user: "<name> not in address book — add them or supply a raw address."

## Hard rules

- Never `create` without showing the user the exact `(name, address, networkId)` tuple and waiting for explicit OK. A typo creates a permanent on-chain risk.
- Never `delete` without confirming the record summary first.
- For `recordType=address`, sanity-check the address looks right for the network (EVM checksum case for `ETH`, base58 for `TRX`, …) before submitting — server validates, but a pre-check saves a round trip.
