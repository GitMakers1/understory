import express, { type Router } from "express";
import {
  AGENT_DEFAULTS,
  SEED_DEFAULTS,
  DEFAULT_PROMPTS,
  loadProviderConfig,
  availableProviders,
  type SettingsStore,
  type UnderstorySettings,
} from "@understory/core";

const SECRET_KEYS = [
  "llamacppApiKey",
  "localApiKey",
  "anthropicApiKey",
  "openrouterApiKey",
] as const;

/** Sentinel the UI sends to mean "leave the stored secret unchanged". */
const KEEP = "__unchanged__";

interface BootInfo {
  bundleRoot: string;
  port: number;
  authEnabled: boolean;
}

/**
 * Settings API. GET returns overrides (secrets redacted to a set-flag),
 * shipped defaults, env-derived values, and boot-only info; PUT deep-merges
 * a patch, persists it under <bundle>/.understory/settings.json, and applies
 * live — the next agent run picks it up, no restart.
 */
export function settingsRouter(store: SettingsStore, boot: BootInfo): Router {
  const router = express.Router();

  const redacted = (s: UnderstorySettings) => {
    const out = structuredClone(s);
    for (const key of SECRET_KEYS) {
      out.llm[key] = out.llm[key] ? KEEP : null;
    }
    return out;
  };

  router.get("/settings", async (_req, res) => {
    await store.load();
    const envConfig = loadProviderConfig();
    res.json({
      settings: redacted(store.raw()),
      defaults: {
        agent: AGENT_DEFAULTS,
        seed: SEED_DEFAULTS,
        prompts: DEFAULT_PROMPTS,
      },
      env: {
        provider: envConfig.provider,
        model: envConfig.model || "(auto-discovered)",
        providersWithCredentials: availableProviders(),
        gitAutocommit: process.env.GIT_AUTOCOMMIT === "true",
      },
      boot,
      secretSentinel: KEEP,
    });
  });

  router.put("/settings", async (req, res) => {
    const patch = req.body as Partial<UnderstorySettings>;
    if (!patch || typeof patch !== "object") {
      res.status(400).json({ error: "body must be a settings patch object" });
      return;
    }
    const err = validate(patch);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    // Secrets: the KEEP sentinel means "don't touch the stored value".
    if (patch.llm) {
      for (const key of SECRET_KEYS) {
        if (patch.llm[key] === KEEP) delete (patch.llm as unknown as Record<string, unknown>)[key];
      }
    }
    const updated = await store.update(patch);
    res.json({ settings: redacted(updated) });
  });

  return router;
}

function validate(patch: Partial<UnderstorySettings>): string | null {
  const a = patch.agent;
  if (a) {
    if (a.maxSteps != null && (!Number.isInteger(a.maxSteps) || a.maxSteps < 1 || a.maxSteps > 100))
      return "agent.maxSteps must be an integer 1-100";
    if (
      a.mutationTemperature != null &&
      (typeof a.mutationTemperature !== "number" ||
        a.mutationTemperature < 0 ||
        a.mutationTemperature > 2)
    )
      return "agent.mutationTemperature must be 0-2";
    if (
      a.searchLimit != null &&
      (!Number.isInteger(a.searchLimit) || a.searchLimit < 1 || a.searchLimit > 200)
    )
      return "agent.searchLimit must be an integer 1-200";
    if (
      a.maxTraces != null &&
      (!Number.isInteger(a.maxTraces) || a.maxTraces < 1 || a.maxTraces > 5000)
    )
      return "agent.maxTraces must be an integer 1-5000";
  }
  const s = patch.seed;
  if (s) {
    if (s.maxChars != null && (!Number.isInteger(s.maxChars) || s.maxChars < 200 || s.maxChars > 50000))
      return "seed.maxChars must be an integer 200-50000";
    if (
      s.maxDescriptionsPerSegment != null &&
      (!Number.isInteger(s.maxDescriptionsPerSegment) ||
        s.maxDescriptionsPerSegment < 1 ||
        s.maxDescriptionsPerSegment > 100)
    )
      return "seed.maxDescriptionsPerSegment must be an integer 1-100";
  }
  if (patch.llm?.provider != null) {
    const valid = ["anthropic", "openrouter", "llamacpp", "local"];
    if (!valid.includes(patch.llm.provider)) {
      return `llm.provider must be one of ${valid.join("|")} (or null for env default)`;
    }
  }
  if (patch.prompts) {
    for (const [k, v] of Object.entries(patch.prompts)) {
      if (v != null && typeof v !== "string") return `prompts.${k} must be a string or null`;
      if (typeof v === "string" && v.length > 100_000) return `prompts.${k} too large (100k max)`;
    }
    // A blanked-out core template would silently cripple the agent — treat
    // empty/whitespace as "reset to default" instead.
    for (const k of Object.keys(patch.prompts) as (keyof typeof patch.prompts)[]) {
      if (typeof patch.prompts[k] === "string" && patch.prompts[k]!.trim() === "") {
        patch.prompts[k] = null;
      }
    }
  }
  return null;
}
