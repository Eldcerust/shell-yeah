import type { PluginServerContext, PluginSettings } from "@getpaseo/plugin/server";
import { settingsRead } from "../shared/rpc.ts";
import type { autoRunSettings } from "../shared/settings.ts";

type AutoRunSchema = typeof autoRunSettings.schema;

// The Run window's footer can be shown inside Pill hub, where `useSettings` reads the hub's
// document rather than this plugin's. This is the read it uses instead: the same handle the run
// behaviour reads, so the footer can never show a value the server won't act on, and the revision
// it hands back is the one a write has to carry.
//
// There is no write here on purpose. `registerSettings` returns a handle with `read` and
// `subscribe` only; the daemon keeps the document and answers `settings.auto-run.write` on this
// plugin's RPC surface itself, comparing the revision on disk, so the footer's save cannot step
// over the settings screen's save and neither surface needs its own copy.
export function registerSettingsRpc(server: Pick<PluginServerContext, "handle">, settings: PluginSettings<AutoRunSchema>): void {
  server.handle(settingsRead, () => settings.read());
}
