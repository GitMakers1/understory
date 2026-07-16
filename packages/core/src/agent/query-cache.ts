import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { KnowledgeBase } from "../okf/index.js";
import { parseDuration } from "../util/duration.js";
import { runQuery, type AgentOptions, type QueryResult } from "./agent.js";

export interface CachedQueryResult extends QueryResult {
  /** True when the answer came from the cache (no agent run, no trace). */
  cached: boolean;
}

const MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 24 * 3_600_000;

interface CacheEntry {
  expiresAt: number;
  result: QueryResult;
}

// Module-level so the cache survives the per-request McpServer instances of
// the stateless HTTP transport.
const cache = new Map<string, CacheEntry>();

/**
 * Content fingerprint of the bundle: path + mtime + size of every concept
 * file. Any write moves the fingerprint, which implicitly invalidates every
 * cached answer — no hooks into the write path needed.
 */
export async function bundleFingerprint(kb: KnowledgeBase): Promise<string> {
  const paths = await kb.bundle.listConceptPaths();
  const parts = await Promise.all(
    paths.map(async (p) => {
      try {
        const st = await fs.stat(kb.bundle.resolve(p));
        return `${p}:${st.mtimeMs}:${st.size}`;
      } catch {
        return `${p}:gone`;
      }
    })
  );
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * runQuery with a fingerprint-invalidated LRU cache (issue-adjacent: repeated
 * questions are common through MCP, and local models make every agent run
 * expensive). Disabled with QUERY_CACHE=false; TTL via QUERY_CACHE_TTL
 * (e.g. "1h", default 24h). Cache hits skip the agent entirely, so they
 * record no trace.
 */
export async function runQueryCached(
  kb: KnowledgeBase,
  question: string,
  options: AgentOptions = {},
  // Injectable for tests.
  runner: typeof runQuery = runQuery
): Promise<CachedQueryResult> {
  if (process.env.QUERY_CACHE === "false") {
    return { ...(await runner(kb, question, options)), cached: false };
  }

  const fingerprint = await bundleFingerprint(kb);
  const key = createHash("sha256")
    .update(`${fingerprint}\n${normalize(question)}\n${options.model ?? ""}`)
    .digest("hex");

  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    // Refresh recency (Map preserves insertion order — delete + set = LRU touch).
    cache.delete(key);
    cache.set(key, hit);
    return { ...hit.result, cached: true };
  }

  const result = await runner(kb, question, options);
  const ttl = parseDuration(process.env.QUERY_CACHE_TTL) ?? DEFAULT_TTL_MS;
  cache.set(key, { expiresAt: Date.now() + ttl, result });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return { ...result, cached: false };
}

/** Test hook: reset module-level cache state. */
export function clearQueryCache(): void {
  cache.clear();
}

function normalize(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}
