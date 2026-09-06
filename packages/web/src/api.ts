export interface TreeNode {
  name: string;
  path: string;
  kind: "directory" | "concept" | "reserved";
  type?: string;
  title?: string;
  description?: string;
  children?: TreeNode[];
}

export interface Concept {
  path: string;
  frontmatter: Record<string, unknown> & { type: string };
  body: string;
}

export interface SearchHit {
  path: string;
  type: string;
  title?: string;
  description?: string;
  snippet?: string;
}

export interface LogEntry {
  date: string;
  action: "Creation" | "Update" | "Deletion";
  summary: string;
}

export interface ConformanceReport {
  conformant: boolean;
  conceptCount: number;
  directoryCount: number;
  issues: { path: string; severity: "error" | "warning"; message: string }[];
}

export interface GraphNode {
  path: string;
  title?: string;
  type?: string;
  description?: string;
  links: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: { source: string; target: string }[];
}

export interface TraceStep {
  seq: number;
  tool: string;
  summary: string;
  paths: string[];
  write?: boolean;
}

export interface TraceSummary {
  id: string;
  kind: "query" | "mutation" | "chat";
  input: string;
  startedAt: string;
  durationMs: number;
  notation: string;
  stepCount: number;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface QueryTrace extends TraceSummary {
  steps: TraceStep[];
  answer: string;
}

export interface AppConfig {
  model: string;
  format: "openai" | "anthropic" | string;
  fallbackConfigured: boolean;
}

// ── Settings ──────────────────────────────────────────────────────────

export interface LlmSettings {
  apiBaseUrl: string | null;
  apiKey: string | null;
  apiFormat: string | null;
  model: string | null;
  fallbackBaseUrl: string | null;
  fallbackApiKey: string | null;
  fallbackFormat: string | null;
  fallbackModel: string | null;
  fallbackAllowFor: string | null;
  fallbackRetry429: boolean | null;
  provider: string | null;
  llamacppBaseUrl: string | null;
  llamacppApiKey: string | null;
  localBaseUrl: string | null;
  localApiKey: string | null;
  anthropicApiKey: string | null;
  openrouterApiKey: string | null;
}

export interface DreamSettings {
  interval: string | null;
  insights: boolean | null;
}

export interface CacheSettings {
  queryCache: boolean | null;
  queryCacheTtl: string | null;
  hotMemory: boolean | null;
  hotMemoryTtl: string | null;
}

export interface AgentSettings {
  maxSteps: number | null;
  mutationTemperature: number | null;
  searchLimit: number | null;
  maxTraces: number | null;
  readExcerptChars: number | null;
}

export interface SeedSettings {
  maxChars: number | null;
  maxDescriptionsPerSegment: number | null;
}

export interface PromptSettings {
  system: string | null;
  modeQuery: string | null;
  modeMutate: string | null;
  modeChat: string | null;
  addWrapper: string | null;
  maintainWrapper: string | null;
  seedInstructions: string | null;
}

export interface UnderstorySettings {
  llm: LlmSettings;
  agent: AgentSettings;
  seed: SeedSettings;
  dream: DreamSettings;
  cache: CacheSettings;
  prompts: PromptSettings;
  gitAutocommit: boolean | null;
}

export interface EffectiveEndpoint {
  baseURL: string;
  format: string;
  model: string;
}

export interface EffectiveSettings {
  primary: EffectiveEndpoint | null;
  fallback: EffectiveEndpoint | null;
  modelAutoDiscovered: boolean;
  configError: string | null;
  legacyProvider: string | null;
  maxSteps: number;
  mutationTemperature: number;
  searchLimit: number;
  maxTraces: number;
  readExcerptChars: number;
  seedMaxChars: number;
  seedMaxDescriptionsPerSegment: number;
  gitAutocommit: boolean;
  dreamInterval: string | null;
  dreamInsights: boolean;
  queryCache: boolean;
  queryCacheTtl: string;
  hotMemory: boolean;
  hotMemoryTtl: string;
  keysFromEnv: {
    api: boolean;
    fallback: boolean;
    anthropic: boolean;
    openrouter: boolean;
    llamacpp: boolean;
    local: boolean;
  };
}

export interface SettingsResponse {
  settings: UnderstorySettings;
  defaults: {
    agent: Record<keyof AgentSettings, number>;
    seed: Record<keyof SeedSettings, number>;
    prompts: Record<keyof PromptSettings, string>;
  };
  effective: EffectiveSettings;
  boot: { bundleRoot: string; port: number; authEnabled: boolean };
  secretSentinel: string;
}

// ── Projects ──────────────────────────────────────────────────────────

export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  archived?: boolean;
  descriptionStale?: boolean;
  conceptCount: number;
  types: string[];
  healthy: boolean;
}

const PROJECT_KEY = "understory-project";

export function getCurrentProject(): string {
  return localStorage.getItem(PROJECT_KEY) ?? "default";
}

export function setCurrentProject(id: string): void {
  localStorage.setItem(PROJECT_KEY, id);
}

/** Scope a /api URL to the currently selected project. */
export function withProject(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}project=${encodeURIComponent(getCurrentProject())}`;
}

const TOKEN_KEY = "understory-token";

export function getAuthToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setAuthToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Headers for API calls — includes the bearer token when one is stored. */
export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${await res.text()}`);
  return res.json();
}

async function put<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${await res.text()}`);
  return res.json();
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${await res.text()}`);
  return res.json();
}

async function patchReq<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${await res.text()}`);
  return res.json();
}

export const api = {
  tree: () => get<TreeNode>(withProject("/api/tree")),
  concept: (path: string) =>
    get<Concept>(withProject(`/api/concept?path=${encodeURIComponent(path)}`)),
  search: (q: string) => get<SearchHit[]>(withProject(`/api/search?q=${encodeURIComponent(q)}`)),
  log: () => get<LogEntry[]>(withProject("/api/log")),
  validate: () => get<ConformanceReport>(withProject("/api/validate")),
  graph: () => get<GraphData>(withProject("/api/graph")),
  traces: () => get<TraceSummary[]>(withProject("/api/traces")),
  trace: (id: string) => get<QueryTrace>(withProject(`/api/trace?id=${encodeURIComponent(id)}`)),
  config: () => get<AppConfig>("/api/config"),
  settings: () => get<SettingsResponse>("/api/settings"),
  saveSettings: (patch: Partial<UnderstorySettings>) =>
    put<{ settings: UnderstorySettings }>("/api/settings", patch),
  projects: () => get<ProjectInfo[]>("/api/projects"),
  createProject: (name: string, description: string) =>
    post<ProjectInfo>("/api/projects", { name, description }),
  updateProject: (id: string, patch: { name?: string; description?: string; archived?: boolean }) =>
    patchReq<ProjectInfo>(`/api/projects/${encodeURIComponent(id)}`, patch),
  describeProject: (id: string) =>
    post<ProjectInfo>(`/api/projects/${encodeURIComponent(id)}/describe`, {}),
};
