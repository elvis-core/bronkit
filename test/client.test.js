import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeQuery } from "../src/api/client.js";

test("encodeQuery: sorts keys, joins arrays with comma, skips null, empty → ''", () => {
  assert.equal(encodeQuery(), "");
  assert.equal(encodeQuery({}), "");
  assert.equal(encodeQuery({ b: 2, a: 1 }), "?a=1&b=2"); // sorted
  assert.equal(encodeQuery({ ids: [3, 1, 2] }), "?ids=3%2C1%2C2"); // joined w/ comma
  assert.equal(encodeQuery({ x: null, y: 1 }), "?y=1"); // null skipped
  assert.equal(encodeQuery({ nonEmpty: true }), "?nonEmpty=true");
});
