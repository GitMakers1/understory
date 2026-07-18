import { DEFAULT_PROMPTS, renderTemplate, type PromptSettings } from "../settings.js";

export interface PromptContext {
  /** Distinct `type` values already in use in the bundle. */
  existingTypes: string[];
  /** Compact tree listing to orient the agent without a tool round-trip. */
  treeSummary: string;
  mode: "query" | "mutate" | "chat";
}

/** Resolves a prompt: override when set, shipped default otherwise. */
export type PromptResolver = (key: keyof PromptSettings) => string;

const defaultResolver: PromptResolver = (key) => DEFAULT_PROMPTS[key];

const MODE_KEY: Record<PromptContext["mode"], keyof PromptSettings> = {
  query: "modeQuery",
  mutate: "modeMutate",
  chat: "modeChat",
};

export function buildSystemPrompt(
  ctx: PromptContext,
  resolve: PromptResolver = defaultResolver
): string {
  return renderTemplate(resolve("system"), {
    TYPES: ctx.existingTypes.length
      ? ctx.existingTypes.join(", ")
      : "(none yet — you set the precedent; choose short, reusable names)",
    TREE: ctx.treeSummary || "(empty bundle)",
    MODE_SECTION: resolve(MODE_KEY[ctx.mode]),
  });
}
