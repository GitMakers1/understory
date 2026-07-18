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
}

export interface QueryTrace extends TraceSummary {
  steps: TraceStep[];
  answer: string;
}

export interface AppConfig {
  providers: string[];
  defaultProvider: string;
  defaultModel: string;
}

// ── Settings ──────────────────────────────────────────────────────────

export interface LlmSettings {
  provider: string | null;
  model: string | null;
  llamacppBaseUrl: string | null;
  llamacppApiKey: string | null;
  localBaseUrl: string | null;
  localApiKey: string | null;
  anthropicApiKey: string | null;
  openrouterApiKey: string | null;
}

export interface AgentSettings {
  maxSteps: number | null;
  mutationTemperature: number | null;
  searchLimit: number | null;
  maxTraces: number | null;
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
  prompts: PromptSettings;
  gitAutocommit: boolean | null;
}

export interface SettingsResponse {
  settings: UnderstorySettings;
  defaults: {
    agent: Record<keyof AgentSettings, number>;
    seed: Record<keyof SeedSettings, number>;
    prompts: Record<keyof PromptSettings, string>;
  };
  env: {
    provider: string;
    model: string;
    providersWithCredentials: string[];
    gitAutocommit: boolean;
  };
  boot: { bundleRoot: string; port: number; authEnabled: boolean };
  secretSentinel: string;
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

export const api = {
  tree: () => get<TreeNode>("/api/tree"),
  concept: (path: string) => get<Concept>(`/api/concept?path=${encodeURIComponent(path)}`),
  search: (q: string) => get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  log: () => get<LogEntry[]>("/api/log"),
  validate: () => get<ConformanceReport>("/api/validate"),
  graph: () => get<GraphData>("/api/graph"),
  traces: () => get<TraceSummary[]>("/api/traces"),
  trace: (id: string) => get<QueryTrace>(`/api/trace?id=${encodeURIComponent(id)}`),
  config: () => get<AppConfig>("/api/config"),
  settings: () => get<SettingsResponse>("/api/settings"),
  saveSettings: (patch: Partial<UnderstorySettings>) =>
    put<{ settings: UnderstorySettings }>("/api/settings", patch),
};
