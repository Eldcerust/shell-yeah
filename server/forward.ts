import { MAYBE_SENT, PERMISSION_PENDING, RUN_GONE } from "./claude.ts";
import type { RunRow } from "../shared/row.ts";

export interface ForwardDeps {
  // Whether the switch for this kind of command is on: Auto forward results for a command the
  // agent handed over, Forward my own commands for one the user typed. Asked when a run ends
  // and when a stop is requested.
  enabled(origin: RunRow["origin"]): Promise<boolean>;
  // What the Send button does for one run. Rejects when the agent can't take it now.
  send(agentId: string, runId: string): Promise<unknown>;
  wait(ms: number): Promise<void>;
  log(message: string): void;
  // Run ids being sent right now. A Stop announces the run at once and its end announces it
  // again moments later; only one of those may reach the agent.
  sending?: Set<string>;
}

// A command usually ends within seconds of the turn that handed it over, while Paseo may still be
// settling that agent. A failure that isn't final is tried again after each of these pauses.
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

// These say something true about the agent or the run, not something passing: asking again
// can't help, and "may already have been sent" must never be answered with a second send.
const FINAL = new Set([PERMISSION_PENDING, MAYBE_SENT, RUN_GONE]);

// Sends the result of a command to the agent of its chat, the way the Send button would, when
// it ends. A command the agent handed over goes when Auto forward results is on, whether
// Auto-run started it or you pressed Run on its card. One you typed goes only when Forward my
// own commands is on. A command that ends in failure goes too, since it is what the agent
// needs. A command you stop goes the moment you press Stop, while the process is still dying,
// and says it was stopped, so the agent knows why the output stops there. One that was
// interrupted by a plugin restart is not sent. Every outcome is logged, and so is every skip
// that isn't just a switch being off, because a send that quietly doesn't happen is impossible
// to diagnose from outside.
export async function forwardResult(deps: ForwardDeps, agentId: string, row: RunRow): Promise<void> {
  if (!(await deps.enabled(row.origin))) return;
  if (!canForward(row.phase)) {
    if (row.phase.kind === "interrupted") deps.log(`forward ${row.runId}: not sent, it was ${row.phase.kind}`);
    return;
  }
  if (row.sentAt !== null) return deps.log(`forward ${row.runId}: not sent, it was sent already`);
  if (deps.sending?.has(row.runId)) return deps.log(`forward ${row.runId}: not sent, it is being sent`);
  deps.sending?.add(row.runId);

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.send(agentId, row.runId);
        deps.log(`forward ${row.runId}: sent`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const delay = RETRY_DELAYS_MS[attempt];
        if (FINAL.has(message) || delay === undefined) {
          deps.log(`forward ${row.runId}: not sent: ${message}`);
          return;
        }
        deps.log(`forward ${row.runId}: attempt ${attempt + 1} failed (${message}); trying again in ${delay / 1000}s`);
        await deps.wait(delay);
        if (!(await deps.enabled(row.origin))) return;
      }
    }
  } finally {
    deps.sending?.delete(row.runId);
  }
}

// A finished run, or one the user just stopped. "running" with a stop time is how the
// registry reports a stop the moment it is asked for, before the process has gone.
function canForward(phase: RunRow["phase"]): boolean {
  if (phase.kind === "ok" || phase.kind === "failed" || phase.kind === "stopped") return true;
  return phase.kind === "running" && phase.stopRequestedAt !== null;
}
