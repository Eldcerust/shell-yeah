import assert from "node:assert/strict";
import { test } from "node:test";
import { autoRun, untilEnded } from "./autorun.ts";
import type { RunRegistry, StartInput, TailResult } from "./runs.ts";
import type { Phase, RunRow } from "../shared/row.ts";

const T0 = 1_700_000_000_000;
const running: Phase = { kind: "running", startedAt: T0, stopRequestedAt: null };
const ok: Phase = { kind: "ok", startedAt: T0, endedAt: T0 + 1000 };
const failed: Phase = { kind: "failed", startedAt: T0, endedAt: T0 + 1000, exitCode: 1, signal: null, message: null };

const proposal = (runId: string, command: string, extra: Partial<RunRow> = {}): RunRow => ({
  runId, rev: 0, origin: "claude", command, cwd: "/w", phase: { kind: "proposed" }, output: { lines: [], total: 0 }, sentAt: null, ...extra,
});

const view = (rev: number, phase: Phase): TailResult => ({
  state: "view",
  view: { rev, phase, output: { lines: [], total: 0 }, cursor: null, sentAt: null, lastOutputAt: null, serverNow: T0 },
});

// A registry where each run takes the phases given for it, one per tail call, and then stays in the last.
function fake(script: Record<string, TailResult[]>, startError?: (input: StartInput) => Error | undefined) {
  const started: string[] = [];
  const calls: Record<string, number> = {};
  const registry: Pick<RunRegistry, "start" | "tail"> = {
    async start(input) {
      const error = startError?.(input);
      if (error) throw error;
      started.push(input.command);
      assert.equal(input.origin, "claude");
      return { runId: input.runId! };
    },
    async tail(runId) {
      const replies = script[runId] ?? [{ state: "unknown" }];
      const at = calls[runId] ?? 0;
      calls[runId] = at + 1;
      return replies[Math.min(at, replies.length - 1)]!;
    },
  };
  return { registry, started };
}

test("nothing starts while the setting is off", async () => {
  const { registry, started } = fake({});
  await autoRun({ registry, enabled: async () => false }, "a", [proposal("r1", "npm test")]);
  assert.deepEqual(started, []);
});

test("commands run one after another, each after the one before finished", async () => {
  const { registry, started } = fake({
    r1: [view(1, running), view(2, ok)],
    r2: [view(1, ok)],
  });
  await autoRun({ registry, enabled: async () => true }, "a", [proposal("r1", "npm run build"), proposal("r2", "npm run deploy")]);
  assert.deepEqual(started, ["npm run build", "npm run deploy"]);
});

test("the chain stops at the first command that does not finish cleanly", async () => {
  const { registry, started } = fake({ r1: [view(1, failed)], r2: [view(1, ok)] });
  await autoRun({ registry, enabled: async () => true }, "a", [proposal("r1", "npm test"), proposal("r2", "npm publish")]);
  assert.deepEqual(started, ["npm test"]);
});

test("turning the setting off stops the commands still waiting", async () => {
  const { registry, started } = fake({ r1: [view(1, ok)], r2: [view(1, ok)] });
  let asked = 0;
  await autoRun({ registry, enabled: async () => ++asked <= 1 }, "a", [proposal("r1", "one"), proposal("r2", "two")]);
  assert.deepEqual(started, ["one"]);
});

test("a command that cannot start stays a card and ends the chain without throwing", async () => {
  const { registry, started } = fake({ r2: [view(1, ok)] }, (input) => (input.command === "one" ? new Error("8 commands are already running.") : undefined));
  await autoRun({ registry, enabled: async () => true }, "a", [proposal("r1", "one"), proposal("r2", "two")]);
  assert.deepEqual(started, []);
});

test("only a proposed card from the agent is started", async () => {
  const { registry, started } = fake({ r3: [view(1, ok)] });
  await autoRun({ registry, enabled: async () => true }, "a", [
    proposal("r1", "typed by the user", { origin: "user" }),
    proposal("r2", "already running", { phase: running }),
    proposal("r3", "from the agent"),
  ]);
  assert.deepEqual(started, ["from the agent"]);
});

test("a run the daemon no longer knows ends the chain", async () => {
  const { registry, started } = fake({ r1: [{ state: "unknown" }], r2: [view(1, ok)] });
  await autoRun({ registry, enabled: async () => true }, "a", [proposal("r1", "one"), proposal("r2", "two")]);
  assert.deepEqual(started, ["one"]);
});

test("untilEnded follows the revision and returns the ending phase", async () => {
  const seen: Array<number | null> = [];
  const registry: Pick<RunRegistry, "tail"> = {
    async tail(_runId, _lines, since) {
      seen.push(since);
      return since === null ? view(1, running) : since === 1 ? { state: "unchanged", rev: 1 } : view(2, ok);
    },
  };
  // 1: first answer is the running view; then unchanged at rev 1 keeps waiting; the registry then reports the end.
  let calls = 0;
  const stepped: Pick<RunRegistry, "tail"> = {
    async tail(runId, lines, since, wait) {
      calls++;
      if (calls === 2) return { state: "unchanged", rev: 1 };
      if (calls >= 3) return view(2, ok);
      return registry.tail(runId, lines, since, wait);
    },
  };
  const phase = await untilEnded(stepped, "r1");
  assert.equal(phase?.kind, "ok");
  assert.equal(calls, 3);
});
