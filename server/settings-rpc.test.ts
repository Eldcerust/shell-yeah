import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginServerContext, PluginSettings } from "@getpaseo/plugin/server";
import { registerSettingsRpc } from "./settings-rpc.ts";
import { settingsRead } from "../shared/rpc.ts";
import { autoRunSettings } from "../shared/settings.ts";

type AutoRunSchema = typeof autoRunSettings.schema;
type State = Awaited<ReturnType<PluginSettings<AutoRunSchema>["read"]>>;

const document = { run: true, send: false, own: true, shell: "cmd", handoff: "everything" } as const;

// The server as the plugin sees it: `handle` records each method the daemon would advertise, so a
// test calls the RPC exactly as the popover's client would.
function contribution(settings: PluginSettings<AutoRunSchema>) {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const server = {
    handle(contract: { name: string }, handler: (input: unknown) => unknown) {
      handlers.set(contract.name, handler);
    },
  };
  registerSettingsRpc(server as unknown as Pick<PluginServerContext, "handle">, settings);
  const call = async (method: string, input: unknown = {}) => {
    const handler = handlers.get(method);
    assert.ok(handler, `${method} is handled`);
    return handler(input);
  };
  return { handlers, call };
}

function handle(read: PluginSettings<AutoRunSchema>["read"]): PluginSettings<AutoRunSchema> {
  return { read, subscribe: () => () => undefined };
}

test("settings.read answers with the stored document and the revision a write must carry", async () => {
  const { handlers, call } = contribution(handle(async () => ({ status: "ready" as const, revision: "rev-7", values: document })));
  assert.deepEqual([...handlers.keys()], ["shell-yeah.settings.read"], "one method, the plugin's own");
  const result = await call("shell-yeah.settings.read");
  assert.deepEqual(result, { status: "ready", revision: "rev-7", values: document });
  // What the popover is handed parses against the shipped contract, so the shapes cannot drift.
  assert.deepEqual(settingsRead.output.parse(result), { status: "ready", revision: "rev-7", values: document });
});

test("an unreadable document comes back invalid, with the revision a reset needs", async () => {
  const { call } = contribution(handle(async () => ({ status: "invalid" as const, revision: "rev-3", error: "The settings document is damaged." })));
  const result = await call("shell-yeah.settings.read");
  assert.deepEqual(result, { status: "invalid", revision: "rev-3", error: "The settings document is damaged." });
  assert.deepEqual(settingsRead.output.parse(result), { status: "invalid", revision: "rev-3", error: "The settings document is damaged." });
});

test("every read goes back to the handle, so a footer sees what another surface saved", async () => {
  let state: State = { status: "ready", revision: "rev-1", values: document };
  let reads = 0;
  const { call } = contribution(
    handle(async () => {
      reads += 1;
      return state;
    }),
  );
  assert.deepEqual(await call("shell-yeah.settings.read"), state);
  state = { status: "ready", revision: "rev-2", values: { ...document, shell: "powershell" } };
  assert.deepEqual(await call("shell-yeah.settings.read"), state, "no cached copy stands in for the document");
  assert.equal(reads, 2);
});
