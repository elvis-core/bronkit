#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const BRON = join(here, "bin", "bron");

// Skills + helper scripts hardcode the absolute path ~/.local/bin/bron.
// MCPB has no install hook, so we do this on every server boot — idempotent.
function installBronSymlink() {
  const linkDir = join(homedir(), ".local", "bin");
  const linkPath = join(linkDir, "bron");
  try {
    mkdirSync(linkDir, { recursive: true });
  } catch (e) {
    console.error(`[bronkit] could not create ${linkDir}: ${e.message}`);
    return;
  }
  let st;
  try {
    st = lstatSync(linkPath);
  } catch {
    try {
      symlinkSync(BRON, linkPath);
      console.error(`[bronkit] symlinked ${linkPath} -> ${BRON}`);
    } catch (e) {
      console.error(`[bronkit] symlink failed: ${e.message}`);
    }
    return;
  }
  if (st.isSymbolicLink()) {
    const current = readlinkSync(linkPath);
    if (current === BRON) return;
    try {
      unlinkSync(linkPath);
      symlinkSync(BRON, linkPath);
      console.error(`[bronkit] repointed ${linkPath} -> ${BRON} (was ${current})`);
    } catch (e) {
      console.error(`[bronkit] repoint failed: ${e.message}`);
    }
    return;
  }
  console.error(
    `[bronkit] ${linkPath} already exists as a real file; leaving it alone. ` +
      `Remove it manually if you want skills to use the bundled CLI.`,
  );
}

installBronSymlink();

async function initBronConfig() {
  const configDir = join(homedir(), ".config", "bron");
  const keysDir = join(configDir, "keys");
  const keyFile = join(keysDir, "default.jwk");
  const markerFile = join(configDir, ".bronkit-managed");

  const apiKey = process.env.BRON_API_KEY;
  const workspaceId = process.env.BRON_WORKSPACE_ID;

  if (!apiKey || !workspaceId) {
    console.error(
      "[bronkit] BRON_API_KEY and BRON_WORKSPACE_ID env vars not set; skipping config init",
    );
    return;
  }

  try {
    mkdirSync(keysDir, { recursive: true });
  } catch (e) {
    console.error(`[bronkit] could not create ${keysDir}: ${e.message}`);
    return;
  }

  // Write the JWK with restricted permissions (600)
  try {
    writeFileSync(keyFile, apiKey, { mode: 0o600 });
    console.error(`[bronkit] wrote JWK to ${keyFile}`);
  } catch (e) {
    console.error(`[bronkit] could not write JWK: ${e.message}`);
    return;
  }

  // Mark that we created this config so we can clean it up later
  try {
    writeFileSync(markerFile, "bronkit-managed\n");
    console.error(`[bronkit] marked config as managed`);
  } catch (e) {
    console.error(`[bronkit] could not write marker: ${e.message}`);
  }

  // Initialize the bron profile
  try {
    const { stdout } = await execFileP(
      BRON,
      [
        "config",
        "init",
        "--name",
        "default",
        "--workspace",
        workspaceId,
        "--key-file",
        keyFile,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    console.error(`[bronkit] initialized bron config: ${stdout.trim()}`);
  } catch (err) {
    console.error(
      `[bronkit] bron config init failed: ${err.message}${
        err.stderr ? "\n" + err.stderr.toString() : ""
      }`,
    );
  }
}

await initBronConfig();

// Hand off to `bron mcp` for the full CLI surface as typed MCP tools.
// The bundled binary's `mcp` subcommand exposes every public-API endpoint
// as a typed MCP tool — no shell quoting, no jq parsing on the skill side.
const bronMcp = spawn(BRON, ["mcp"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    BRON_API_KEY: process.env.BRON_API_KEY ?? "",
    BRON_WORKSPACE_ID: process.env.BRON_WORKSPACE_ID ?? "",
  },
});

// Pipe MCP traffic between Claude Desktop and the bron mcp subprocess
process.stdin.pipe(bronMcp.stdin);
bronMcp.stdout.pipe(process.stdout);

// Forward stderr to our own stderr (Claude Desktop captures both)
bronMcp.stderr.on("data", (data) => {
  console.error(`[bron mcp] ${data.toString().trim()}`);
});

bronMcp.on("exit", (code, signal) => {
  console.error(`[bronkit] bron mcp exited code=${code} signal=${signal}`);
  process.exit(code ?? 0);
});

// Forward shutdown signals so bron mcp cleans up properly
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => bronMcp.kill(sig));
}
