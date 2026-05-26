import { test } from "node:test";
import assert from "node:assert/strict";
import { mulDecimal } from "../src/util/prices.js";

test("mulDecimal: precise, no float error, trims trailing zeros", () => {
  assert.equal(mulDecimal("0.1", "0.2"), "0.02"); // would be 0.020000…4 with floats
  assert.equal(mulDecimal("100", "1"), "100");
  assert.equal(mulDecimal("1683.64", "1"), "1683.64");
  assert.equal(mulDecimal("0", "5"), "0");
  assert.equal(mulDecimal("2", "2094.3529579410665"), "4188.705915882133");
  assert.equal(mulDecimal("bogus", "1"), "");
});
