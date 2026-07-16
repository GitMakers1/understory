import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { KnowledgeBase } from "../src/okf/index.js";
import { duplicateCandidates, runDream } from "../src/agent/dream.js";

let root: string;
let kb: KnowledgeBase;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ustory-dream-"));
  kb = new KnowledgeBase(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("duplicateCandidates", () => {
  it("flags near-identical title/description pairs and ignores distinct ones", () => {
    const nodes = [
      { path: "/a.md", title: "Billing API rate limits", description: "100 requests per minute per client", links: 1 },
      { path: "/b.md", title: "API rate limits for billing", description: "per client limit of 100 requests per minute", links: 0 },
      { path: "/c.md", title: "Office WiFi", description: "guest network password rotation", links: 0 },
    ];
    const dupes = duplicateCandidates(nodes);
    expect(dupes).toHaveLength(1);
    expect([dupes[0].a, dupes[0].b].sort()).toEqual(["/a.md", "/b.md"]);
    expect(dupes[0].similarity).toBeGreaterThan(0.6);
  });
});

describe("runDream", () => {
  it("skips (no agent run) when the memory is healthy and quiet", async () => {
    // Two concepts linking to each other: no orphans, no broken links, <5 log entries.
    await kb.writeConcept("/a.md", { type: "T", title: "Alpha topic", description: "first subject" }, "See [B](/b.md).", "add a");
    await kb.writeConcept("/b.md", { type: "T", title: "Beta subject", description: "second matter" }, "See [A](/a.md).", "add b");
    const runner = vi.fn();
    const report = await runDream(kb, {}, runner as never);
    expect(report.ran).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it("dreams when there are orphans, feeding them into the instruction", async () => {
    await kb.writeConcept("/hub.md", { type: "T", title: "Central hub", description: "main entry" }, "core", "add");
    await kb.writeConcept("/stray.md", { type: "T", title: "Stray note", description: "unconnected detail" }, "alone", "add");
    const runner = vi.fn(async () => ({ summary: "wired stray into hub", filesChanged: ["/hub.md"], steps: 3, traceId: "t" }));
    const report = await runDream(kb, {}, runner as never);
    expect(report.ran).toBe(true);
    expect(report.summary).toBe("wired stray into hub");
    const instruction = runner.mock.calls[0][1] as unknown as string;
    expect(instruction).toContain("DREAM");
    expect(instruction).toContain("/stray.md");
  });

  it("normalizes the PR#5 MutationOutcome shape too", async () => {
    await kb.writeConcept("/only.md", { type: "T", title: "Only one", description: "solo" }, "x", "add");
    const runner = vi.fn(async () => ({ ok: true, result: { summary: "done", filesChanged: ["/only.md"], steps: 1, traceId: "t" } }));
    const report = await runDream(kb, {}, runner as never);
    expect(report.ran).toBe(true);
    expect(report.summary).toBe("done");
    expect(report.filesChanged).toEqual(["/only.md"]);
  });
});
