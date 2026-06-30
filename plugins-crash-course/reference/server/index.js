// A minimal REMOTE MCP server (Streamable HTTP). Deploy this on your own host;
// the agent-factory plugin points at it by URL in .mcp.json. No code ships to the user.
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 3000);
// The subscription gate. Your billing system sets/revokes this key per customer.
const API_KEY = process.env.AGENT_FACTORY_KEY ?? "";

function buildServer() {
  const server = new McpServer({ name: "agent-factory", version: "1.0.0" });
  server.registerTool(
    "house_voice",
    {
      description: "Return the Agent Factory house writing rules for a given topic.",
      inputSchema: { topic: z.string().optional().describe("what you're writing") },
    },
    async ({ topic }) => ({
      content: [
        {
          type: "text",
          text:
            `House voice${topic ? " for " + topic : ""}: declarative, ` +
            `short sentences, no hedging, plain words, gloss the jargon.`,
        },
      ],
    })
  );
  return server;
}

// Bearer-token gate — the pragmatic minimum. Production should use OAuth 2.1
// (publish /.well-known/oauth-protected-resource, validate tokens, check scopes);
// see the course's "Build the server it points at" section.
function authorized(req) {
  const header = req.headers["authorization"] ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return API_KEY !== "" && token === API_KEY;
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
    return;
  }
  // Stateless: one transport per request — simplest, scales horizontally.
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => console.log(`agent-factory MCP server on :${PORT}/mcp`));
}

export { app, buildServer };
