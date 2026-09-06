# Multi-project memory ("workspaces") — implementation plan

Goal: one understory server managing N independent OKF bundles ("projects").
Projects are created ONLY via the web UI. The MCP-facing orchestrator sees a
super index of all projects (name + description) at session start, can search
and update across them, but cannot create them. UI can switch/navigate freely.

## Invariants (do not lose)

Upgrades this fork carries that every phase must preserve:
- Settings store (`.understory/settings.json`): live-applied LLM/agent/prompt
  overrides, secrets redaction, effective-values API, settings UI tab
- Provider slots + fallback (LLM_API_* + legacy env), model pinned via router
  numeric id (currently "1")
- Layered query path: exact cache (bundle-fingerprint) → hot memory → deep agent
- Dreaming (DREAM_INTERVAL), abort/timeout (UNDERSTORY_LLM_TIMEOUT_MS=240000),
  MCP progress notifications over per-request SSE (enableJsonResponse:false),
  SDK ≥1.30.0 keep-alives
- Excerpt-mode reads (readExcerptChars=4000) + full-read gate on replace_body
- Trace outcomes + token usage; PowerShell `ustory` control; ufw 3800 home-only

## Layout

```
PROJECTS_ROOT=/root/understory-projects/
├── registry.json
├── <id>/            ← new projects live here (bundle root = PROJECTS_ROOT/<id>)
```
Legacy: existing BUNDLE_ROOT (/root/understory-bundle) is REFERENCED, not
moved — registered as project "default" with an explicit `root` override.
Zero file migration risk. Global settings stay in the default project's
`.understory/settings.json`.

registry.json entry: `{ id, name, description, createdAt, root?, archived?,
descriptionStale? }`. `descriptionStale` set true on any mutation; cleared by
agent-描述 regeneration.

## Phase 1 — core (packages/core)

- `src/projects.ts`: `ProjectInfo`, `ProjectRegistry` load/save (atomic tmp+rename),
  `ProjectManager`:
  - `list()`, `get(id)`, `kb(id)` lazy `KnowledgeBase` cache,
    `create(id,name,desc)` (dir + registry; called only from REST),
    `update(id,patch)`, `markActivity(id)` (sets descriptionStale),
    `stats(id)` (conceptCount, types — cached ~30s)
  - boot migration: registry missing → create with `default` → legacy root
- hot-memory: re-key module state per bundle root (`Map<root, …>`);
  `recordHotWrite/Delete(root, path)` — update tools.ts call sites, tests
- query-cache: verify fingerprint keying makes cross-project collisions
  impossible (fingerprint contains per-bundle paths+mtimes — safe; add root to
  the hash anyway for belt+braces)
- gitAutocommit stays per-KnowledgeBase (each project may init its own repo)

## Phase 2 — REST (packages/server)

- `api/projects.ts`:
  - `GET /api/projects` → registry + stats + health
  - `POST /api/projects` {name, description} → slug id; **the only creation path**
  - `PATCH /api/projects/:id` {name?, description?, archived?}
  - `POST /api/projects/:id/describe` → runQuery(kb, "summarize this knowledge
    base…") → save description, clear stale flag
- browse/chat/settings routers take ProjectManager; kb resolved per request
  from `?project=` (default "default"); unknown id → 404
- traces per project (TraceStore already per bundle root — follows kb)

## Phase 3 — MCP (packages/server/src/mcp)

- `/mcp?project=<id>` → session default project (stateless per-request build
  makes this trivial); invalid → error at tool call time
- Every tool gains optional `project` param (falls back to session default):
  memory_query, memory_add, memory_update, memory_status, memory_maintain
- **Super index**: instructions + memory_query description open with the table
  of ALL projects (name, description, concept count, stale-desc marker) ABOVE
  the current project's seed overview
- **`memory_search_index`** tool: deterministic keyword search across all
  non-archived projects (searchBundle per project, merged hits labeled with
  project id, no LLM) — instant "which database knows about X"
- **Creation firewall**: writes to unknown project → text error "no such
  project — projects are created in the web UI". No create/delete tools.
- markActivity(project) after every successful mutation
- dreamer: iterate all non-archived projects per tick (sequential, still
  signal-gated so healthy projects cost nothing)
- stdio transport: keeps single-bundle mode via BUNDLE_ROOT (unchanged), note
  in README

## Phase 4 — web UI (packages/web)

- `api.ts`: module-level `currentProject` (localStorage `understory-project`),
  appended as `?project=` to every call; projects CRUD client; chat transport
  URL includes project
- `App.tsx`: project dropdown in sidebar header (name + count), switching
  resets view + refreshes everything; "Projects" entry in bottom nav
- `ProjectsView.tsx`: cards (name, editable description, stats, conformance/
  health badges, stale-description indicator, "Regenerate description" button
  spinner), "New project" dialog — name + description required
- Settings view: still global; add note that settings apply to all projects

## Phase 5 — deploy (aiserver)

1. start script: add `PROJECTS_ROOT=/root/understory-projects` (keep BUNDLE_ROOT
   for legacy-default registration + settings location)
2. deploy, verify registry auto-created with default → /root/understory-bundle
3. create test project via API/UI ("scratch"), verify:
   - UI switch + navigate both projects
   - MCP: query default, add to scratch via project param, search_index spans both
   - firewall: write to nonexistent project rejected
   - dreamer log covers both projects
4. re-register MCP unchanged URL (default project) — existing clients untouched
5. update auto-memory + ustory memory with the new architecture

## Verification checklist (phase 5 gate)

- [ ] pnpm build + all tests green locally and on server
- [ ] default project serves the existing 57 concepts unchanged
- [ ] settings tab still edits the same settings file; effective card correct
- [ ] progress notifications still stream (SSE unaffected)
- [ ] cache/hot-memory isolation: query in A not answered from B's hot set
- [ ] `ustory health` works (endpoint unchanged)
