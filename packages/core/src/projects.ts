import { promises as fs } from "node:fs";
import path from "node:path";
import { KnowledgeBase, type KnowledgeBaseOptions } from "./okf/index.js";

/**
 * Multi-project ("workspace") layer: one server, N independent OKF bundles.
 *
 * Layout: PROJECTS_ROOT/registry.json + PROJECTS_ROOT/<id>/ per project.
 * A legacy single bundle (BUNDLE_ROOT) is REFERENCED via a `root` override on
 * the auto-registered "default" project — files are never moved.
 *
 * Projects are created only through ProjectManager.create(), which is exposed
 * exclusively to the web UI's REST route — the MCP surface has no creation
 * path by design.
 */

export interface ProjectInfo {
  id: string;
  name: string;
  /** One-paragraph "what lives here" — the super-index entry agents route by. */
  description: string;
  createdAt: string;
  /** Absolute bundle root override (legacy bundles). Default: PROJECTS_ROOT/<id>. */
  root?: string;
  archived?: boolean;
  /** Set on every mutation; cleared when the description is regenerated. */
  descriptionStale?: boolean;
}

interface RegistryFile {
  projects: ProjectInfo[];
}

export interface ProjectStats {
  conceptCount: number;
  types: string[];
}

export const DEFAULT_PROJECT_ID = "default";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function slugifyProjectId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "project";
}

const STATS_TTL_MS = 30_000;

export class ProjectManager {
  private registry: RegistryFile = { projects: [] };
  private loaded = false;
  private readonly kbs = new Map<string, KnowledgeBase>();
  private readonly statsCache = new Map<string, { at: number; stats: ProjectStats }>();

  constructor(
    private readonly projectsRoot: string,
    /** Existing single-bundle root to register as "default" on first boot. */
    private readonly legacyBundleRoot?: string,
    private readonly kbOptions: KnowledgeBaseOptions = {}
  ) {}

  private get registryFile(): string {
    return path.join(this.projectsRoot, "registry.json");
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    await fs.mkdir(this.projectsRoot, { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(this.registryFile, "utf-8")) as RegistryFile;
      if (Array.isArray(raw.projects)) this.registry = raw;
    } catch {
      this.registry = { projects: [] };
    }
    // First boot with a legacy bundle: reference it as "default", never move it.
    if (!this.registry.projects.some((p) => p.id === DEFAULT_PROJECT_ID)) {
      this.registry.projects.unshift({
        id: DEFAULT_PROJECT_ID,
        name: "Default",
        description: "The original memory bundle (pre-multi-project).",
        createdAt: new Date().toISOString(),
        ...(this.legacyBundleRoot ? { root: path.resolve(this.legacyBundleRoot) } : {}),
      });
      await this.save();
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const tmp = this.registryFile + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(this.registry, null, 2), "utf-8");
    await fs.rename(tmp, this.registryFile);
  }

  list(includeArchived = false): ProjectInfo[] {
    return this.registry.projects.filter((p) => includeArchived || !p.archived);
  }

  get(id: string): ProjectInfo | undefined {
    return this.registry.projects.find((p) => p.id === id);
  }

  rootOf(p: ProjectInfo): string {
    return p.root ?? path.join(this.projectsRoot, p.id);
  }

  /** KnowledgeBase for a project; throws on unknown id (the MCP firewall relies on this). */
  kb(id: string): KnowledgeBase {
    const p = this.get(id);
    if (!p) {
      throw new UnknownProjectError(id, this.list().map((x) => x.id));
    }
    let kb = this.kbs.get(id);
    if (!kb) {
      kb = new KnowledgeBase(this.rootOf(p), this.kbOptions);
      this.kbs.set(id, kb);
    }
    return kb;
  }

  /** UI-only creation path. */
  async create(name: string, description: string, id?: string): Promise<ProjectInfo> {
    await this.load();
    const pid = id ?? slugifyProjectId(name);
    if (!ID_RE.test(pid)) {
      throw new Error(`Invalid project id "${pid}" (lowercase letters, digits, dashes)`);
    }
    if (this.get(pid)) throw new Error(`Project "${pid}" already exists`);
    const info: ProjectInfo = {
      id: pid,
      name: name.trim() || pid,
      description: description.trim(),
      createdAt: new Date().toISOString(),
    };
    await fs.mkdir(path.join(this.projectsRoot, pid), { recursive: true });
    this.registry.projects.push(info);
    await this.save();
    return info;
  }

  async update(
    id: string,
    patch: Partial<Pick<ProjectInfo, "name" | "description" | "archived" | "descriptionStale">>
  ): Promise<ProjectInfo> {
    const p = this.get(id);
    if (!p) throw new UnknownProjectError(id, this.list().map((x) => x.id));
    if (patch.name !== undefined) p.name = patch.name.trim() || p.name;
    if (patch.description !== undefined) {
      p.description = patch.description.trim();
      p.descriptionStale = false;
    }
    if (patch.archived !== undefined) p.archived = patch.archived;
    if (patch.descriptionStale !== undefined) p.descriptionStale = patch.descriptionStale;
    await this.save();
    return p;
  }

  /** Call after any successful mutation — flags the description as stale. */
  markActivity(id: string): void {
    const p = this.get(id);
    if (p && !p.descriptionStale) {
      p.descriptionStale = true;
      this.statsCache.delete(id);
      void this.save().catch(() => {});
    }
    this.statsCache.delete(id);
  }

  async stats(id: string): Promise<ProjectStats> {
    const cached = this.statsCache.get(id);
    if (cached && Date.now() - cached.at < STATS_TTL_MS) return cached.stats;
    const kb = this.kb(id);
    const [paths, types] = await Promise.all([kb.bundle.listConceptPaths(), kb.listTypes()]);
    const stats = { conceptCount: paths.length, types };
    this.statsCache.set(id, { at: Date.now(), stats });
    return stats;
  }

  /**
   * Compact table of all projects for the MCP super index — what the
   * orchestrating agent routes by.
   */
  async superIndex(): Promise<string> {
    await this.load();
    const lines: string[] = [];
    for (const p of this.list()) {
      let count = "?";
      try {
        count = String((await this.stats(p.id)).conceptCount);
      } catch {
        // unreadable project still listed
      }
      lines.push(
        `- ${p.id} (${count} concepts)${p.descriptionStale ? " [description may be outdated]" : ""}: ${p.description || "(no description yet)"}`
      );
    }
    return lines.join("\n");
  }
}

export class UnknownProjectError extends Error {
  constructor(id: string, known: string[]) {
    super(
      `No such project "${id}". Known projects: ${known.join(", ") || "(none)"}. ` +
        `Projects can only be created in the web UI.`
    );
    this.name = "UnknownProjectError";
  }
}
