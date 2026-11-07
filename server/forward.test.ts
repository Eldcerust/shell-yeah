import assert from "node:assert/strict";
import { test } from "node:test";
import { MAYBE_SENT, PERMISSION_PENDING, RUN_GONE } from "./claude.ts";
import { forwardResult, type ForwardDeps } from "./forward.ts";
import type { Phase, RunRow } from "../shared/row.ts";

const T0 = 1_700_000_000_000;
const clock = { startedAt: T0, endedAt: T0 + 1000 };
const ok: Phase = { kind: "ok", ...clock };
const failed: Phase = { kind: "failed", ...clock, exitCode: 1, signal: null, message: null };
const stopped: Phase = { kind: "stopped", ...clock, exitCode: null, signal: "SIGINT" };
const stopping: Phase = { kind: "running", startedAt: T0, stopRequestedAt: T0 + 500 };
const interrupted: Phase = { kind: "interrupted", ...clock };

const row = (extra: Partial<RunRow> = {}): RunRow => ({
  runId: "r1", rev: 3, origin: "claude", command: "npm test", cwd: "/w", phase: ok, output: { lines: ["done"], total: 1 }, sentAt: null, ...extra,
});

function deps(options: { on?: (origin: RunRow["origin"]) => boolean; failWith?: Array<Error | undefined> } = {}) {
  const sent: string[] = [];
  const waited: number[] = [];
  const logged: string[] = [];
  let attempt = 0;
  const forward: ForwardDeps = {
    enabled: async (origin) => (options.on ? options.on(origin) : true),
    send: async (agentId, runId) => {
      const problem = options.failWith?.[attempt++];
      if (problem) throw problem;
      sent.push(`${agentId}:${runId}`);
    },
    wait: async (ms) => { waited.push(ms); },
    log: (message) => logged.push(message),
  };
  return { forward, sent, waited, logged };
}

test("a command the agent handed over is sent when Auto forward results is on, and a typed one is not", async () => {
  const d = deps({ on: (origin) => origin === "claude" });
  await forwardResult(d.forward, "a", row({ origin: "user" }));
  assert.deepEqual(d.sent, []);
  await forwardResult(d.forward, "a", row({ origin: "claude" }));
  assert.deepEqual(d.sent, ["a:r1"]);
});

test("a command you typed is sent only when Forward my own commands is on, and an agent's is not", async () => {
  const d = deps({ on: (origin) => origin === "user" });
  await forwardResult(d.forward, "a", row({ origin: "claude" }));
  assert.deepEqual(d.sent, []);
  await forwardResult(d.forward, "a", row({ origin: "user" }));
  assert.deepEqual(d.sent, ["a:r1"]);
});

test("the plain case is logged as sent", async () => {
  const d = deps();
  await forwardResult(d.forward, "a", row());
  assert.deepEqual(d.sent, ["a:r1"]);
  assert.deepEqual(d.logged, ["forward r1: sent"]);
});

test("a failure is sent too, since it is what the agent needs", async () => {
  const d = deps();
  await forwardResult(d.forward, "a", row({ phase: failed }));
  assert.deepEqual(d.sent, ["a:r1"]);
});

test("a command the user stopped is sent, immediately when Stop is pressed and again as a stopped row", async () => {
  const immediate = deps();
  await forwardResult(immediate.forward, "a", row({ phase: stopping }));
  assert.deepEqual(immediate.sent, ["a:r1"]);
  assert.deepEqual(immediate.logged, ["forward r1: sent"]);
  const ended = deps();
  await forwardResult(ended.forward, "a", row({ phase: stopped }));
  assert.deepEqual(ended.sent, ["a:r1"]);
});

test("a command that was interrupted, one still running normally, and one not started are not sent, and an interruption is logged", async () => {
  for (const phase of [interrupted, { kind: "running", startedAt: T0, stopRequestedAt: null } as Phase, { kind: "proposed" } as Phase]) {
    const d = deps();
    await forwardResult(d.forward, "a", row({ phase }));
    assert.deepEqual(d.sent, [], phase.kind);
    assert.equal(d.logged.length, phase.kind === "interrupted" ? 1 : 0, phase.kind);
    if (phase.kind === "interrupted") assert.equal(d.logged[0], "forward r1: not sent, it was interrupted");
  }
});

test("a result that was sent already is not sent again, and says so", async () => {
  const d = deps();
  await forwardResult(d.forward, "a", row({ sentAt: T0 }));
  assert.deepEqual(d.sent, []);
  assert.equal(d.logged[0], "forward r1: not sent, it was sent already");
});

test("nothing is sent while the switch is off, and nothing is logged for every command", async () => {
  const d = deps({ on: () => false });
  await forwardResult(d.forward, "a", row());
  await forwardResult(d.forward, "a", row({ phase: stopped }));
  assert.deepEqual(d.sent, []);
  assert.deepEqual(d.logged, []);
});

test("a passing failure is tried again after a pause, and the retry is logged", async () => {
  const d = deps({ failWith: [new Error("agent not ready"), undefined] });
  await forwardResult(d.forward, "a", row());
  assert.deepEqual(d.sent, ["a:r1"]);
  assert.deepEqual(d.waited, [2_000]);
  assert.match(d.logged[0], /attempt 1 failed \(agent not ready\); trying again in 2s/);
  assert.equal(d.logged[1], "forward r1: sent");
});

test("it gives up after the last pause and says why", async () => {
  const d = deps({ failWith: [new Error("boom"), new Error("boom"), new Error("boom"), new Error("boom")] });
  await forwardResult(d.forward, "a", row());
  assert.deepEqual(d.sent, []);
  assert.deepEqual(d.waited, [2_000, 5_000, 10_000]);
  assert.equal(d.logged.at(-1), "forward r1: not sent: boom");
});

test("a permission wait, a possible earlier send and a gone run are final: never retried, so never sent twice", async () => {
  for (const message of [PERMISSION_PENDING, MAYBE_SENT, RUN_GONE]) {
    const d = deps({ failWith: [new Error(message), undefined] });
    await forwardResult(d.forward, "a", row());
    assert.deepEqual(d.sent, [], message);
    assert.deepEqual(d.waited, [], message);
    assert.equal(d.logged[0], `forward r1: not sent: ${message}`);
  }
});

test("turning the setting off during a pause stops the retries", async () => {
  let on = true;
  const d = deps({ on: () => on, failWith: [new Error("boom")] });
  d.forward.wait = async () => { on = false; };
  await forwardResult(d.forward, "a", row());
  assert.deepEqual(d.sent, []);
});

test("the stop announced at once and the end that follows send the result only once", async () => {
  const d = deps();
  const sending = new Set<string>();
  d.forward.sending = sending;
  let started!: () => void;
  let finish!: () => void;
  const begun = new Promise<void>((resolve) => { started = resolve; });
  const done = new Promise<void>((resolve) => { finish = resolve; });
  d.forward.send = async (_agentId, runId) => {
    d.sent.push(runId);
    started();
    await done;
  };

  const immediate = forwardResult(d.forward, "a", row({ phase: stopping }));
  await begun;
  await forwardResult(d.forward, "a", row({ phase: stopped }));
  assert.equal(d.logged.at(-1), "forward r1: not sent, it is being sent");
  finish();
  await immediate;
  assert.deepEqual(d.sent, ["r1"]);
  assert.equal(d.logged.at(-1), "forward r1: sent");
  assert.equal(sending.size, 0);
});
