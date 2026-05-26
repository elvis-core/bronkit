import { test } from "node:test";
import assert from "node:assert/strict";
import { writeTools } from "../src/tools/writes.js";

const byName = new Map(writeTools.map((t) => [t.name, t]));

// Mock client that records every call and echoes a canned response. No network.
function mockCtx() {
  const calls = [];
  return {
    calls,
    workspaceId: "ws_test",
    client: {
      async post(path, body) {
        calls.push({ method: "POST", path, body });
        return { status: "created", transactionId: "tx_1" };
      },
      async del(path) {
        calls.push({ method: "DELETE", path });
        return null;
      },
      async get() {
        return {};
      },
    },
  };
}

test("withdrawal dryRun:true → posts to /dry-run with correct discriminator + params", async () => {
  const ctx = mockCtx();
  const r = await byName.get("bron_tx_withdrawal").handler(ctx, {
    accountId: "acc1",
    amount: "0.5",
    symbol: "ETH",
    networkId: "ETH",
    toAddress: "0xABC",
    feeLevel: "medium",
    dryRun: true,
  });
  const call = ctx.calls[0];
  assert.equal(call.path, "/workspaces/ws_test/transactions/dry-run");
  assert.equal(call.body.transactionType, "withdrawal");
  assert.equal(call.body.accountId, "acc1");
  assert.ok(call.body.externalId, "externalId auto-generated");
  assert.deepEqual(call.body.params, {
    amount: "0.5",
    symbol: "ETH",
    networkId: "ETH",
    toAddress: "0xABC",
    feeLevel: "medium",
  });
  assert.equal(r.dryRun, true);
  assert.equal(r.externalId, call.body.externalId); // echoed back for reuse
});

test("withdrawal dryRun:false reuses provided externalId and posts to /transactions", async () => {
  const ctx = mockCtx();
  await byName.get("bron_tx_withdrawal").handler(ctx, {
    accountId: "acc1",
    amount: "0.5",
    assetId: "E",
    toAccountId: "acc2",
    externalId: "fixed-key-123",
    includeFee: true,
    dryRun: false,
  });
  const call = ctx.calls[0];
  assert.equal(call.path, "/workspaces/ws_test/transactions");
  assert.equal(call.body.externalId, "fixed-key-123");
  assert.equal(call.body.params.includeFee, true);
  assert.equal(call.body.params.toAccountId, "acc2");
});

test("staking maps action → transactionType and forwards stake params", async () => {
  const ctx = mockCtx();
  await byName.get("bron_tx_staking").handler(ctx, {
    action: "delegate",
    accountId: "acc1",
    assetId: "SOL",
    amount: "5",
    poolId: "pool_x",
    dryRun: true,
  });
  const call = ctx.calls[0];
  assert.equal(call.body.transactionType, "stake-delegation");
  assert.equal(call.path, "/workspaces/ws_test/transactions/dry-run");
  assert.deepEqual(call.body.params, { assetId: "SOL", amount: "5", poolId: "pool_x" });
});

test("staking rejects unknown action", async () => {
  const ctx = mockCtx();
  await assert.rejects(
    () => byName.get("bron_tx_staking").handler(ctx, { action: "bogus", accountId: "a", assetId: "SOL" }),
    /Unknown staking action/,
  );
});

test("lifecycle tools hit the right id-scoped endpoints", async () => {
  const ctx = mockCtx();
  await byName.get("bron_tx_create_signing_request").handler(ctx, { transactionId: "tx9" });
  await byName.get("bron_tx_approve").handler(ctx, { transactionId: "tx9" });
  await byName.get("bron_tx_decline").handler(ctx, { transactionId: "tx9", reason: "nope" });
  await byName.get("bron_tx_cancel").handler(ctx, { transactionId: "tx9" });
  assert.equal(ctx.calls[0].path, "/workspaces/ws_test/transactions/tx9/create-signing-request");
  assert.equal(ctx.calls[1].path, "/workspaces/ws_test/transactions/tx9/approve");
  assert.deepEqual(ctx.calls[1].body, {}); // approve sends empty body
  assert.equal(ctx.calls[2].path, "/workspaces/ws_test/transactions/tx9/decline");
  assert.deepEqual(ctx.calls[2].body, { reason: "nope" });
  assert.equal(ctx.calls[3].path, "/workspaces/ws_test/transactions/tx9/cancel");
  assert.deepEqual(ctx.calls[3].body, {}); // no reason → empty body
});

test("address-book create splits accountIds into an array; delete uses DELETE", async () => {
  const ctx = mockCtx();
  await byName.get("bron_address_book_create").handler(ctx, {
    name: "Exchange",
    address: "0xDEF",
    networkId: "ETH",
    accountIds: "acc1, acc2",
  });
  assert.equal(ctx.calls[0].path, "/workspaces/ws_test/address-book-records");
  assert.deepEqual(ctx.calls[0].body.accountIds, ["acc1", "acc2"]);
  assert.equal(ctx.calls[0].body.name, "Exchange");

  await byName.get("bron_address_book_delete").handler(ctx, { recordId: "rec1" });
  assert.equal(ctx.calls[1].method, "DELETE");
  assert.equal(ctx.calls[1].path, "/workspaces/ws_test/address-book-records/rec1");
});

test("all write tools are annotated destructive + non-read-only", () => {
  for (const t of writeTools) {
    assert.equal(t.annotations.readOnlyHint, false, `${t.name} readOnlyHint`);
    assert.equal(t.annotations.destructiveHint, true, `${t.name} destructiveHint`);
    assert.match(t.description, /State-changing — confirm with the user/, `${t.name} confirm phrase`);
  }
});
