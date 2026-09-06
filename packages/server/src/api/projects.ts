import express, { type Router } from "express";
import {
  runQuery,
  UnknownProjectError,
  type ProjectManager,
  type SettingsStore,
} from "@understory/core";

/**
 * Project (workspace) management API — the ONLY place projects are created.
 * The MCP surface deliberately has no creation tool; agents get routed here
 * with an error message pointing at the web UI.
 */
export function projectsRouter(pm: ProjectManager, store?: SettingsStore): Router {
  const router = express.Router();

  router.get("/projects", async (_req, res) => {
    await pm.load();
    const projects = await Promise.all(
      pm.list(true).map(async (p) => {
        let stats = { conceptCount: 0, types: [] as string[] };
        let healthy = true;
        try {
          stats = await pm.stats(p.id);
          healthy = (await pm.kb(p.id).lint()).healthy;
        } catch {
          healthy = false;
        }
        return { ...p, ...stats, healthy };
      })
    );
    res.json(projects);
  });

  router.post("/projects", async (req, res) => {
    const { name, description, id } = req.body as {
      name?: string;
      description?: string;
      id?: string;
    };
    if (!name?.trim() || !description?.trim()) {
      res.status(400).json({ error: "name and description are required" });
      return;
    }
    try {
      const info = await pm.create(name, description, id?.trim() || undefined);
      res.status(201).json(info);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.patch("/projects/:id", async (req, res) => {
    const { name, description, archived } = req.body as {
      name?: string;
      description?: string;
      archived?: boolean;
    };
    try {
      res.json(await pm.update(req.params.id, { name, description, archived }));
    } catch (err) {
      const status = err instanceof UnknownProjectError ? 404 : 400;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  /** Agent-generated description — the super-index entry, refreshed on demand. */
  router.post("/projects/:id/describe", async (req, res) => {
    try {
      const kb = pm.kb(req.params.id);
      const { answer } = await runQuery(
        kb,
        "Write a 2-3 sentence description of what this knowledge base contains and what it is for — " +
          "the subject areas, the kinds of concepts stored, and what an agent could find here. " +
          "Plain prose, no headings, no 'Sources:' line, no bundle paths. This will be shown to " +
          "other agents deciding whether to search this knowledge base.",
        { settings: store }
      );
      const description = answer
        .replace(/\n?Sources:[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      const info = await pm.update(req.params.id, { description });
      res.json(info);
    } catch (err) {
      const status = err instanceof UnknownProjectError ? 404 : 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  return router;
}
