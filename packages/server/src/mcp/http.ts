import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response, Router } from "express";
import express from "express";
import { DEFAULT_PROJECT_ID, type ProjectManager, type SettingsStore } from "@understory/core";
import { buildMcpServer } from "./server.js";

/**
 * MCP streamable-HTTP at /mcp. Stateless: a fresh McpServer + transport per
 * request (no session store) — the KB itself serializes mutations.
 *
 * `/mcp?project=<id>` binds the session's DEFAULT project (per registration:
 * different agents can point the same server at different home projects);
 * every tool still accepts an explicit `project` argument for cross-project
 * access.
 */
export function mcpRouter(pm: ProjectManager, store?: SettingsStore): Router {
  const router = express.Router();

  const handle = async (req: Request, res: Response) => {
    const requestAbort = new AbortController();
    const abortRequest = () => requestAbort.abort();
    req.once("aborted", abortRequest);

    const defaultProject = String(req.query.project ?? DEFAULT_PROJECT_ID);
    const server = await buildMcpServer(pm, store, requestAbort.signal, defaultProject);
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
