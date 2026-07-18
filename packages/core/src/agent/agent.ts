import { generateText, streamText, stepCountIs, type LanguageModel, type ModelMessage } from "ai";
import type { KnowledgeBase } from "../okf/index.js";
import { resolveModel, type ProviderName } from "../providers/index.js";
import { AGENT_DEFAULTS, type SettingsStore } from "../settings.js";
import { buildSystemPrompt, type PromptResolver } from "./system-prompt.js";
import { buildReadTools, buildWriteTools, formatTree } from "./tools.js";
import { TraceRecorder, TraceStore } from "./trace.js";

export interface AgentOptions {
  provider?: ProviderName;
  model?: string;
  /** Live settings (steps, temperature, prompts, provider overrides). */
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

async function promptContext(kb: KnowledgeBase, mode: "query" | "mutate" | "chat") {
  const [types, tree] = await Promise.all([kb.listTypes(), kb.listTree()]);
  return { existingTypes: types, treeSummary: formatTree(tree), mode };
}

interface ResolvedRun {
  model: LanguageModel;
  maxSteps: number;
  mutationTemperature: number;
  searchLimit: number;
  promptResolver: PromptResolver | undefined;
  traces: TraceStore;
}

/** Resolve everything an agent run needs from options + settings, once. */
async function prepareRun(kb: KnowledgeBase, options: AgentOptions): Promise<ResolvedRun> {
  const s = options.settings;
  if (s) await s.load();
  return {
    model: await resolveModel(options.provider, options.model, s?.effectiveEnv() ?? process.env),
    maxSteps: s?.agentValue("maxSteps") ?? AGENT_DEFAULTS.maxSteps,
    mutationTemperature:
      s?.agentValue("mutationTemperature") ?? AGENT_DEFAULTS.mutationTemperature,
    searchLimit: s?.agentValue("searchLimit") ?? AGENT_DEFAULTS.searchLimit,
    promptResolver: s ? (key) => s.prompt(key) : undefined,
    traces: new TraceStore(kb.bundle.root, s?.agentValue("maxTraces") ?? AGENT_DEFAULTS.maxTraces),
  };
}

/** Read-only Q&A over the bundle. */
export async function runQuery(
  kb: KnowledgeBase,
  question: string,
  options: AgentOptions = {}
): Promise<QueryResult> {
  const [ctx, run] = await Promise.all([promptContext(kb, "query"), prepareRun(kb, options)]);
  const recorder = new TraceRecorder();
  const result = await generateText({
    model: run.model,
    system: buildSystemPrompt(ctx, run.promptResolver),
    prompt: question,
    tools: buildReadTools(kb, recorder, run.searchLimit),
    stopWhen: stepCountIs(run.maxSteps),
  });
  const trace = recorder.finalize("query", question, result.text);
  await run.traces.save(trace);
  return { answer: result.text, steps: result.steps.length, traceId: trace.id };
}

/** Knowledge add/update — full toolset, low temperature. */
export async function runMutation(
  kb: KnowledgeBase,
  instruction: string,
  options: AgentOptions = {}
): Promise<MutationResult> {
  const [ctx, run] = await Promise.all([promptContext(kb, "mutate"), prepareRun(kb, options)]);
  const recorder = new TraceRecorder();
  const filesChanged = new Set<string>();
  const result = await generateText({
    model: run.model,
    system: buildSystemPrompt(ctx, run.promptResolver),
    prompt: instruction,
    tools: {
      ...buildReadTools(kb, recorder, run.searchLimit),
      ...buildWriteTools(kb, filesChanged, recorder),
    },
    stopWhen: stepCountIs(run.maxSteps),
    temperature: run.mutationTemperature,
  });
  const trace = recorder.finalize("mutation", instruction, result.text);
  await run.traces.save(trace);
  return {
    summary: result.text,
    filesChanged: [...filesChanged].sort(),
    steps: result.steps.length,
    traceId: trace.id,
  };
}

/** Interactive chat — full toolset, streaming. Caller converts to a UI stream response. */
export async function streamChat(
  kb: KnowledgeBase,
  messages: ModelMessage[],
  options: AgentOptions = {}
) {
  const [ctx, run] = await Promise.all([promptContext(kb, "chat"), prepareRun(kb, options)]);
  const recorder = new TraceRecorder();
  const filesChanged = new Set<string>();
  // The user turn that started this run, for the trace record.
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const input =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : lastUser?.content
          ?.map((part) => (part.type === "text" ? part.text : ""))
          .join(" ")
          .trim() ?? "(chat)";

  const result = streamText({
    model: run.model,
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
        await run.traces.save(recorder.finalize("chat", input, text));
      }
    },
  });
  return { result, filesChanged };
}
