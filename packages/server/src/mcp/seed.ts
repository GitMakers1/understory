import { DEFAULT_PROMPTS, renderTemplate, SEED_DEFAULTS } from "@understory/core";
import type { KnowledgeBase, TreeNode } from "@understory/core";

export interface SeedOptions {
  maxChars?: number;
  maxDescriptionsPerSegment?: number;
}

/**
 * Seed memory: a compact overview of what the knowledge base contains,
 * loaded into the client LLM at session start (via MCP `instructions` and
 * the memory_query tool description). Without it the model has no signal
 * that memory might hold an answer, so it never thinks to look.
 *
 * Unlike the on-disk index.md (navigation: titles + links), the seed lists
 * concept DESCRIPTIONS per segment — semantic hooks beat filenames for
 * igniting the "memory might know this" instinct.
 */
export async function buildSeedMemory(kb: KnowledgeBase, opts: SeedOptions = {}): Promise<string> {
  const maxChars = opts.maxChars ?? SEED_DEFAULTS.maxChars;
  const maxDescriptions = opts.maxDescriptionsPerSegment ?? SEED_DEFAULTS.maxDescriptionsPerSegment;
  const [tree, types, log] = await Promise.all([kb.listTree(), kb.listTypes(), kb.readLog()]);

  const segments: string[] = [];
  const rootDescriptions: string[] = [];

  for (const child of tree.children ?? []) {
    if (child.kind === "directory") {
      const collected = collectConcepts(child);
      if (collected.count === 0) continue;
      const typeList = [...collected.types].sort().join(", ");
      const shown = collected.descriptions.slice(0, maxDescriptions);
      const more = collected.count - shown.length;
      segments.push(
        `* ${child.name}/ — ${collected.count} concept${collected.count === 1 ? "" : "s"}` +
          `${typeList ? ` (${typeList})` : ""}:\n` +
          shown.map((d) => `    * ${d}`).join("\n") +
          (more > 0 ? `\n    * …and ${more} more` : "")
      );
    } else if (child.kind === "concept") {
      rootDescriptions.push(child.description ?? child.title ?? child.name);
    }
  }
  if (rootDescriptions.length > 0) {
    segments.push(
      `* (root) — ${rootDescriptions.length} concept${rootDescriptions.length === 1 ? "" : "s"}:\n` +
        rootDescriptions.map((d) => `    * ${d}`).join("\n")
    );
  }

  const recent = log.slice(0, 3).map((e) => `- ${e.date} ${e.action}: ${e.summary}`);

  const sections = [
    `Concept types in use: ${types.join(", ") || "(none yet)"}`,
    `Memory segments:\n${segments.join("\n") || "(empty — nothing stored yet)"}`,
  ];
  if (recent.length > 0) sections.push(`Recent activity:\n${recent.join("\n")}`);

  let seed = sections.join("\n\n");
  if (seed.length > maxChars) {
    seed =
      seed.slice(0, maxChars) +
      "\n… (truncated — use memory_query to explore further)";
  }
  return seed;
}

/** Recursively gather concept descriptions (falling back to title/filename) and types. */
function collectConcepts(node: TreeNode): {
  count: number;
  types: Set<string>;
  descriptions: string[];
} {
  const out = { count: 0, types: new Set<string>(), descriptions: [] as string[] };
  for (const child of node.children ?? []) {
    if (child.kind === "directory") {
      const nested = collectConcepts(child);
      out.count += nested.count;
      nested.types.forEach((t) => out.types.add(t));
      out.descriptions.push(...nested.descriptions);
    } else if (child.kind === "concept") {
      out.count++;
      if (child.type) out.types.add(child.type);
      out.descriptions.push(child.description ?? child.title ?? child.name);
    }
  }
  return out;
}

/** The initialize `instructions` block — seed plus the instinct-igniting rules. */
export function seedInstructions(seed: string, template?: string): string {
  return renderTemplate(template ?? DEFAULT_PROMPTS.seedInstructions, { SEED: seed });
}
