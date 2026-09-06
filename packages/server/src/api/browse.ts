import express, { type Request, type Response, type Router } from "express";
import {
  BundleError,
  TraceStore,
  UnknownProjectError,
  resolveFallbackConfig,
  resolveModelConfig,
  type KnowledgeBase,
  type ProjectManager,
  type SettingsStore,
} from "@understory/core";

/** Resolve the request's project (?project=, default "default") to a KB, or 404. */
export function requestKb(pm: ProjectManager, req: Request, res: Response): KnowledgeBase | null {
  const id = String(req.query.project ?? "default");
  try {
    return pm.kb(id);
  } catch (err) {
    if (err instanceof UnknownProjectError) {
      res.status(404).json({ error: err.message });
      return null;
    }
    throw err;
  }
}

/** Deterministic browse API — no LLM involved, browsing never costs tokens. */
export function browseRouter(pm: ProjectManager, store?: SettingsStore): Router {
  const router = express.Router();

  router.get("/tree", async (req, res) => {
    const kb = requestKb(pm, req, res);
    if (!kb) return;
    res.json(await kb.listTree());
  });

  router.get("/concept", async (req, res) => {
    const kb = requestKb(pm, req, res);
    if (!kb) return;
    const path = String(req.query.path ?? "");
    try {
      res.json(await kb.readConcept(path));
    } catch (err) {
      if (err instanceof BundleError) {
        res.status(err.code === "NOT_FOUND" ? 404 : 400).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/search", async (req, res) => {
    const kb = requestKb(pm, req, res);
    if (!kb) return;
    const q = String(req.query.q ?? "");
    const type = req.query.type ? String(req.query.type) : undefined;
    const tag = req.query.tag ? String(req.query.tag) : undefined;
    res.json(await kb.search(q, { type, tags: tag ? [tag] : undefined }));
  });

  router.get("/log", async (req, res) => {
    const kb = requestKb(pm, req, res);
    if (!kb) return;
    res.json(await kb.readLog());
  });

  router.get("/validate", async (req, res) => {
    const kb = requestKb(pm, req, res);
    if (!kb) return;
    res.json(await kb.validate());
  });

  router.get("/graph", async (req, res) => {
    const kb = requestKb(pm, req, res);
    if (!kb) return;
    res.json(await kb.graph());
  });

  router.get("/traces", async (req, res) => {
    const kb = requestKb(pm, req, res);
    if (!kb) return;
    // List view: omit full steps/answers to keep the payload light.
    const all = await new TraceStore(kb.bundle.root).list();
    res.json(
      all.map(({ id, kind, input, startedAt, durationMs, notation, steps, usage }) => ({
        id,
        kind,
        input,
        startedAt,
        durationMs,
        notation,
        stepCount: steps.length,
        usage,
      }))
    );
  });

  router.get("/trace", async (req, res) => {
    const kb = requestKb(pm, req, res);
    if (!kb) return;
    const trace = await new TraceStore(kb.bundle.root).read(String(req.query.id ?? ""));
    if (!trace) {
      res.status(404).json({ error: "trace not found" });
      return;
    }
    res.json(trace);
  });

  router.get("/types", async (req, res) => {
    const kb = requestKb(pm, req, res);
    if (!kb) return;
    res.json(await kb.listTypes());
  });

  router.get("/config", (_req, res) => {
    const env = store?.effectiveEnv() ?? process.env;
    const config = resolveModelConfig(env);
    const fallback = resolveFallbackConfig(env);
    res.json({
      model: config.model,
      format: config.format,
      fallbackConfigured: fallback !== null,
    });
  });

  return router;
}
