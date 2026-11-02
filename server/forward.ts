import { MAYBE_SENT, PERMISSION_PENDING, RUN_GONE } from "./claude.ts";
import type { RunRow } from "../shared/row.ts";

export interface ForwardDeps {
  // Whether Auto forward results is on. Asked at the moment a run ends.
  enabled(): Promise<boolean>;
  // What the Send button does for one run. Rejects when the agent can't take it now.
  send(agentId: string, runId: string): Promise<unknown>;
  wait(ms: number): Promise<void>;
  log(message: string): void;
}

// A command usually ends within seconds of the turn that handed it over, while Paseo may still be
// settling that agent. A failure that isn't final is tried again after each of these pauses.
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

// These say something true about the agent or the run, not something passing: asking again
// can't help, and "may already have been sent" must never be answered with a second send.
const FINAL = new Set([PERMISSION_PENDING, MAYBE_SENT, RUN_GONE]);

// Sends the result of a command the agent handed over, the way the Send button would, when it
// ends. It is the same whether Auto-run started the command or you pressed Run on its card.
// A command that ends in failure goes too, since it is what the agent needs. A command you
// stopped does not (stopping is saying "not this"), nor does one you typed yourself, nor one
// that has been sent already. Every outcome is logged, because a send that quietly doesn't
// happen is impossible to diagnose from outside.
export async function forwardResult(deps: ForwardDeps, agentId: string, row: RunRow): Promise<void> {
  if (row.origin !== "claude") return;
  if (row.phase.kind !== "ok" && row.phase.kind !== "failed") return;
  if (row.sentAt !== null) return;
  if (!(await deps.enabled())) return;

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
      if (!(await deps.enabled())) return;
    }
  }
}
