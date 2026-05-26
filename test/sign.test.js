import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateKeyPair, exportJWK, compactVerify, importJWK } from "jose";
import { canonicalMessage, generateBronJwt, parseJwk } from "../src/auth/sign.js";

const b64urlJson = (seg) => JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));

async function testJwk() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const priv = await exportJWK(privateKey); // {kty,crv,x,y,d}
  const pub = await exportJWK(publicKey);
  priv.kid = "test-kid-123";
  return { priv, pub };
}

test("canonicalMessage matches the Go format exactly", () => {
  const msg = canonicalMessage({ iat: 1700000000, method: "get", pathWithQuery: "/v1/workspaces", body: "" });
  assert.equal(msg, "1700000000\nGET\n/v1/workspaces\n");
});

test("generateBronJwt: header, claims, and message hash are correct", async () => {
  const { priv } = await testJwk();
  const iat = 1700000000;
  const method = "GET", pathWithQuery = "/v1/balances?limit=50", body = "";
  const jwt = await generateBronJwt({ method, pathWithQuery, body, jwk: priv, iat });

  const [h, p] = jwt.split(".");
  const header = b64urlJson(h);
  const payload = b64urlJson(p);

  assert.equal(header.alg, "ES256");
  assert.equal(header.kid, "test-kid-123");
  assert.equal(payload.iat, iat);
  const expected = createHash("sha256")
    .update(canonicalMessage({ iat, method, pathWithQuery, body }), "utf8")
    .digest("hex");
  assert.equal(payload.message, expected);
});

test("signature round-trips against the public key", async () => {
  const { priv, pub } = await testJwk();
  const jwt = await generateBronJwt({
    method: "POST",
    pathWithQuery: "/v1/transactions",
    body: '{"amount":"100"}',
    jwk: priv,
    iat: 1700000000,
  });
  const pubKey = await importJWK(pub, "ES256");
  const { protectedHeader } = await compactVerify(jwt, pubKey);
  assert.equal(protectedHeader.alg, "ES256");
});

test("body is included raw in the hashed message (not pre-hashed)", async () => {
  const { priv } = await testJwk();
  const iat = 1700000000, body = '{"a":1,"b":2}';
  const jwt = await generateBronJwt({ method: "POST", pathWithQuery: "/v1/tx", body, jwk: priv, iat });
  const payload = b64urlJson(jwt.split(".")[1]);
  const expected = createHash("sha256").update(`${iat}\nPOST\n/v1/tx\n${body}`, "utf8").digest("hex");
  assert.equal(payload.message, expected);
});

test("parseJwk rejects non-EC and private-key-less JWKs", () => {
  assert.throws(() => parseJwk({ kty: "RSA" }), /unsupported JWK/);
  assert.throws(() => parseJwk({ kty: "EC", crv: "P-256" }), /missing private/);
});
