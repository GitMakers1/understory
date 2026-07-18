import express, { type Router } from "express";
import {
  AGENT_DEFAULTS,
  SEED_DEFAULTS,
  DEFAULT_PROMPTS,
  resolveModelConfig,
  resolveFallbackConfig,
  discoverLlamaCppModel,
  type SettingsStore,
  type UnderstorySettings,
} from "@understory/core";

const SECRET_KEYS = [
  "apiKey",
  "fallbackApiKey",
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
 * shipped defaults, resolved effective values, and boot-only info; PUT
 * deep-merges a patch, persists it under <bundle>/.understory/settings.json,
 * and applies live — the next agent run picks it up, no restart (except
 * dream/cache knobs, which apply on boot).
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

    // Resolve what the NEXT agent run will actually use: overrides > env >
    // built-ins — including the live auto-discovered model id, so the UI
    // shows real values instead of "(auto)".
    const effEnv = store.effectiveEnv();
    let primary: { baseURL: string; format: string; model: string } | null = null;
    let fallback: { baseURL: string; format: string; model: string } | null = null;
    let modelAutoDiscovered = false;
    let configError: string | null = null;
    try {
      const cfg = resolveModelConfig(effEnv);
      let model = cfg.model;
      if (!model && cfg.format === "openai") {
        try {
          model = await discoverLlamaCppModel(cfg.baseURL);
          modelAutoDiscovered = true;
        } catch (err) {
          model = `(discovery failed: ${(err as Error).message})`;
        }
      }
      primary = { baseURL: cfg.baseURL, format: cfg.format, model };
      const fb = resolveFallbackConfig(effEnv);
      if (fb) fallback = { baseURL: fb.baseURL, format: fb.format, model: fb.model || "(auto)" };
    } catch (err) {
      configError = (err as Error).message;
    }

    const raw = store.raw();
    res.json({
      settings: redacted(raw),
      defaults: {
        agent: AGENT_DEFAULTS,
        seed: SEED_DEFAULTS,
        prompts: DEFAULT_PROMPTS,
      },
      effective: {
        primary,
        fallback,
        modelAutoDiscovered,
        configError,
        legacyProvider: effEnv.LLM_PROVIDER ?? null,
        maxSteps: store.agentValue("maxSteps"),
        mutationTemperature: store.agentValue("mutationTemperature"),
        searchLimit: store.agentValue("searchLimit"),
        maxTraces: store.agentValue("maxTraces"),
        seedMaxChars: store.seedValue("maxChars"),
        seedMaxDescriptionsPerSegment: store.seedValue("maxDescriptionsPerSegment"),
        gitAutocommit: raw.gitAutocommit ?? process.env.GIT_AUTOCOMMIT === "true",
        dreamInterval: raw.dream.interval ?? process.env.DREAM_INTERVAL ?? null,
        dreamInsights: raw.dream.insights ?? process.env.DREAM_INSIGHTS !== "false",
        queryCache: raw.cache.queryCache ?? process.env.QUERY_CACHE !== "false",
        queryCacheTtl: raw.cache.queryCacheTtl ?? process.env.QUERY_CACHE_TTL ?? "24h",
        hotMemory: raw.cache.hotMemory ?? process.env.HOT_MEMORY !== "false",
        hotMemoryTtl: raw.cache.hotMemoryTtl ?? process.env.HOT_MEMORY_TTL ?? "1h",
        keysFromEnv: {
          api: Boolean(process.env.LLM_API_KEY),
          fallback: Boolean(process.env.LLM_FALLBACK_API_KEY),
          anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
          openrouter: Boolean(process.env.OPENROUTER_API_KEY),
          llamacpp: Boolean(process.env.LLAMACPP_API_KEY),
          local: Boolean(process.env.LOCAL_API_KEY),
        },
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

const DURATION_RE = /^\d+(ms|s|m|h|d)$/;

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
    const valid = ["anthropic", "openrouter", "llamacpp", "deepseek", "local"];
    if (!valid.includes(patch.llm.provider)) {
      return `llm.provider must be one of ${valid.join("|")} (or null for env default)`;
    }
  }
  for (const fmtKey of ["apiFormat", "fallbackFormat"] as const) {
    const v = patch.llm?.[fmtKey];
    if (v != null && v !== "openai" && v !== "anthropic") {
      return `llm.${fmtKey} must be "openai" or "anthropic" (or null)`;
    }
  }
  const d = patch.dream;
  if (d?.interval != null && d.interval !== "" && !DURATION_RE.test(d.interval)) {
    return 'dream.interval must look like "6h", "30m", "1d" (or null to disable)';
  }
  const c = patch.cache;
  if (c) {
    for (const k of ["queryCacheTtl", "hotMemoryTtl"] as const) {
      const v = c[k];
      if (v != null && v !== "" && !DURATION_RE.test(v)) {
        return `cache.${k} must look like "24h", "30m" (or null for default)`;
      }
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
