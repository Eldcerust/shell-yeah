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
const interrupted: Phase = { kind: "interrupted", ...clock };

const row = (extra: Partial<RunRow> = {}): RunRow => ({
  runId: "r1", rev: 3, origin: "claude", command: "npm test", cwd: "/w", phase: ok, output: { lines: ["done"], total: 1 }, sentAt: null, ...extra,
});

function deps(options: { on?: () => boolean; failWith?: Array<Error | undefined> } = {}) {
  const sent: string[] = [];
  const waited: number[] = [];
  const logged: string[] = [];
  let attempt = 0;
  const forward: ForwardDeps = {
    enabled: async () => (options.on ? options.on() : true),
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

test("a command the agent handed over that finished is sent, whether or not Auto-run started it", async () => {
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

test("a command the user stopped, one that was interrupted, and one still running are not sent", async () => {
  for (const phase of [stopped, interrupted, { kind: "running", startedAt: T0, stopRequestedAt: null } as Phase, { kind: "proposed" } as Phase]) {
    const d = deps();
    await forwardResult(d.forward, "a", row({ phase }));
    assert.deepEqual(d.sent, [], phase.kind);
  }
});

test("a command the user typed is not sent, and neither is one that was sent already", async () => {
  const d = deps();
  await forwardResult(d.forward, "a", row({ origin: "user" }));
  await forwardResult(d.forward, "a", row({ sentAt: T0 }));
  assert.deepEqual(d.sent, []);
});

test("nothing is sent while the setting is off", async () => {
  const d = deps({ on: () => false });
  await forwardResult(d.forward, "a", row());
  assert.deepEqual(d.sent, []);
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
