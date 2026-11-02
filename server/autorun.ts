import { LIMITS } from "../shared/limits.ts";
import { isEnded, type Phase, type RunRow } from "../shared/row.ts";
import type { RunRegistry } from "./runs.ts";

export interface AutoRunBudget {
  // Counts one start for the chat and says whether it is within the hour's limit.
  take(agentId: string): boolean;
}

export function createAutoRunBudget(now: () => number, limit: number = LIMITS.autoRunsPerHour, windowMs = 3_600_000): AutoRunBudget {
  const taken = new Map<string, number[]>();
  return {
    take(agentId) {
      const at = now();
      const recent = (taken.get(agentId) ?? []).filter((time) => at - time < windowMs);
      const within = recent.length < limit;
      if (within) recent.push(at);
      taken.set(agentId, recent);
      return within;
    },
  };
}

export interface AutoRunDeps {
  registry: Pick<RunRegistry, "start" | "tail">;
  // Asked before each command, so turning the setting off stops the ones still waiting.
  enabled(): Promise<boolean>;
  // Asked once the commands are done: whether their results go back to the agent.
  sends(): Promise<boolean>;
  // What the Send button does for one run. Rejects when the agent can't take it now.
  send(runId: string): Promise<unknown>;
  budget: AutoRunBudget;
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
// cards with a Run button, and so does one that can't start (too many running, the chat isn't
// loaded) or that would pass the hour's limit.
//
// Results go back only when the whole chain is done, in order, each as the Send button would
// send it. A failure goes too, since it is what the agent needs. A command the user stopped
// doesn't: stopping is saying "not this". If the agent can't take a result now (it is waiting
// on a permission), the rest stay unsent and the card's Send button is still there.
export async function autoRun(deps: AutoRunDeps, agentId: string, rows: readonly RunRow[]): Promise<void> {
  const finished: string[] = [];
  for (const row of rows) {
    if (row.origin !== "claude" || row.phase.kind !== "proposed") continue;
    if (!(await deps.enabled())) break;
    if (!deps.budget.take(agentId)) break;
    try {
      await deps.registry.start({ agentId, cwd: row.cwd, command: row.command, origin: "claude", runId: row.runId });
    } catch {
      break;
    }
    const ended = await untilEnded(deps.registry, row.runId);
    if (ended?.kind === "ok" || ended?.kind === "failed") finished.push(row.runId);
    if (ended?.kind !== "ok") break;
  }
  if (finished.length === 0 || !(await deps.sends())) return;
  for (const runId of finished) {
    try {
      await deps.send(runId);
    } catch {
      return;
    }
  }
}
