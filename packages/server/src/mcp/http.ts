import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response, Router } from "express";
import express from "express";
import type { KnowledgeBase, SettingsStore } from "@understory/core";
import { buildMcpServer } from "./server.js";

/**
 * MCP streamable-HTTP at /mcp. Stateless: a fresh McpServer + transport per
 * request (no session store) — the KB itself serializes mutations. Express
 * hands the SDK transport the raw Node req/res directly, so there is no
 * hijack/lifecycle glue and CORS is handled by the app-level cors() middleware.
 */
export function mcpRouter(kb: KnowledgeBase, store?: SettingsStore): Router {
  const router = express.Router();

  const handle = async (req: Request, res: Response) => {
    const requestAbort = new AbortController();
    const abortRequest = () => requestAbort.abort();
    req.once("aborted", abortRequest);

    const server = await buildMcpServer(kb, store, requestAbort.signal);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      // SSE per request (not buffered JSON): progress notifications must reach
      // the client DURING long agent runs — buffered mode would drop them and
      // clients would sit blind until their flat timeout kills the call.
      enableJsonResponse: false,
    });
    res.on("close", () => {
      // If the client disconnects while an LLM call is active, stop that work
      // instead of leaving it occupying the local model indefinitely.
      abortRequest();
      transport.close();
      server.close();
    });
    await server.connect(transport);
    // express.json() already parsed the body; pass it so the transport doesn't
    // try to re-read the consumed stream.
    await transport.handleRequest(req, res, req.body);
  };

  router.post("/", handle);
  router.get("/", handle);
  router.delete("/", handle);
  return router;
}
