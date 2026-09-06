#!/usr/bin/env node
/**
 * MCP over stdio — register in Claude Code / Claude Desktop:
 *   claude mcp add okf-kb -e BUNDLE_ROOT=/path/to/bundle \
 *     -- node <repo>/packages/server/dist/mcp/stdio.js
 *
 * Multi-project: set PROJECTS_ROOT (and optionally UNDERSTORY_PROJECT for the
 * session default). Single-bundle: set BUNDLE_ROOT — it becomes project
 * "default", same as before.
 */
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  DEFAULT_PROJECT_ID,
  ProjectManager,
  SettingsStore,
  resolveFallbackConfig,
  resolveModelConfig,
} from "@understory/core";
import { buildMcpServer } from "./server.js";

const bundleRoot = process.env.BUNDLE_ROOT;
const projectsRoot =
  process.env.PROJECTS_ROOT ??
  (bundleRoot ? path.join(bundleRoot, "..", "understory-projects") : undefined);
if (!projectsRoot) {
  console.error("BUNDLE_ROOT or PROJECTS_ROOT env var is required");
  process.exit(1);
}

const store = new SettingsStore(bundleRoot ?? projectsRoot);
await store.load();
store.applyProcessEnv();

// Validate LLM config at startup — fail fast with a clear error. stdio's
// only output channel to the user is stderr; stdout is reserved for the
// MCP protocol stream. Settings overrides are applied via effectiveEnv.
try {
  const env = store.effectiveEnv();
  const primaryConfig = resolveModelConfig(env);
  console.error(
    `[understory] model: ${primaryConfig.format}:${primaryConfig.model || "auto"} @ ${primaryConfig.baseURL}`
  );
  const fallbackConfig = resolveFallbackConfig(env);
  if (fallbackConfig) {
    console.error(
      `[understory] fallback: ${fallbackConfig.format}:${fallbackConfig.model || "auto"} @ ${fallbackConfig.baseURL}`
    );
  }
} catch (err) {
  console.error(`[understory] LLM configuration error: ${(err as Error).message}`);
  console.error("[understory] Set LLM_API_BASE_URL + LLM_API_KEY, or configure legacy env vars.");
  process.exit(1);
}

const pm = new ProjectManager(projectsRoot, bundleRoot, {
  gitAutocommit: store.raw().gitAutocommit ?? process.env.GIT_AUTOCOMMIT === "true",
});
await pm.load();

const defaultProject = process.env.UNDERSTORY_PROJECT ?? DEFAULT_PROJECT_ID;
const server = await buildMcpServer(pm, store, undefined, defaultProject);
await server.connect(new StdioServerTransport());
// stdio transport keeps the process alive; logs must go to stderr only.
console.error(
  `[understory] serving projects [${pm.list().map((p) => p.id).join(", ")}] over stdio (default: ${defaultProject})`
);
