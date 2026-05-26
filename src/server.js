#!/usr/bin/env node
// Bronkit MCP server — a hand-rolled stdio JSON-RPC server (newline-delimited).
// Hand-rolled (vs the SDK) for full control over the initialize `instructions`
// and per-tool annotations, which are bronkit2's core value-add. It talks to
// api.bron.org directly via the signed client — no bundled binary, no subprocess.

import { BronApiClient } from "./api/client.js";
import { tools, toolsByName } from "./tools/index.js";
import { INSTRUCTIONS } from "./instructions.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "bronkit", title: "Bronkit", version: "0.8.0" };

// Lazy client: tools/list works without credentials; tools/call needs them.
let _client = null;
function getCtx() {
  const apiKey = process.env.BRON_API_KEY;
  const workspaceId = process.env.BRON_WORKSPACE_ID;
  if (!apiKey || !workspaceId) {
    throw new Error("BRON_API_KEY and BRON_WORKSPACE_ID must be configured.");
  }
  if (!_client) _client = new BronApiClient({ apiKey });
  return { client: _client, workspaceId };
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

function toolList() {
  return tools.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations,
  }));
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification (e.g. notifications/initialized)

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: toolList() });
    case "tools/call": {
      const name = params && params.name;
      const tool = toolsByName.get(name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${name}`);
      try {
        const ctx = getCtx();
        const data = await tool.handler(ctx, (params && params.arguments) || {});
        return ok(id, { content: [{ type: "text", text: JSON.stringify(data) }] });
      } catch (e) {
        return ok(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      process.stderr.write(`[bronkit] parse error: ${e.message}\n`);
      continue;
    }
    Promise.resolve(handle(msg)).catch((e) => process.stderr.write(`[bronkit] handler error: ${e.message}\n`));
  }
});
process.stdin.on("end", () => process.exit(0));
process.stderr.write("[bronkit] MCP server started\n");
