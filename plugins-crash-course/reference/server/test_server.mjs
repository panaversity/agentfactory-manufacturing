// Boots the remote server on a loopback port and proves:
//   1) no/incorrect key  -> rejected (401, connect fails)
//   2) correct key       -> tools/list shows house_voice, and a call returns text
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 3411;
const KEY = "test-subscription-key";
const URL_ = `http://localhost:${PORT}/mcp`;
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  PASS", m)) : (fail++, console.log("  FAIL", m)));

const srv = spawn("node", ["index.js"], { env: { ...process.env, PORT: String(PORT), AGENT_FACTORY_KEY: KEY }, stdio: "ignore" });
await sleep(900);

async function connect(key) {
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const transport = new StreamableHTTPClientTransport(new global.URL(URL_), { requestInit: { headers } });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

try {
  // 1) wrong key -> must fail
  let blocked = false;
  try { await connect("wrong-key"); } catch { blocked = true; }
  ok(blocked, "unauthorized key is rejected");

  // 2) correct key -> list + call
  const client = await connect(KEY);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  ok(names.includes("house_voice"), "authorized: house_voice tool is exposed");
  const out = await client.callTool({ name: "house_voice", arguments: { topic: "a landing page" } });
  const text = (out.content?.[0]?.text) ?? "";
  ok(text.includes("declarative"), "authorized: tool call returns house voice");
  await client.close();
} catch (e) {
  fail++; console.log("  FAIL (exception):", e.message);
} finally {
  srv.kill("SIGKILL");
}

console.log(fail === 0 ? "ALL PASS" : `FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
