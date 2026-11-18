import { defineRpc } from "@getpaseo/plugin";
import type { SettingsState } from "@getpaseo/plugin/client";
import { z } from "zod";
import { autoRunWriteResult, autoRunState } from "../shared/rpc.ts";
import { autoRunSettings } from "../shared/settings.ts";

export type AutoRunState = SettingsState<typeof autoRunSettings.schema>;
export type AutoRunValues = Extract<AutoRunState, { status: "ready" }>["values"];
export type AutoRunRead = z.output<typeof autoRunState>;
export type AutoRunWriteResult = z.output<typeof autoRunWriteResult>;

// The host's own settings methods, declared with the host's names and shapes because a popover the
// Pill hub hosts can only reach them through this plugin's client (see hub-compat.tsx). The daemon
// registers them itself when index.server.ts registers the definition, on this plugin's RPC
// surface, and its settings store is the only writer: a save carries the revision it read and a
// stale one comes back `conflict` instead of landing. Nothing here re-implements that rule, so the
// footer and the settings screen cannot disagree about what a save means.
export const hostSettingsWrite = defineRpc({
  name: "settings.auto-run.write",
  input: z.object({ revision: z.string(), values: autoRunSettings.schema }),
  output: autoRunWriteResult,
});

export const hostSettingsReset = defineRpc({
  name: "settings.auto-run.reset",
  input: z.object({ revision: z.string() }),
  output: autoRunWriteResult,
});

export interface HostedSettingsDeps {
  /** `shell-yeah.settings.read`: the document the run behaviour reads, with its revision. */
  read(): Promise<AutoRunRead>;
  /** `settings.auto-run.write`: the host's revision-checked save. */
  write(input: { revision: string; values: AutoRunValues }): Promise<AutoRunWriteResult>;
  /** `settings.auto-run.reset`: the same save, with nothing in it. */
  reset(input: { revision: string }): Promise<AutoRunWriteResult>;
}

export interface HostedSettings {
  /** The shape `useSettings` returns, so one component renders both surfaces. */
  state: AutoRunState;
  subscribe(listener: () => void): () => void;
  /** Read the document once, at mount. */
  load(): Promise<void>;
}

// An RPC rejection can be an Error from another realm, a plain `{ message }` or a string, so read the
// message it carries rather than trusting `instanceof`.
function reason(error: unknown): string {
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message.length > 0 ? message : String(error);
}

// What the last read said. Kept apart from `saving` and `saveError` so a re-read cannot clear an
// error the operator has not seen yet, and so the values never blink away mid-save.
type Document =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "invalid"; revision: string; error: string }
  | { status: "ready"; revision: string; values: AutoRunValues };

// Reads and saves the auto-run document from a hosted popover. The states mirror `useSettings`:
// while a save is in flight the values stay on screen and every control is disabled; a refused save
// leaves its reason under the controls; a stale revision re-reads instead of retrying, so the
// operator sees the value that won rather than silently overwriting it.
export function createHostedSettings(deps: HostedSettingsDeps): HostedSettings {
  const listeners = new Set<() => void>();
  let document: Document = { status: "loading" };
  let saving = false;
  let saveError: string | null = null;
  let state: AutoRunState = { ...document, saving, saveError, save, reset, reload };

  function publish(): void {
    state = { ...document, saving, saveError, save, reset, reload } as AutoRunState;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[shell-yeah] settings listener failed", error);
      }
    }
  }

  function receive(result: AutoRunWriteResult): boolean {
    if (result.status === "saved") {
      document = { status: "ready", values: result.values, revision: result.revision };
      saving = false;
      publish();
      return true;
    }
    saving = false;
    saveError = result.error;
    publish();
    return false;
  }

  async function send(write: () => Promise<AutoRunWriteResult>): Promise<boolean> {
    if (saving) return false;
    saving = true;
    saveError = null;
    publish();
    try {
      const result = await write();
      const saved = receive(result);
      // Someone else saved first: show why, then re-read the document that won. The write is not
      // repeated, because repeating it would need a revision this client has not seen.
      if (result.status === "conflict") await load();
      return saved;
    } catch (error) {
      saving = false;
      saveError = reason(error);
      publish();
      return false;
    }
  }

  async function save(values: AutoRunValues, revision: string): Promise<boolean> {
    return send(() => deps.write({ revision, values }));
  }

  async function reset(): Promise<boolean> {
    if (document.status !== "ready" && document.status !== "invalid") return false;
    const revision = document.revision;
    return send(() => deps.reset({ revision }));
  }

  async function load(): Promise<void> {
    let next: Document;
    try {
      const result = await deps.read();
      next =
        result.status === "ready"
          ? { status: "ready", values: result.values, revision: result.revision }
          : { status: "invalid", revision: result.revision, error: result.error };
    } catch (error) {
      next = { status: "error", error: reason(error) };
    }
    document = next;
    publish();
  }

  async function reload(): Promise<void> {
    await load();
  }

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
  };
}
