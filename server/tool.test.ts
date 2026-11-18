import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import contribute from "../index.server.ts";
import { SHELL_YEAH_TOOL_INPUT, SHELL_YEAH_TOOL_NAME, shellYeahTool } from "./tool.ts";

const where = { agentId: "agent-1", cwd: "C:\\work" };

function registry(outcome: { runId: string } | Error = { runId: "run-7" }) {
  const calls: unknown[] = [];
  return {
    calls,
    start: async (input: unknown) => {
      calls.push(input);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

test("the tool is named for an agent to call and takes a command plus an optional title", () => {
  const tool = shellYeahTool(registry(), where);
  assert.equal(tool.name, SHELL_YEAH_TOOL_NAME);
  assert.match(tool.name, /^[a-z][a-z0-9_]*$/, "the SDK's rule for a tool name");
  assert.doesNotMatch(tool.name, /[A-Z -]/, "no capital, space or hyphen");
  assert.equal(tool.title, "Run with Shell Yeah");
  assert.equal(typeof tool.description, "string");
  assert.ok(tool.description.length > 20 && !tool.description.includes("\n"), "one sentence");
  assert.deepEqual(SHELL_YEAH_TOOL_INPUT.parse({ command: "git status" }), { command: "git status" });
  assert.deepEqual(SHELL_YEAH_TOOL_INPUT.parse({ command: "ls", title: "List files" }), { command: "ls", title: "List files" });
  for (const bad of [{}, { command: "" }, { command: "ls", title: "" }, { command: 7 }]) {
    assert.equal(SHELL_YEAH_TOOL_INPUT.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("execute starts one run through the registry and returns at once with its id", async () => {
  const runs = registry({ runId: "run-7" });
  const tool = shellYeahTool(runs, where);
  const result = await tool.execute({ command: "git -C . status", title: "Status" }, {});
  assert.deepEqual(runs.calls, [{ agentId: "agent-1", cwd: "C:\\work", command: "git -C . status", origin: "claude" }]);
  assert.deepEqual(result, {
    status: "started",
    runId: "run-7",
    message: 'Started "Status" as run run-7. The output shows in the card; the user sends it to you if they choose.',
  });
});

test("a refused start comes back as a result, never a throw", async () => {
  const tool = shellYeahTool(registry(new Error("10 commands are already running. Stop one first.")), where);
  const result = await tool.execute({ command: "git clean -fd" }, {});
  assert.deepEqual(result, {
    status: "refused",
    runId: null,
    message: "Shell Yeah did not start the command: 10 commands are already running. Stop one first.",
  });
});

test("the session-open hook returns exactly one tool, named shell_yeah_run, and keeps the rest of the request", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "shell-yeah-tool-"));
  const original = { LOCALAPPDATA: process.env.LOCALAPPDATA, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.LOCALAPPDATA = sandbox;
  process.env.HOME = sandbox;
  process.env.USERPROFILE = sandbox;
  try {
    const before = new Map<string, (input: { request: any }, context: any) => unknown>();
    const server = {
      registerSettings: () => ({
        read: async () => ({ status: "ready", revision: "1", values: { run: false, send: false, own: false, shell: "powershell", handoff: "suggest" } }),
        subscribe: () => () => {},
      }),
      before: (name: string, handler: never) => { before.set(name, handler); return () => {}; },
      on: () => () => {},
      handle: () => {},
    };
    const cleanup = contribute(server as never);
    try {
      const open = before.get("agent.session_open");
      assert.ok(open, "the session-open hook is registered");
      const request = { agentId: "agent-1", workspaceId: "ws", provider: "pi", cwd: "C:\\work", reason: "create", purpose: "interactive", env: {} };
      const result = await open({ request }, {}) as typeof request & { tools: Array<{ name: string; input: unknown; execute: unknown }> };
      assert.equal(result.tools.length, 1, "exactly one tool");
      assert.equal(result.tools[0]!.name, SHELL_YEAH_TOOL_NAME);
      assert.equal(typeof (result.tools[0]!.input as { parse?: unknown }).parse, "function", "a zod input");
      assert.equal(typeof result.tools[0]!.execute, "function");
      assert.equal(result.agentId, "agent-1", "the rest of the request is kept");
      assert.equal(result.cwd, "C:\\work");
      assert.equal(result.provider, "pi");
    } finally {
      cleanup();
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("the create hook injects the handoff block for the mode the setting holds", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "shell-yeah-handoff-"));
  const original = { LOCALAPPDATA: process.env.LOCALAPPDATA, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.LOCALAPPDATA = sandbox;
  process.env.HOME = sandbox;
  process.env.USERPROFILE = sandbox;
  try {
    const before = new Map<string, (input: { request: any }, context: any) => Promise<unknown>>();
    let handoff = "suggest";
    const server = {
      registerSettings: () => ({
        read: async () => ({ status: "ready", revision: "1", values: { run: false, send: false, own: false, shell: "powershell", handoff } }),
        subscribe: () => () => {},
      }),
      before: (name: string, handler: never) => { before.set(name, handler); return () => {}; },
      on: () => () => {},
      handle: () => {},
    };
    const cleanup = contribute(server as never);
    try {
      const create = before.get("agent.create");
      assert.ok(create);
      const suggested = await create({ request: { config: { systemPrompt: "Be terse." } } }, {}) as { config: { systemPrompt: string } };
      assert.match(suggested.config.systemPrompt, /^Be terse\.\n\n<shell-yeah>/);
      assert.match(suggested.config.systemPrompt, /Run everything else yourself\./);
      handoff = "everything";
      const everything = await create({ request: { config: { systemPrompt: "Be terse." } } }, {}) as { config: { systemPrompt: string } };
      assert.doesNotMatch(everything.config.systemPrompt, /Run everything else yourself/);
      assert.match(everything.config.systemPrompt, /Every shell command must go through Shell Yeah/);
    } finally {
      cleanup();
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(sandbox, { recursive: true, force: true });
  }
});
