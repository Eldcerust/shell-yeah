/*
 * Pill hub compat layer.
 *
 * Copy this file unchanged into a plugin's `client/` folder (the canonical copy lives in
 * paseo-pill-hub/compat). It lets that plugin follow the hub when one is running and fall back
 * to its own composer pill when not, using three small changes to the plugin:
 *
 *   1. Call `registerComposerPill(client, { toolId, agentId, workspaceId, button })` where
 *      the plugin called `client.addComposerPill({ id, agentId, workspaceId, button })`.
 *   2. In popover code, import `useRpc` / `usePaseo` (and any other plugin-scoped hook the
 *      popover uses) from this file instead of `@getpaseo/plugin/client`.
 *   3. Settings are scoped to the plugin that owns them, so a popover that reads or writes
 *      them with `useSettings` cannot do that from inside the hub. Branch on
 *      `useHostedClient()`: when it returns a client, show a link that calls
 *      `client.openSettings(id)` (register that screen with `addSettingsScreen`), or read
 *      the values through an RPC. When it returns null, behave as before.
 *
 * `toolId` must equal the pill id the plugin used before.
 *
 * Why step 2: a popover shown inside the hub is mounted under the hub's providers, so the
 * host's own `useRpc` would send the call to the hub's backend. Inside the hub these wrappers
 * call through the owning plugin's `client` object instead. Outside it they are the host hooks.
 */
import {
  useRpc as hostUseRpc,
  usePaseo as hostUsePaseo,
  type PluginButton,
  type PluginButtonContentProps,
  type PluginButtonIcon,
  type PluginButtonRegistration,
  type PluginClientContext,
} from "@getpaseo/plugin/client";
import React, { createContext, useContext, useMemo, type ComponentType } from "react";

// ---- Bus protocol: keep identical to paseo-pill-hub/client/bus.ts --------------------------
const BUS_KEY = "__paseoPillHub";
const BUS_VERSION = 1;

type HubContent = ComponentType<PluginButtonContentProps>;
interface ToolInfo {
  toolId: string;
  title: string;
  label: string;
  glyph?: string;
}
interface HubEntry extends ToolInfo {
  agentId: string;
  workspaceId: string;
  icon: PluginButtonIcon;
  Content: HubContent;
  visible?: boolean;
  disabled?: boolean;
}
type HubEntryPatch = Partial<Pick<HubEntry, "title" | "label" | "icon" | "Content" | "visible" | "disabled" | "glyph">>;
interface HubAttachment {
  update(patch: HubEntryPatch): void;
  remove(): void;
}
interface HubApi {
  merges(toolId: string): boolean;
  attach(entry: HubEntry): HubAttachment;
}
interface Bus {
  version: number;
  hub?: HubApi;
  tools: Map<string, ToolInfo>;
  listeners: Set<() => void>;
}

function carriers(): object[] {
  const shared: unknown = React;
  const list: object[] = [];
  if (shared !== null && (typeof shared === "object" || typeof shared === "function")) list.push(shared as object);
  list.push(globalThis);
  return list.filter((carrier) => Object.isExtensible(carrier));
}

function getBus(): Bus {
  const places = carriers();
  const existing = places.map((place) => (place as Record<string, Bus | undefined>)[BUS_KEY]).find(Boolean);
  if (existing) {
    if (existing.version === BUS_VERSION) return existing;
    return { version: BUS_VERSION, tools: new Map(), listeners: new Set() };
  }
  const created: Bus = { version: BUS_VERSION, tools: new Map(), listeners: new Set() };
  for (const place of places) {
    try {
      Object.defineProperty(place, BUS_KEY, { value: created, configurable: true, writable: true, enumerable: false });
    } catch {
      // A carrier that refuses the property is skipped; the others still carry the bus.
    }
  }
  return created;
}

function notify(bus: Bus): void {
  for (const listener of [...bus.listeners]) {
    try {
      listener();
    } catch (error) {
      console.error("[hub-compat] bus listener failed", error);
    }
  }
}
// ---- End of protocol -----------------------------------------------------------------------

interface Bridge {
  client: PluginClientContext;
}

const BridgeContext = createContext<Bridge | null>(null);

/** Wraps popover content so its hooks reach the owning plugin even when the hub hosts it. */
function hostedBy(Content: HubContent, client: PluginClientContext): HubContent {
  const bridge: Bridge = { client };
  return function HostedContent(props: PluginButtonContentProps) {
    return (
      <BridgeContext.Provider value={bridge}>
        <Content {...props} />
      </BridgeContext.Provider>
    );
  };
}

/** The plugin's `useRpc`: routed through its own `client` when the hub hosts the popover. */
export const useRpc: typeof hostUseRpc = (contract) => {
  const real = hostUseRpc(contract);
  const bridge = useContext(BridgeContext);
  return useMemo(
    () => (bridge ? (((input: never) => bridge.client.rpc(contract, input)) as unknown as typeof real) : real),
    [bridge, real, contract],
  );
};

/** The plugin's `usePaseo`: the owning plugin's client when the hub hosts the popover. */
export const usePaseo: typeof hostUsePaseo = () => {
  const real = hostUsePaseo();
  const bridge = useContext(BridgeContext);
  return bridge ? bridge.client.paseo : real;
};

/** The owning plugin's client while the hub hosts this component, otherwise null. */
export function useHostedClient(): PluginClientContext | null {
  return useContext(BridgeContext)?.client ?? null;
}

export interface ComposerPillSpec {
  /** The pill id the plugin used before. It names the tool in the hub's settings. */
  toolId: string;
  agentId: string;
  workspaceId: string;
  button: PluginButton;
  /** Lucide icon name for the hub's tab, for pills whose own icon is a component. */
  glyph?: string;
}

/**
 * Registers the plugin's composer pill, or hands its popover to the hub.
 *
 * Only popover pills can move into the hub; a menu or action pill always stays its own pill.
 * The hub can start, stop, or flip the tool's switch at any time: the pill moves each way
 * without the plugin doing anything. The result is a normal `PluginButtonRegistration`.
 */
export function registerComposerPill(client: PluginClientContext, spec: ComposerPillSpec): PluginButtonRegistration {
  const bus = getBus();
  const { toolId, agentId, workspaceId } = spec;
  let button = spec.button;
  let mode: "hub" | "own" | undefined;
  let placed: { remove(): void } | undefined;
  let hosted: { source: HubContent; wrapped: HubContent } | undefined;
  let removed = false;

  const popover = () => (button.behavior.kind === "popover" ? button.behavior.Content : undefined);

  function hostedContent(source: HubContent): HubContent {
    if (hosted?.source !== source) hosted = { source, wrapped: hostedBy(source, client) };
    return hosted.wrapped;
  }

  function entryPatch(Content: HubContent): Required<Pick<HubEntry, "title" | "label" | "icon" | "Content">> &
    Pick<HubEntry, "visible" | "disabled"> {
    return {
      title: button.title,
      label: button.label ?? button.title,
      icon: button.icon,
      Content: hostedContent(Content),
      visible: button.visible,
      disabled: button.disabled,
    };
  }

  function place() {
    if (removed) return;
    const hub = bus.hub;
    const Content = popover();
    const want = hub && Content && hub.merges(toolId) ? "hub" : "own";
    if (want === mode) return;
    placed?.remove();
    placed = undefined;
    mode = want;
    if (hub && Content && want === "hub") {
      placed = hub.attach({ toolId, agentId, workspaceId, glyph: spec.glyph, ...entryPatch(Content) });
    } else {
      placed = client.addComposerPill({ id: toolId, workspaceId, agentId, button });
    }
  }

  if (!bus.tools.has(toolId)) {
    bus.tools.set(toolId, { toolId, title: spec.button.title, label: spec.button.label ?? spec.button.title, glyph: spec.glyph });
    notify(bus);
  }
  bus.listeners.add(place);
  place();

  return {
    update(patch) {
      if (removed) return;
      const wasPopover = popover() !== undefined;
      button = { ...button, ...patch };
      const Content = popover();
      if ((Content !== undefined) !== wasPopover) {
        // Behavior moved between popover and something else, which decides where the pill may live.
        placed?.remove();
        placed = undefined;
        mode = undefined;
        place();
        return;
      }
      if (mode === "hub" && Content) (placed as HubAttachment).update(entryPatch(Content));
      else (placed as PluginButtonRegistration).update(patch);
    },
    remove() {
      if (removed) return;
      removed = true;
      bus.listeners.delete(place);
      placed?.remove();
      placed = undefined;
    },
  };
}
