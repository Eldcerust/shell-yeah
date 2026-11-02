import assert from "node:assert/strict";
import { test } from "node:test";
import { autoRun, createAutoRunBudget, untilEnded, type AutoRunDeps } from "./autorun.ts";
import type { RunRegistry, StartInput, TailResult } from "./runs.ts";
import type { Phase, RunRow } from "../shared/row.ts";

const T0 = 1_700_000_000_000;
const running: Phase = { kind: "running", startedAt: T0, stopRequestedAt: null };
const ok: Phase = { kind: "ok", startedAt: T0, endedAt: T0 + 1000 };
const failed: Phase = { kind: "failed", startedAt: T0, endedAt: T0 + 1000, exitCode: 1, signal: null, message: null };
const stopped: Phase = { kind: "stopped", startedAt: T0, endedAt: T0 + 1000, exitCode: null, signal: "SIGINT" };

const proposal = (runId: string, command: string, extra: Partial<RunRow> = {}): RunRow => ({
  runId, rev: 0, origin: "claude", command, cwd: "/w", phase: { kind: "proposed" }, output: { lines: [], total: 0 }, sentAt: null, ...extra,
});

const view = (rev: number, phase: Phase): TailResult => ({
  state: "view",
  view: { rev, phase, output: { lines: [], total: 0 }, cursor: null, sentAt: null, lastOutputAt: null, serverNow: T0 },
});

interface Options {
  run?: () => Promise<boolean>;
  sends?: () => Promise<boolean>;
  sendError?: Error;
  startError?: (input: StartInput) => Error | undefined;
  takes?: (agentId: string) => boolean;
}

// A registry where each run takes the phases given for it, one per tail call, and then stays in the last.
function fake(script: Record<string, TailResult[]>, options: Options = {}) {
  const started: string[] = [];
  const sent: string[] = [];
  const events: string[] = [];
  const calls: Record<string, number> = {};
  const registry: Pick<RunRegistry, "start" | "tail"> = {
    async start(input) {
      const error = options.startError?.(input);
      if (error) throw error;
      started.push(input.command);
      events.push(`start ${input.command}`);
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
  const deps: AutoRunDeps = {
    registry,
    enabled: options.run ?? (async () => true),
    sends: options.sends ?? (async () => false),
    send: async (runId) => {
      if (options.sendError) throw options.sendError;
      sent.push(runId);
      events.push(`send ${runId}`);
    },
    budget: { take: (agentId) => options.takes?.(agentId) ?? true },
  };
  return { deps, started, sent, events };
}

test("nothing starts while the setting is off", async () => {
  const { deps, started } = fake({}, { run: async () => false });
  await autoRun(deps, "a", [proposal("r1", "npm test")]);
  assert.deepEqual(started, []);
});

test("commands run one after another, each after the one before finished", async () => {
  const { deps, started } = fake({ r1: [view(1, running), view(2, ok)], r2: [view(1, ok)] });
  await autoRun(deps, "a", [proposal("r1", "npm run build"), proposal("r2", "npm run deploy")]);
  assert.deepEqual(started, ["npm run build", "npm run deploy"]);
});

test("the chain stops at the first command that does not finish cleanly", async () => {
  const { deps, started } = fake({ r1: [view(1, failed)], r2: [view(1, ok)] });
  await autoRun(deps, "a", [proposal("r1", "npm test"), proposal("r2", "npm publish")]);
  assert.deepEqual(started, ["npm test"]);
});

test("turning the setting off stops the commands still waiting", async () => {
  let asked = 0;
  const { deps, started } = fake({ r1: [view(1, ok)], r2: [view(1, ok)] }, { run: async () => ++asked <= 1 });
  await autoRun(deps, "a", [proposal("r1", "one"), proposal("r2", "two")]);
  assert.deepEqual(started, ["one"]);
});

test("a command that cannot start stays a card and ends the chain without throwing", async () => {
  const { deps, started } = fake({ r2: [view(1, ok)] }, { startError: (input) => (input.command === "one" ? new Error("8 commands are already running.") : undefined) });
  await autoRun(deps, "a", [proposal("r1", "one"), proposal("r2", "two")]);
  assert.deepEqual(started, []);
});

test("only a proposed card from the agent is started", async () => {
  const { deps, started } = fake({ r3: [view(1, ok)] });
  await autoRun(deps, "a", [
    proposal("r1", "typed by the user", { origin: "user" }),
    proposal("r2", "already running", { phase: running }),
    proposal("r3", "from the agent"),
  ]);
  assert.deepEqual(started, ["from the agent"]);
});

test("a run the daemon no longer knows ends the chain", async () => {
  const { deps, started } = fake({ r1: [{ state: "unknown" }], r2: [view(1, ok)] });
  await autoRun(deps, "a", [proposal("r1", "one"), proposal("r2", "two")]);
  assert.deepEqual(started, ["one"]);
});

test("results go back in order once every command is done, not while the chain is still running", async () => {
  const { deps, events } = fake({ r1: [view(1, ok)], r2: [view(1, ok)] }, { sends: async () => true });
  await autoRun(deps, "a", [proposal("r1", "build"), proposal("r2", "deploy")]);
  assert.deepEqual(events, ["start build", "start deploy", "send r1", "send r2"]);
});

test("nothing is sent while that setting is off", async () => {
  const { deps, sent } = fake({ r1: [view(1, ok)] }, { sends: async () => false });
  await autoRun(deps, "a", [proposal("r1", "build")]);
  assert.deepEqual(sent, []);
});

test("a failure is sent too, and the commands after it are not started", async () => {
  const { deps, started, sent } = fake({ r1: [view(1, ok)], r2: [view(1, failed)], r3: [view(1, ok)] }, { sends: async () => true });
  await autoRun(deps, "a", [proposal("r1", "one"), proposal("r2", "two"), proposal("r3", "three")]);
  assert.deepEqual(started, ["one", "two"]);
  assert.deepEqual(sent, ["r1", "r2"]);
});

test("a command the user stopped is not sent", async () => {
  const { deps, sent } = fake({ r1: [view(1, stopped)] }, { sends: async () => true });
  await autoRun(deps, "a", [proposal("r1", "long job")]);
  assert.deepEqual(sent, []);
});

test("an agent that cannot take the result now leaves it unsent, without throwing", async () => {
  const { deps, sent } = fake({ r1: [view(1, ok)], r2: [view(1, ok)] }, { sends: async () => true, sendError: new Error("Claude is waiting for you to approve something.") });
  await autoRun(deps, "a", [proposal("r1", "one"), proposal("r2", "two")]);
  assert.deepEqual(sent, []);
});

test("nothing is sent when no command started", async () => {
  const { deps, sent } = fake({}, { run: async () => false, sends: async () => true });
  await autoRun(deps, "a", [proposal("r1", "one")]);
  assert.deepEqual(sent, []);
});

test("a chat past its hourly limit starts nothing more, and the card stays for the Run button", async () => {
  const taken: string[] = [];
  const { deps, started } = fake({ r1: [view(1, ok)] }, { takes: (agentId) => (taken.push(agentId), taken.length <= 1) });
  await autoRun(deps, "a", [proposal("r1", "one"), proposal("r2", "two")]);
  assert.deepEqual(started, ["one"]);
});

test("the hourly limit counts each chat on its own and forgets what is more than an hour old", () => {
  let now = T0;
  const budget = createAutoRunBudget(() => now, 2);
  assert.deepEqual([budget.take("a"), budget.take("a"), budget.take("a")], [true, true, false]);
  assert.equal(budget.take("b"), true, "another chat has its own count");
  now += 59 * 60_000;
  assert.equal(budget.take("a"), false, "still inside the hour");
  now += 2 * 60_000;
  assert.equal(budget.take("a"), true, "the hour has passed");
});

test("untilEnded follows the revision and returns the ending phase", async () => {
  let calls = 0;
  const seen: Array<number | null> = [];
  const registry: Pick<RunRegistry, "tail"> = {
    async tail(_runId, _lines, since) {
      calls++;
      seen.push(since);
      if (calls === 1) return view(1, running);
      if (calls === 2) return { state: "unchanged", rev: 1 };
      return view(2, ok);
    },
  };
  const phase = await untilEnded(registry, "r1");
  assert.equal(phase?.kind, "ok");
  assert.deepEqual(seen, [null, 1, 1]);
});
