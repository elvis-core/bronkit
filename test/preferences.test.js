import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { effectivePreferences, getPreference, updatePreferences, userPrefsPath } from "../src/util/preferences.js";
import { readDustThreshold } from "../src/util/dust.js";
import { preferencesTool } from "../src/tools/config.js";

let tmpFile;
beforeEach(() => {
  tmpFile = join(tmpdir(), `bron-prefs-${randomUUID()}.json`);
  process.env.BRON_PREFS_PATH = tmpFile;
});
afterEach(() => {
  rmSync(tmpFile, { force: true });
  delete process.env.BRON_PREFS_PATH;
});

test("no user file → bundled defaults apply (dustThreshold 1)", () => {
  assert.equal(getPreference("dustThreshold"), 1);
  assert.equal(effectivePreferences().dustThreshold, 1);
  assert.equal(readDustThreshold(), 1);
  assert.equal(userPrefsPath(), tmpFile);
});

test("update writes the user file and overrides the default", () => {
  const r = updatePreferences({ dustThreshold: 5 });
  assert.equal(r.effective.dustThreshold, 5);
  assert.equal(r.defaults.dustThreshold, 1); // default unchanged
  assert.equal(r.user.dustThreshold, 5);
  // Re-read from disk through the normal path.
  assert.equal(getPreference("dustThreshold"), 5);
  assert.equal(readDustThreshold(), 5);
});

test("update rejects unknown keys and invalid values", () => {
  assert.throws(() => updatePreferences({ bogus: 1 }), /Unknown preference/);
  assert.throws(() => updatePreferences({ dustThreshold: -1 }), /must be a number >= 0/);
  assert.throws(() => updatePreferences({ dustThreshold: "5" }), /must be a number/);
});

test("preferences tool: no fields → view; field → update", () => {
  const view = preferencesTool.handler({}, {});
  assert.equal(view.updated, false);
  assert.equal(view.effective.dustThreshold, 1);
  assert.equal(view.path, tmpFile);

  const upd = preferencesTool.handler({}, { dustThreshold: 2.5 });
  assert.equal(upd.updated, true);
  assert.equal(upd.effective.dustThreshold, 2.5);
  assert.equal(upd.overrides.dustThreshold, 2.5);
});
