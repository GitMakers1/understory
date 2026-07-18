import { generateText, streamText, stepCountIs, type LanguageModel, type ModelMessage } from "ai";
import type { KnowledgeBase } from "../okf/index.js";
import {
  createModel,
  resolveFallbackConfig,
  resolveModelConfig,
  type ModelConfig,
} from "../providers/index.js";
import { withFallback } from "../providers/fallback.js";
import { AGENT_DEFAULTS, type SettingsStore } from "../settings.js";
import { buildSystemPrompt, type PromptResolver } from "./system-prompt.js";
import { buildReadTools, buildWriteTools, formatTree } from "./tools.js";
import { TraceRecorder, TraceStore } from "./trace.js";

export interface AgentOptions {
  model?: string;
  /** Live settings (steps, temperature, prompts, LLM overrides). */
  settings?: SettingsStore;
}

export interface QueryResult {
  answer: string;
  steps: number;
  traceId: string;
}

export interface MutationResult {
  summary: string;
  filesChanged: string[];
  steps: number;
  traceId: string;
}

export type MutationOutcome =
  | { ok: true; result: MutationResult }
  | { ok: false; status: "partial"; filesChanged: string[]; error: string; traceId: string }
  | { ok: false; status: "failed"; error: string };

interface ResolvedAgentModel {
  model: LanguageModel;
  modelChain: string[];
}

async function promptContext(kb: KnowledgeBase, mode: "query" | "mutate" | "chat") {
  const [types, tree] = await Promise.all([kb.listTypes(), kb.listTree()]);
  return { existingTypes: types, treeSummary: formatTree(tree), mode };
}

/** Per-run knobs resolved once: settings override > env > built-in. */
interface RunConfig {
  env: NodeJS.ProcessEnv;
  maxSteps: number;
  mutationTemperature: number;
  searchLimit: number;
  promptResolver: PromptResolver | undefined;
  traces: TraceStore;
}

async function runConfig(kb: KnowledgeBase, options: AgentOptions): Promise<RunConfig> {
  const s = options.settings;
  if (s) await s.load();
  return {
    env: s?.effectiveEnv() ?? process.env,
    maxSteps: s?.agentValue("maxSteps") ?? AGENT_DEFAULTS.maxSteps,
    mutationTemperature:
      s?.agentValue("mutationTemperature") ?? AGENT_DEFAULTS.mutationTemperature,
    searchLimit: s?.agentValue("searchLimit") ?? AGENT_DEFAULTS.searchLimit,
    promptResolver: s ? (key) => s.prompt(key) : undefined,
    traces: new TraceStore(kb.bundle.root, s?.agentValue("maxTraces") ?? AGENT_DEFAULTS.maxTraces),
  };
}

async function resolveAgentModel(
  options: AgentOptions,
  mode: "query" | "mutate" | "chat",
  env: NodeJS.ProcessEnv
): Promise<ResolvedAgentModel> {
  const primaryConfig = withModelOverride(resolveModelConfig(env), options.model);
  const primary = await createModel(primaryConfig);
  const fallbackConfig = resolveFallbackConfig(env);

  if (!fallbackConfig) {
    return { model: primary, modelChain: [modelLabel(primaryConfig)] };
  }

  const allowFor = resolveAllowFor(env.LLM_FALLBACK_ALLOW_FOR);
  if (allowFor && !allowFor.has(mode)) {
    return { model: primary, modelChain: [modelLabel(primaryConfig)] };
  }

  const fallback = await createModel(fallbackConfig);
  return {
    model: withFallback(primary, fallback, {
      retry429: env.LLM_FALLBACK_RETRY_429 === "true",
    }),
    modelChain: [modelLabel(primaryConfig), modelLabel(fallbackConfig)],
  };
}

function resolveAllowFor(raw: string | undefined): Set<string> | null {
  if (!raw || raw === "*") return null;
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

function withModelOverride(config: ModelConfig, model: string | undefined): ModelConfig {
  return model ? { ...config, model } : config;
}

// No baseURL here by design: traces persist under <bundle>/.traces/, and a
// published bundle would otherwise leak internal hostnames/IPs/ports.
function modelLabel(config: ModelConfig): string {
  return `${config.format}:${config.model || "auto"}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read-only Q&A over the bundle. */
export async function runQuery(
  kb: KnowledgeBase,
  question: string,
  options: AgentOptions = {}
): Promise<QueryResult> {
  const [ctx, run] = await Promise.all([promptContext(kb, "query"), runConfig(kb, options)]);
  const recorder = new TraceRecorder();
  let modelChain: string[] = [];
  try {
    const resolved = await resolveAgentModel(options, "query", run.env);
    modelChain = resolved.modelChain;
    const result = await generateText({
      model: resolved.model,
      system: buildSystemPrompt(ctx, run.promptResolver),
      prompt: question,
      tools: buildReadTools(kb, recorder, run.searchLimit),
      stopWhen: stepCountIs(run.maxSteps),
    });
    const trace = recorder.finalize("query", question, result.text, "success", modelChain);
    await run.traces.save(trace);
    return { answer: result.text, steps: result.steps.length, traceId: trace.id };
  } catch (err) {
    const trace = recorder.finalize("query", question, errorMessage(err), "failed", modelChain);
    await run.traces.save(trace);
    throw err;
  }
}

/** Knowledge add/update — full toolset, low temperature. */
export async function runMutation(
  kb: KnowledgeBase,
  instruction: string,
  options: AgentOptions = {}
): Promise<MutationOutcome> {
  const [ctx, run] = await Promise.all([promptContext(kb, "mutate"), runConfig(kb, options)]);
  const recorder = new TraceRecorder();
  const filesChanged = new Set<string>();
  let modelChain: string[] = [];
  try {
    const resolved = await resolveAgentModel(options, "mutate", run.env);
    modelChain = resolved.modelChain;
    const result = await generateText({
      model: resolved.model,
      system: buildSystemPrompt(ctx, run.promptResolver),
      prompt: instruction,
      tools: {
        ...buildReadTools(kb, recorder, run.searchLimit),
        ...buildWriteTools(kb, filesChanged, recorder),
      },
      stopWhen: stepCountIs(run.maxSteps),
      temperature: run.mutationTemperature,
    });
    const trace = recorder.finalize("mutation", instruction, result.text, "success", modelChain);
    await run.traces.save(trace);
    return {
      ok: true,
      result: {
        summary: result.text,
        filesChanged: [...filesChanged].sort(),
        steps: result.steps.length,
        traceId: trace.id,
      },
    };
  } catch (err) {
    const files = [...filesChanged].sort();
    const message = errorMessage(err);
    if (files.length > 0) {
      const summary = `Partial mutation: ${files.length} file(s) changed before failure. Error: ${message}`;
      const trace = recorder.finalize("mutation", instruction, summary, "partial", modelChain);
      await run.traces.save(trace);
      return { ok: false, status: "partial", filesChanged: files, error: message, traceId: trace.id };
    }
    const trace = recorder.finalize("mutation", instruction, message, "failed", modelChain);
    await run.traces.save(trace);
    return { ok: false, status: "failed", error: message };
  }
}

/** Interactive chat — full toolset, streaming. Caller converts to a UI stream response. */
export async function streamChat(
  kb: KnowledgeBase,
  messages: ModelMessage[],
  options: AgentOptions = {}
) {
  const [ctx, run] = await Promise.all([promptContext(kb, "chat"), runConfig(kb, options)]);
  const recorder = new TraceRecorder();
  const filesChanged = new Set<string>();
  let modelChain: string[] = [];
  // The user turn that started this run, for the trace record.
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const input =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : lastUser?.content
          ?.map((part) => (part.type === "text" ? part.text : ""))
          .join(" ")
          .trim() ?? "(chat)";

  try {
    const resolved = await resolveAgentModel(options, "chat", run.env);
    modelChain = resolved.modelChain;
    const result = streamText({
      model: resolved.model,
      system: buildSystemPrompt(ctx, run.promptResolver),
      messages,
      tools: {
        ...buildReadTools(kb, recorder, run.searchLimit),
        ...buildWriteTools(kb, filesChanged, recorder),
      },
      stopWhen: stepCountIs(run.maxSteps),
      onFinish: async ({ text }) => {
        // Persist only turns that actually touched the bundle.
        if (recorder.steps.length > 0) {
          await run.traces.save(recorder.finalize("chat", input, text, "success", modelChain));
        }
      },
    });
    return { result, filesChanged };
  } catch (err) {
    const outcome = filesChanged.size > 0 ? "partial" : "failed";
    await run.traces.save(recorder.finalize("chat", input, errorMessage(err), outcome, modelChain));
    throw err;
  }
}
