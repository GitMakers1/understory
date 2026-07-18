import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProviderName } from "./providers/index.js";

/**
 * Runtime-editable settings, persisted as JSON under
 * `<bundle>/.understory/settings.json` (a dot-directory the OKF walkers
 * ignore, so settings travel with the memory volume but never touch
 * conformance or the graph).
 *
 * Every field is nullable: null (or absent) means "use the default" —
 * built-in constants for numbers, env vars for provider config, the
 * shipped prompt text for prompts. Only non-null overrides are written
 * to disk. Precedence at read time: settings override > env > built-in.
 */

export interface LlmSettings {
  provider: ProviderName | null;
  model: string | null;
  llamacppBaseUrl: string | null;
  llamacppApiKey: string | null;
  localBaseUrl: string | null;
  localApiKey: string | null;
  anthropicApiKey: string | null;
  openrouterApiKey: string | null;
}

export interface AgentSettings {
  /** Max tool-loop steps per agent run. */
  maxSteps: number | null;
  /** Sampling temperature for mutation runs. */
  mutationTemperature: number | null;
  /** Max hits returned by the agent's search tool. */
  searchLimit: number | null;
  /** Max persisted trace files before pruning. */
  maxTraces: number | null;
}

export interface SeedSettings {
  /** Truncation cap for the session-start memory overview. */
  maxChars: number | null;
  /** Max concept descriptions listed per directory segment. */
  maxDescriptionsPerSegment: number | null;
}

export interface PromptSettings {
  /** System prompt template. Placeholders: {{TYPES}} {{TREE}} {{MODE_SECTION}} */
  system: string | null;
  /** Mode sections appended to the system prompt. No placeholders. */
  modeQuery: string | null;
  modeMutate: string | null;
  modeChat: string | null;
  /** memory_add instruction wrapper. Placeholders: {{CONTENT}} {{PATH_HINT}} */
  addWrapper: string | null;
  /** memory_maintain instruction wrapper. Placeholders: {{ORPHANS}} {{BROKEN}} */
  maintainWrapper: string | null;
  /** MCP initialize instructions. Placeholder: {{SEED}} */
  seedInstructions: string | null;
}

export interface UnderstorySettings {
  llm: LlmSettings;
  agent: AgentSettings;
  seed: SeedSettings;
  prompts: PromptSettings;
  /** Overrides GIT_AUTOCOMMIT env when non-null. Applied on next boot. */
  gitAutocommit: boolean | null;
}

export const AGENT_DEFAULTS = {
  maxSteps: 12,
  mutationTemperature: 0.2,
  searchLimit: 20,
  maxTraces: 50,
} as const;

export const SEED_DEFAULTS = {
  maxChars: 3000,
  maxDescriptionsPerSegment: 10,
} as const;

export const DEFAULT_PROMPTS: Record<keyof PromptSettings, string> = {
  system: `You are the Knowledge Keeper — an agent that manages a knowledge base conforming to the Open Knowledge Format (OKF) v0.1 specification.

## The OKF format (what you are managing)

- The knowledge base ("bundle") is a directory tree of markdown files.
- Every concept is one .md file with YAML frontmatter. The only REQUIRED field is \`type\` (a free-form string naming the kind of thing, e.g. "BigQuery Table", "API Endpoint", "Playbook", "Decision", "How-To"). Recommended fields: \`title\`, \`description\` (one line), \`resource\` (canonical URI of the underlying asset, if any), \`tags\` (list).
- \`index.md\` and \`log.md\` are RESERVED filenames — never create concepts with those names. They are maintained automatically by the system after your writes; you never edit them.
- Cross-link related concepts with bundle-relative markdown links: \`[Customers table](/tables/customers.md)\`. Link liberally; broken links are tolerated.
- Body convention: prose first, then optional \`# Schema\`, \`# Examples\`, \`# Citations\` sections where they apply. Citations are numbered: \`[1] [Title](https://url)\`.

## Operating rules

1. SEARCH FIRST. Before adding anything, search for existing concepts the new knowledge relates to — both overlap (is this already covered?) and ownership (which existing entity does this fact belong to?).
2. ENRICH OVER CREATE. A fact that is an attribute or detail of an existing concept gets patched INTO that concept (read it first, then extend its body or a fitting section) — not filed as its own concept. Create a new concept only when the knowledge is a distinct entity or topic someone would look up on its own, or is substantial enough that embedding it would dominate the host concept.
3. LINK BOTH WAYS. A new concept must be wired into the graph, not dropped in isolation: link it to related concepts, AND patch those related concepts to reference it back where the relationship genuinely matters (an owning entity should mention what it owns). An unlinked concept is invisible knowledge.
4. REUSE TYPES. Prefer a type already in use over inventing a synonym. Types currently in the bundle: {{TYPES}}.
5. PLACE DELIBERATELY. Choose directories by subject area (e.g. /tables/, /apis/, /playbooks/, /decisions/). Reuse existing directories when they fit; create new ones only for genuinely new areas. Filenames: short kebab-case, .md extension.
6. WRITE FOR THE NEXT READER. Frontmatter \`description\` is one crisp line. Bodies are concise, factual, and self-contained — a reader landing on one file with no other context should understand it.
7. PREFER PATCH OVER REWRITE. For small changes to an existing concept, use patch_concept (frontmatter merge or single-section replace) instead of rewriting the whole file with write_concept.
8. DEPRECATE, DON'T DELETE. Prefer tagging a concept \`deprecated\` (and saying why in the body) over delete_concept. Delete only when the content is wrong/harmful or the user explicitly asks.
9. LOG SUMMARIES. Every mutation tool takes a log_summary — one past-tense sentence describing the change, with bundle-relative links to the concepts touched, e.g. "Added [Billing API](/apis/billing-api.md) covering charge endpoints."
10. CITE WHEN ANSWERING. When answering questions, ground every claim in concepts you actually read, and list their bundle paths. If the knowledge base doesn't contain the answer, say so plainly — never invent knowledge.

## Current bundle layout

{{TREE}}

{{MODE_SECTION}}`,

  modeQuery: `## Your task mode: QUERY (read-only)

Answer the user's question from the knowledge base. Search, read the relevant concepts, then answer. End your answer with a "Sources:" line listing the bundle paths you used.

RETRIEVAL PROTOCOL — search is keyword-based, not semantic, so one empty search proves nothing:
1. Search with the question's key terms.
2. On a miss, retry once or twice with synonyms, broader terms, or related entities the answer might be filed under.
3. Still nothing? Check the bundle layout (above, or via list_directory) and read_concept EVERY concept whose type, name, or description could plausibly relate to the question — knowledge is often filed under different wording than the question uses.
4. Only after steps 1-3 may you answer that the knowledge base has no coverage; then suggest what concept could be added.`,

  modeMutate: `## Your task mode: MUTATE

The input is knowledge to persist or a change to apply to the knowledge base — NOT a message to reply to. Do not respond conversationally and do not just acknowledge it. You MUST act with the write tools.

WRITE PROTOCOL:
1. Search for concepts the knowledge relates to or belongs to; read the strongest candidates.
2. CHECK FOR CONTRADICTION. If the new knowledge conflicts with what an existing concept currently asserts (e.g. a changed address, a corrected number, a reversed decision), do NOT leave both claims standing and do NOT silently drop the old one. Update to the new value and make the change explicit — state that it supersedes the prior value (briefly noting what it was). A concept must never assert two contradictory facts at once. MECHANICALLY: the old statement must no longer appear anywhere in the concept. If it sits in the concept's prose (not a cleanly isolated section you can target), read the concept and use patch_concept's replace_body to rewrite the WHOLE body — never append a new section that leaves the stale statement standing above it.
3. Decide: ENRICH or CREATE (rule 2). An attribute or detail of an existing entity is patched into that entity's concept. Only a distinct, stand-alone entity or substantial topic gets its own concept.
4. If enriching: patch_concept the owning concept.
5. If creating: write_concept in a fitting directory (create the directory if none fits), then LINK BOTH WAYS (rule 3) — patch each genuinely related existing concept to reference the new one.

Even a single standalone fact must be recorded. The only case where you write nothing is if the exact knowledge already exists verbatim — then say so and name the concept.

When done, summarize exactly what changed: every file created, updated, or deleted, with its bundle path.`,

  modeChat: `## Your task mode: CHAT

You are in an interactive session with a human testing the knowledge base. You may both answer questions and make changes when asked. Narrate what you're doing briefly. Always state which files you touched or read.

When answering a question, follow the retrieval protocol — search is keyword-based, not semantic, so one empty search proves nothing: retry with synonyms, then check the bundle layout and read_concept any plausibly related concept; knowledge is often filed under different wording than the question uses. Only declare "not found" after that.`,

  addWrapper: `Persist the following knowledge into the knowledge base. First search for related or owning concepts. If this is an attribute or detail of an existing concept, patch it into that concept rather than creating a new one. Only a distinct stand-alone entity or substantial topic gets its own concept — and then you must also patch the related existing concepts to link back to it. This is content to store, not a message to answer — you must use the write tools.

KNOWLEDGE TO RECORD:
{{CONTENT}}{{PATH_HINT}}`,

  maintainWrapper: `Repair the knowledge graph. This is a maintenance task — use the write tools.

ORPHANED CONCEPTS (no other concept links to them). For each, read it and the concepts it relates to, then wire it in: patch a genuinely related concept to reference it, and/or add outbound links from it to related concepts. Do NOT invent relationships that don't exist — if an orphan genuinely relates to nothing, leave it.
{{ORPHANS}}

BROKEN LINKS (target does not exist). Fix the path if the target was renamed/moved, or remove the link if the target is gone.
{{BROKEN}}

Follow the enrich / link-both-ways rules. Read concepts before editing.`,

  seedInstructions: `This server is your persistent memory — an OKF knowledge base of markdown concepts that survives across sessions.

MEMORY OVERVIEW (as of session start):

{{SEED}}

How to use your memory:
- BEFORE answering anything related to the topics above, call memory_query — the answer may already be stored. Prefer stored knowledge over guessing.
- When you learn a lasting fact, decision, preference, or piece of documentation, persist it with memory_add. If it isn't stored, it will be forgotten.
- When existing knowledge turns out to be wrong or outdated, fix it with memory_update.
- memory_status reports size and health of the memory.`,
};

export function emptySettings(): UnderstorySettings {
  return {
    llm: {
      provider: null,
      model: null,
      llamacppBaseUrl: null,
      llamacppApiKey: null,
      localBaseUrl: null,
      localApiKey: null,
      anthropicApiKey: null,
      openrouterApiKey: null,
    },
    agent: { maxSteps: null, mutationTemperature: null, searchLimit: null, maxTraces: null },
    seed: { maxChars: null, maxDescriptionsPerSegment: null },
    prompts: {
      system: null,
      modeQuery: null,
      modeMutate: null,
      modeChat: null,
      addWrapper: null,
      maintainWrapper: null,
      seedInstructions: null,
    },
    gitAutocommit: null,
  };
}

/** Fill {{PLACEHOLDER}} slots in a prompt template. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

const SETTINGS_DIR = ".understory";
const SETTINGS_FILE = "settings.json";

/**
 * Loads, merges, persists and resolves settings. One instance per process,
 * shared by the server routes and every agent run, so a PUT /api/settings
 * applies to the very next agent call without a restart.
 */
export class SettingsStore {
  private readonly file: string;
  private settings: UnderstorySettings = emptySettings();
  private loaded = false;

  constructor(bundleRoot: string) {
    this.file = path.join(path.resolve(bundleRoot), SETTINGS_DIR, SETTINGS_FILE);
  }

  async load(): Promise<UnderstorySettings> {
    if (this.loaded) return this.settings;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf-8"));
      this.settings = mergeSettings(emptySettings(), raw);
    } catch {
      this.settings = emptySettings(); // no file yet / unreadable → all defaults
    }
    this.loaded = true;
    return this.settings;
  }

  /** Current overrides (nulls where defaults apply). Call load() first. */
  raw(): UnderstorySettings {
    return this.settings;
  }

  /** Deep-merge a partial patch (explicit null clears an override) and persist. */
  async update(patch: Partial<UnderstorySettings>): Promise<UnderstorySettings> {
    await this.load();
    this.settings = mergeSettings(this.settings, patch);
    const dir = path.dirname(this.file);
    await fs.mkdir(dir, { recursive: true });
    const tmp = this.file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(this.settings, null, 2), "utf-8");
    await fs.rename(tmp, this.file);
    return this.settings;
  }

  // ── Resolved values (override > env > built-in default) ─────────────

  agentValue<K extends keyof AgentSettings>(key: K): number {
    return this.settings.agent[key] ?? AGENT_DEFAULTS[key];
  }

  seedValue<K extends keyof SeedSettings>(key: K): number {
    return this.settings.seed[key] ?? SEED_DEFAULTS[key];
  }

  prompt(key: keyof PromptSettings): string {
    return this.settings.prompts[key] ?? DEFAULT_PROMPTS[key];
  }

  /**
   * Env for the provider layer with LLM overrides applied — resolveModel()
   * already accepts an env object, so settings slot in without touching it.
   */
  effectiveEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const l = this.settings.llm;
    const env: NodeJS.ProcessEnv = { ...base };
    if (l.provider) env.LLM_PROVIDER = l.provider;
    if (l.model) env.LLM_MODEL = l.model;
    if (l.llamacppBaseUrl) env.LLAMACPP_BASE_URL = l.llamacppBaseUrl;
    if (l.llamacppApiKey) env.LLAMACPP_API_KEY = l.llamacppApiKey;
    if (l.localBaseUrl) env.LOCAL_BASE_URL = l.localBaseUrl;
    if (l.localApiKey) env.LOCAL_API_KEY = l.localApiKey;
    if (l.anthropicApiKey) env.ANTHROPIC_API_KEY = l.anthropicApiKey;
    if (l.openrouterApiKey) env.OPENROUTER_API_KEY = l.openrouterApiKey;
    return env;
  }
}

/** Deep-merge for the fixed two-level settings shape. Explicit null wins (clears). */
function mergeSettings(
  base: UnderstorySettings,
  patch: Partial<UnderstorySettings> | Record<string, unknown>
): UnderstorySettings {
  const out = structuredClone(base);
  const p = patch as Partial<UnderstorySettings>;
  for (const section of ["llm", "agent", "seed", "prompts"] as const) {
    const src = p[section];
    if (!src || typeof src !== "object") continue;
    const dst = out[section] as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(src)) {
      if (!(k in dst)) continue; // ignore unknown keys
      if (v === undefined) continue;
      dst[k] = v; // null clears, value overrides
    }
  }
  if (p.gitAutocommit !== undefined) out.gitAutocommit = p.gitAutocommit;
  return out;
}
