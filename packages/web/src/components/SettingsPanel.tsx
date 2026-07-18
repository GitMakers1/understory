import { useEffect, useMemo, useState } from "react";
import {
  api,
  type AgentSettings,
  type PromptSettings,
  type SeedSettings,
  type SettingsResponse,
  type UnderstorySettings,
} from "../api";

const LEGACY_PROVIDERS = ["", "anthropic", "openrouter", "llamacpp", "deepseek", "local"] as const;
const FORMATS = ["", "openai", "anthropic"] as const;

const PROMPT_LABELS: Record<keyof PromptSettings, { title: string; hint: string }> = {
  system: {
    title: "System prompt",
    hint: "Core Knowledge Keeper prompt. Placeholders: {{TYPES}} {{TREE}} {{MODE_SECTION}}",
  },
  modeQuery: { title: "Mode: query", hint: "Appended for read-only questions" },
  modeMutate: { title: "Mode: mutate", hint: "Appended for memory_add / memory_update runs" },
  modeChat: { title: "Mode: chat", hint: "Appended for interactive web chat" },
  addWrapper: {
    title: "memory_add wrapper",
    hint: "Wraps incoming knowledge. Placeholders: {{CONTENT}} {{PATH_HINT}}",
  },
  maintainWrapper: {
    title: "memory_maintain wrapper",
    hint: "Graph-repair instruction. Placeholders: {{ORPHANS}} {{BROKEN}}",
  },
  seedInstructions: {
    title: "MCP session instructions",
    hint: "Injected at MCP session start. Placeholder: {{SEED}}",
  },
};

const AGENT_FIELDS: { key: keyof AgentSettings; label: string; step?: string }[] = [
  { key: "maxSteps", label: "Max agent steps per run" },
  { key: "mutationTemperature", label: "Mutation temperature", step: "0.1" },
  { key: "searchLimit", label: "Search result limit" },
  { key: "maxTraces", label: "Trace files kept" },
];

const SEED_FIELDS: { key: keyof SeedSettings; label: string }[] = [
  { key: "maxChars", label: "Seed overview max chars" },
  { key: "maxDescriptionsPerSegment", label: "Descriptions per segment" },
];

export function SettingsPanel() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<UnderstorySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [openPrompt, setOpenPrompt] = useState<keyof PromptSettings | null>(null);
  const [showLegacy, setShowLegacy] = useState(false);

  const load = () =>
    api
      .settings()
      .then((r) => {
        setData(r);
        setDraft(structuredClone(r.settings));
      })
      .catch((e) => setStatus({ kind: "err", text: String(e) }));

  useEffect(() => {
    load();
  }, []);

  const dirty = useMemo(
    () => data && draft && JSON.stringify(draft) !== JSON.stringify(data.settings),
    [data, draft]
  );

  if (!data || !draft) {
    return <p className="p-6 text-sm text-zinc-500">{status?.text ?? "Loading settings…"}</p>;
  }

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await api.saveSettings(draft);
      await load(); // re-resolve effective values (model discovery, fallback)
      setStatus({ kind: "ok", text: "Saved — LLM/agent/prompt changes apply to the next run; dream & cache knobs apply after restart." });
    } catch (e) {
      setStatus({ kind: "err", text: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const set = <S extends keyof UnderstorySettings>(section: S, key: string, value: unknown) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            [section]:
              typeof d[section] === "object" && d[section] !== null
                ? { ...(d[section] as object), [key]: value }
                : value,
          }
        : d
    );

  const text = (
    section: "llm" | "dream" | "cache",
    key: string,
    value: string | null,
    placeholder: string,
    password = false
  ) => (
    <input
      type={password ? "password" : "text"}
      value={value === data.secretSentinel ? "" : value ?? ""}
      placeholder={placeholder}
      onChange={(e) => set(section, key, e.target.value || null)}
      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm outline-none focus:border-cyan-600"
    />
  );

  const numInput = (
    section: "agent" | "seed",
    key: string,
    current: number | null,
    fallback: number,
    step?: string
  ) => (
    <input
      type="number"
      step={step ?? "1"}
      value={current ?? ""}
      placeholder={String(fallback)}
      onChange={(e) => set(section, key, e.target.value === "" ? null : Number(e.target.value))}
      className="w-28 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm outline-none focus:border-cyan-600"
    />
  );

  const triToggle = (
    section: "dream" | "cache",
    key: string,
    current: boolean | null,
    effectiveVal: boolean,
    label: string
  ) => (
    <label className="flex items-center gap-2 text-xs text-zinc-400">
      <input
        type="checkbox"
        checked={current ?? effectiveVal}
        onChange={(e) => set(section, key, e.target.checked)}
        className="accent-cyan-600"
      />
      {label}
      {current === null && <span className="text-zinc-600">(default: {String(effectiveVal)})</span>}
    </label>
  );

  const eff = data.effective;

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-zinc-100">Settings</h2>
        <span className="text-xs text-zinc-500">
          persisted in <code>{data.boot.bundleRoot}/.understory/settings.json</code>
        </span>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className={`ml-auto rounded-lg px-4 py-1.5 text-sm font-medium ${
            dirty
              ? "bg-cyan-700 text-white hover:bg-cyan-600"
              : "cursor-default bg-zinc-800 text-zinc-500"
          }`}
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>
      {status && (
        <p className={`text-sm ${status.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>
          {status.text}
        </p>
      )}

      {/* ── Effective now ── */}
      <section className="rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-4">
        <h3 className="text-sm font-semibold text-cyan-300">Effective right now</h3>
        <p className="mt-1 text-xs text-zinc-500">
          What the next agent run will actually use (overrides → env → built-in).
        </p>
        {eff.configError ? (
          <p className="mt-2 text-xs text-red-400">LLM config error: {eff.configError}</p>
        ) : (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-zinc-500">Model</dt>
            <dd className="break-all font-mono text-zinc-200">
              {eff.primary ? `${eff.primary.format} @ ${eff.primary.baseURL} → ${eff.primary.model}` : "—"}
              {eff.modelAutoDiscovered && (
                <span className="ml-2 rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                  auto-discovered
                </span>
              )}
              {eff.legacyProvider && (
                <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  via legacy {eff.legacyProvider}
                </span>
              )}
            </dd>
            <dt className="text-zinc-500">Fallback</dt>
            <dd className="break-all font-mono text-zinc-200">
              {eff.fallback
                ? `${eff.fallback.format} @ ${eff.fallback.baseURL} → ${eff.fallback.model}`
                : "(none configured)"}
            </dd>
            <dt className="text-zinc-500">Agent</dt>
            <dd className="font-mono text-zinc-200">
              {eff.maxSteps} steps · temp {eff.mutationTemperature} · search limit {eff.searchLimit} ·{" "}
              {eff.maxTraces} traces
            </dd>
            <dt className="text-zinc-500">Memory layers</dt>
            <dd className="font-mono text-zinc-200">
              query cache {eff.queryCache ? `on (${eff.queryCacheTtl})` : "off"} · hot memory{" "}
              {eff.hotMemory ? `on (${eff.hotMemoryTtl})` : "off"}
            </dd>
            <dt className="text-zinc-500">Dreaming</dt>
            <dd className="font-mono text-zinc-200">
              {eff.dreamInterval ? `every ${eff.dreamInterval}` : "disabled"} · insights{" "}
              {String(eff.dreamInsights)}
            </dd>
            <dt className="text-zinc-500">Git autocommit</dt>
            <dd className="font-mono text-zinc-200">{String(eff.gitAutocommit)}</dd>
          </dl>
        )}
      </section>

      {/* ── LLM endpoint ── */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold text-cyan-300">LLM endpoint</h3>
        <p className="text-xs text-zinc-500">
          Direct endpoint config. Empty = server env. Changes apply to the next agent run.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-zinc-400">
            Base URL
            {text("llm", "apiBaseUrl", draft.llm.apiBaseUrl, eff.primary?.baseURL ?? "(from env)")}
          </label>
          <label className="block text-xs text-zinc-400">
            Model id
            {text(
              "llm",
              "model",
              draft.llm.model,
              eff.primary ? `${eff.primary.model}${eff.modelAutoDiscovered ? " (auto)" : ""}` : "(auto)"
            )}
          </label>
          <label className="block text-xs text-zinc-400">
            API format
            <select
              value={draft.llm.apiFormat ?? ""}
              onChange={(e) => set("llm", "apiFormat", e.target.value || null)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-cyan-600"
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f === "" ? `${eff.primary?.format ?? "openai"} (default)` : f}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-zinc-400">
            API key
            {text(
              "llm",
              "apiKey",
              draft.llm.apiKey,
              data.settings.llm.apiKey === data.secretSentinel
                ? "•••••• (stored)"
                : eff.keysFromEnv.api
                  ? "•••••• (from env)"
                  : "(not set)",
              true
            )}
          </label>
        </div>

        <h4 className="pt-1 text-xs font-semibold text-zinc-300">
          Fallback model <span className="font-normal text-zinc-500">— tried when the primary errors</span>
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-zinc-400">
            Fallback base URL
            {text("llm", "fallbackBaseUrl", draft.llm.fallbackBaseUrl, eff.fallback?.baseURL ?? "(none)")}
          </label>
          <label className="block text-xs text-zinc-400">
            Fallback model id
            {text("llm", "fallbackModel", draft.llm.fallbackModel, eff.fallback?.model ?? "(auto)")}
          </label>
          <label className="block text-xs text-zinc-400">
            Fallback format
            <select
              value={draft.llm.fallbackFormat ?? ""}
              onChange={(e) => set("llm", "fallbackFormat", e.target.value || null)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-cyan-600"
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f === "" ? "openai (default)" : f}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-zinc-400">
            Fallback API key
            {text(
              "llm",
              "fallbackApiKey",
              draft.llm.fallbackApiKey,
              data.settings.llm.fallbackApiKey === data.secretSentinel
                ? "•••••• (stored)"
                : eff.keysFromEnv.fallback
                  ? "•••••• (from env)"
                  : "(not set)",
              true
            )}
          </label>
          <label className="block text-xs text-zinc-400">
            Fallback allowed for modes
            {text("llm", "fallbackAllowFor", draft.llm.fallbackAllowFor, '"*" or "query,mutate,chat"')}
          </label>
          <label className="flex items-end gap-2 pb-1 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={draft.llm.fallbackRetry429 ?? false}
              onChange={(e) => set("llm", "fallbackRetry429", e.target.checked)}
              className="accent-cyan-600"
            />
            Also fall back on 429 rate limits
          </label>
        </div>

        <button
          onClick={() => setShowLegacy(!showLegacy)}
          className="text-xs text-zinc-500 underline hover:text-zinc-300"
        >
          {showLegacy ? "Hide" : "Show"} legacy provider shorthand
        </button>
        {showLegacy && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-zinc-400">
              Legacy provider
              <select
                value={draft.llm.provider ?? ""}
                onChange={(e) => set("llm", "provider", e.target.value || null)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-cyan-600"
              >
                {LEGACY_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p === "" ? (eff.legacyProvider ? `${eff.legacyProvider} (from env)` : "(unset)") : p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-zinc-400">
              llama.cpp base URL
              {text("llm", "llamacppBaseUrl", draft.llm.llamacppBaseUrl, "(env LLAMACPP_BASE_URL)")}
            </label>
            <label className="block text-xs text-zinc-400">
              Anthropic API key
              {text("llm", "anthropicApiKey", draft.llm.anthropicApiKey,
                data.settings.llm.anthropicApiKey === data.secretSentinel ? "•••••• (stored)" : eff.keysFromEnv.anthropic ? "•••••• (from env)" : "(not set)", true)}
            </label>
            <label className="block text-xs text-zinc-400">
              OpenRouter API key
              {text("llm", "openrouterApiKey", draft.llm.openrouterApiKey,
                data.settings.llm.openrouterApiKey === data.secretSentinel ? "•••••• (stored)" : eff.keysFromEnv.openrouter ? "•••••• (from env)" : "(not set)", true)}
            </label>
          </div>
        )}
      </section>

      {/* ── Memory layers ── */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold text-cyan-300">Memory layers & dreaming</h3>
        <p className="text-xs text-zinc-500">
          Query path: exact cache → hot working set → deep agent. Dreaming = scheduled autonomous
          consolidation (orphans, broken links, duplicates, oversized concepts). These apply on
          restart.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {triToggle("cache", "queryCache", draft.cache.queryCache, eff.queryCache, "Exact query cache")}
          <label className="flex items-center justify-between gap-2 text-xs text-zinc-400">
            Cache TTL
            {text("cache", "queryCacheTtl", draft.cache.queryCacheTtl, eff.queryCacheTtl)}
          </label>
          {triToggle("cache", "hotMemory", draft.cache.hotMemory, eff.hotMemory, "Hot working-set memory")}
          <label className="flex items-center justify-between gap-2 text-xs text-zinc-400">
            Hot TTL
            {text("cache", "hotMemoryTtl", draft.cache.hotMemoryTtl, eff.hotMemoryTtl)}
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-zinc-400">
            Dream interval (e.g. 6h, empty = off)
            {text("dream", "interval", draft.dream.interval, eff.dreamInterval ?? "(disabled)")}
          </label>
          {triToggle("dream", "insights", draft.dream.insights, eff.dreamInsights, "Dream insights (abstract patterns)")}
        </div>
      </section>

      {/* ── Agent tuning ── */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold text-cyan-300">Agent</h3>
        <div className="grid grid-cols-2 gap-3">
          {AGENT_FIELDS.map(({ key, label, step }) => (
            <label key={key} className="flex items-center justify-between gap-2 text-xs text-zinc-400">
              {label}
              {numInput("agent", key, draft.agent[key], data.defaults.agent[key], step)}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {SEED_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between gap-2 text-xs text-zinc-400">
              {label}
              {numInput("seed", key, draft.seed[key], data.defaults.seed[key])}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={draft.gitAutocommit ?? eff.gitAutocommit}
            onChange={(e) => set("gitAutocommit", "", e.target.checked) /* scalar section */}
            className="accent-cyan-600"
          />
          Git autocommit after every mutation (needs git repo in bundle; applies on next boot)
          {draft.gitAutocommit === null && (
            <span className="text-zinc-600">(default: {String(eff.gitAutocommit)})</span>
          )}
        </label>
      </section>

      {/* ── Prompts ── */}
      <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold text-cyan-300">Prompts</h3>
        <p className="text-xs text-zinc-500">
          Edit any prompt the internal agent runs on. Empty box = shipped default. Keep the{" "}
          <code>{"{{PLACEHOLDERS}}"}</code> — they are filled at runtime.
        </p>
        {(Object.keys(PROMPT_LABELS) as (keyof PromptSettings)[]).map((key) => {
          const customized = draft.prompts[key] !== null;
          const open = openPrompt === key;
          return (
            <div key={key} className="rounded-lg border border-zinc-800">
              <button
                onClick={() => setOpenPrompt(open ? null : key)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-800/60"
              >
                <span className="text-zinc-200">{PROMPT_LABELS[key].title}</span>
                {customized && (
                  <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                    customized
                  </span>
                )}
                <span className="ml-auto text-xs text-zinc-600">{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="space-y-2 border-t border-zinc-800 p-3">
                  <p className="text-xs text-zinc-500">{PROMPT_LABELS[key].hint}</p>
                  <textarea
                    value={draft.prompts[key] ?? data.defaults.prompts[key]}
                    onChange={(e) => set("prompts", key, e.target.value)}
                    rows={Math.min(24, (draft.prompts[key] ?? data.defaults.prompts[key]).split("\n").length + 2)}
                    spellCheck={false}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-cyan-600"
                  />
                  {customized && (
                    <button
                      onClick={() => set("prompts", key, null)}
                      className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      Reset to default
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ── Boot-only info ── */}
      <section className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-500">
        <h3 className="text-sm font-semibold text-cyan-300">Server (boot-time, read-only)</h3>
        <p>
          Bundle root: <code className="text-zinc-300">{data.boot.bundleRoot}</code>
        </p>
        <p>
          Port: <code className="text-zinc-300">{data.boot.port}</code> · Auth:{" "}
          <code className="text-zinc-300">{data.boot.authEnabled ? "bearer token" : "disabled"}</code>
        </p>
        <p>Set via environment (BUNDLE_ROOT / PORT / AUTH_TOKEN) — change requires restart.</p>
      </section>
    </div>
  );
}
