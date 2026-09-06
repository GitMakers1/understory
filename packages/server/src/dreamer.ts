import { parseDuration, runDream, type AgentOptions, type ProjectManager } from "@understory/core";

const MIN_INTERVAL_MS = 5 * 60_000;

/**
 * Background dreamer: runs a consolidation pass every DREAM_INTERVAL
 * (e.g. "6h") over every non-archived project, sequentially. Opt-in — unset
 * means no background token spend. Signal-gated per project, so healthy
 * projects cost nothing. The first run happens one interval after boot.
 */
export function startDreamer(pm: ProjectManager, options: AgentOptions = {}): void {
  const raw = process.env.DREAM_INTERVAL;
  const interval = parseDuration(raw);
  if (!interval) {
    if (raw) console.error(`[understory] invalid DREAM_INTERVAL "${raw}" — dreaming disabled`);
    else console.log("[understory] dreaming: disabled (set DREAM_INTERVAL, e.g. 6h, to enable)");
    return;
  }
  const every = Math.max(interval, MIN_INTERVAL_MS);
  console.log(`[understory] dreaming: every ${raw}${every !== interval ? " (clamped to 5m minimum)" : ""}`);

  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return; // never overlap dream passes
    busy = true;
    try {
      await pm.load();
      for (const project of pm.list()) {
        try {
          const report = await runDream(pm.kb(project.id), options);
          if (report.ran) {
            pm.markActivity(project.id);
            console.log(
              `[understory] dream(${project.id}) complete: ${report.filesChanged?.length ?? 0} file(s) changed — ${truncate(report.summary ?? "", 200)}`
            );
          } else {
            console.log(`[understory] dream(${project.id}) skipped: ${report.reason}`);
          }
        } catch (err) {
          console.error(`[understory] dream(${project.id}) failed: ${(err as Error).message}`);
        }
      }
    } finally {
      busy = false;
    }
  }, every);
  timer.unref(); // never keep the process alive just to dream
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
