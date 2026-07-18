import { useEffect, useMemo, useState } from "react";
import {
  api,
  type AgentSettings,
  type PromptSettings,
  type SeedSettings,
  type SettingsResponse,
  type UnderstorySettings,
} from "../api";

const PROVIDERS = ["", "anthropic", "openrouter", "llamacpp", "local"] as const;

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

const SECRET_FIELDS = [
  { key: "anthropicApiKey", label: "Anthropic API key" },
  { key: "openrouterApiKey", label: "OpenRouter API key" },
  { key: "llamacppApiKey", label: "llama.cpp API key" },
  { key: "localApiKey", label: "Local API key" },
] as const;

export function SettingsPanel() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<UnderstorySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [openPrompt, setOpenPrompt] = useState<keyof PromptSettings | null>(null);

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
      const res = await api.saveSettings(draft);
      setData({ ...data, settings: res.settings });
      setDraft(structuredClone(res.settings));
      setStatus({ kind: "ok", text: "Saved — applies to the next agent run, no restart needed." });
    } catch (e) {
      setStatus({ kind: "err", text: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const set = <S extends keyof UnderstorySettings>(
    section: S,
    key: string,
    value: unknown
  ) =>
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

      {/* ── LLM provider ── */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold text-cyan-300">LLM provider</h3>
        <p className="text-xs text-zinc-500">
          Empty = server environment default (currently{" "}
          <code className="text-zinc-300">{data.env.provider}</code> /{" "}
          <code className="text-zinc-300">{data.env.model}</code>). Changes apply to the next agent
          run.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-zinc-400">
            Provider
            <select
              value={draft.llm.provider ?? ""}
              onChange={(e) => set("llm", "provider", e.target.value || null)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-cyan-600"
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p === "" ? `(env default: ${data.env.provider})` : p}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-zinc-400">
            Model id
            <input
              value={draft.llm.model ?? ""}
              placeholder="(auto / provider default)"
              onChange={(e) => set("llm", "model", e.target.value || null)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm outline-none focus:border-cyan-600"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            llama.cpp base URL
            <input
              value={draft.llm.llamacppBaseUrl ?? ""}
              placeholder="(env LLAMACPP_BASE_URL)"
              onChange={(e) => set("llm", "llamacppBaseUrl", e.target.value || null)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm outline-none focus:border-cyan-600"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Local (OpenAI-compat) base URL
            <input
              value={draft.llm.localBaseUrl ?? ""}
              placeholder="(env LOCAL_BASE_URL)"
              onChange={(e) => set("llm", "localBaseUrl", e.target.value || null)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm outline-none focus:border-cyan-600"
            />
          </label>
          {SECRET_FIELDS.map(({ key, label }) => (
            <label key={key} className="block text-xs text-zinc-400">
              {label}
              <input
                type="password"
                value={draft.llm[key] === data.secretSentinel ? "" : draft.llm[key] ?? ""}
                placeholder={
                  data.settings.llm[key] === data.secretSentinel ? "•••••• (stored)" : "(not set)"
                }
                onChange={(e) => set("llm", key, e.target.value || null)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm outline-none focus:border-cyan-600"
              />
            </label>
          ))}
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
            checked={draft.gitAutocommit ?? data.env.gitAutocommit}
            onChange={(e) => set("gitAutocommit", "", e.target.checked) /* section is scalar */}
            className="accent-cyan-600"
          />
          Git autocommit after every mutation (needs git repo in bundle; applies on next boot)
          {draft.gitAutocommit === null && (
            <span className="text-zinc-600">(env default: {String(data.env.gitAutocommit)})</span>
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
          <code className="text-zinc-300">{data.boot.authEnabled ? "bearer token" : "disabled"}</code>{" "}
          · Providers with env credentials:{" "}
          <code className="text-zinc-300">
            {data.env.providersWithCredentials.join(", ") || "(none)"}
          </code>
        </p>
        <p>Set via environment (BUNDLE_ROOT / PORT / AUTH_TOKEN) — change requires restart.</p>
      </section>
    </div>
  );
}
