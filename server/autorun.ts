import { LIMITS } from "../shared/limits.ts";
import { isEnded, type Phase, type RunRow } from "../shared/row.ts";
import type { RunRegistry } from "./runs.ts";

export interface AutoRunDeps {
  registry: Pick<RunRegistry, "start" | "tail">;
  // Asked before each command, so turning the setting off stops the ones still waiting.
  enabled(): Promise<boolean>;
}

// The phase a run ends in, or null when the daemon no longer knows the run.
export async function untilEnded(registry: Pick<RunRegistry, "tail">, runId: string): Promise<Phase | null> {
  let since: number | null = null;
  for (;;) {
    const reply = await registry.tail(runId, 1, since, LIMITS.tailWaitMaxMs);
    if (reply.state === "unknown") return null;
    if (reply.state === "view") {
      since = reply.view.rev;
      if (isEnded(reply.view.phase)) return reply.view.phase;
    } else {
      since = reply.rev;
    }
  }
}

// Starts the commands an agent handed over, one after another, the way pressing Run on each
// card would. Order matters (a build, then a deploy), so a command waits for the one before it,
// and the chain stops at the first that doesn't finish cleanly. The commands left over stay as
// cards with a Run button. A command that can't start (too many running, the chat isn't loaded)
// stays a card too.
export async function autoRun(deps: AutoRunDeps, agentId: string, rows: readonly RunRow[]): Promise<void> {
  for (const row of rows) {
    if (row.origin !== "claude" || row.phase.kind !== "proposed") continue;
    if (!(await deps.enabled())) return;
    try {
      await deps.registry.start({ agentId, cwd: row.cwd, command: row.command, origin: "claude", runId: row.runId });
    } catch {
      return;
    }
    const ended = await untilEnded(deps.registry, row.runId);
    if (ended?.kind !== "ok") return;
  }
}
