import { useEffect, useState } from "react";
import { api, getCurrentProject, type ProjectInfo } from "../api";

/**
 * Project management — the ONLY place projects are created (the MCP surface
 * deliberately has no creation tool). Cards show the super-index description
 * agents route by; "Regenerate" asks the internal agent to rewrite it from
 * the bundle's actual contents.
 */
export function ProjectsView({ onSwitch }: { onSwitch: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");

  const load = () =>
    api
      .projects()
      .then(setProjects)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
  }, []);

  const current = getCurrentProject();

  const create = async () => {
    if (!newName.trim() || !newDesc.trim()) return;
    setBusyId("__new__");
    setError(null);
    try {
      const info = await api.createProject(newName.trim(), newDesc.trim());
      setCreating(false);
      setNewName("");
      setNewDesc("");
      await load();
      onSwitch(info.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const regenerate = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.describeProject(id);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const saveDesc = async (id: string) => {
    setBusyId(id);
    try {
      await api.updateProject(id, { description: editDesc });
      setEditId(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!projects) {
    return <p className="p-6 text-sm text-zinc-500">{error ?? "Loading projects…"}</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-zinc-100">Projects</h2>
        <span className="text-xs text-zinc-500">
          separate knowledge bases — agents see all descriptions as a super index
        </span>
        <button
          onClick={() => setCreating(!creating)}
          className="ml-auto rounded-lg bg-cyan-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-600"
        >
          {creating ? "Cancel" : "New project"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {creating && (
        <div className="space-y-2 rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name (e.g. Client X, Home automation)"
            autoFocus
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-cyan-600"
          />
          <textarea
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description — what will live here? Agents use this to decide when to search this project."
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-cyan-600"
          />
          <button
            onClick={create}
            disabled={!newName.trim() || !newDesc.trim() || busyId === "__new__"}
            className="rounded-lg bg-cyan-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {busyId === "__new__" ? "Creating…" : "Create"}
          </button>
        </div>
      )}

      {projects.map((p) => (
        <div
          key={p.id}
          className={`rounded-xl border p-4 ${
            p.id === current ? "border-cyan-700 bg-cyan-950/10" : "border-zinc-800 bg-zinc-900/40"
          } ${p.archived ? "opacity-50" : ""}`}
        >
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">{p.name}</h3>
            <code className="text-xs text-zinc-500">{p.id}</code>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                p.healthy ? "bg-emerald-900/60 text-emerald-300" : "bg-amber-900/60 text-amber-300"
              }`}
            >
              {p.conceptCount} concepts{p.healthy ? "" : " · needs maintain"}
            </span>
            {p.descriptionStale && (
              <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                description outdated
              </span>
            )}
            <div className="ml-auto flex gap-2">
              {p.id !== current && !p.archived && (
                <button
                  onClick={() => onSwitch(p.id)}
                  className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
                >
                  Switch to
                </button>
              )}
              {p.id === current && (
                <span className="rounded bg-cyan-900/60 px-2 py-1 text-xs text-cyan-300">current</span>
              )}
            </div>
          </div>

          {editId === p.id ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-cyan-600"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveDesc(p.id)}
                  disabled={busyId === p.id}
                  className="rounded bg-cyan-700 px-2 py-1 text-xs text-white hover:bg-cyan-600"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditId(null)}
                  className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">{p.description || "(no description)"}</p>
          )}

          <div className="mt-2 flex gap-3 text-xs text-zinc-500">
            <button
              onClick={() => {
                setEditId(p.id);
                setEditDesc(p.description);
              }}
              className="underline hover:text-zinc-300"
            >
              Edit description
            </button>
            <button
              onClick={() => regenerate(p.id)}
              disabled={busyId === p.id}
              className="underline hover:text-zinc-300 disabled:opacity-50"
            >
              {busyId === p.id ? "Agent writing description…" : "Regenerate with agent"}
            </button>
            <button
              onClick={() => api.updateProject(p.id, { archived: !p.archived }).then(load)}
              className="underline hover:text-zinc-300"
            >
              {p.archived ? "Unarchive" : "Archive"}
            </button>
            {p.types.length > 0 && <span className="ml-auto">{p.types.join(", ")}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
