import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import React from "react";
import { clientHarness } from "../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

const COLORS = {
  surface0: "#18181b",
  surface1: "#1f1f23",
  surface2: "#27272a",
  border: "#3f3f46",
  foreground: "#f4f4f5",
  foregroundMuted: "#a1a1aa",
  accent: "#e4e4e7",
  accentForeground: "#18181b",
  statusSuccess: "#6cb17b",
  statusWarning: "#c09664",
  statusDanger: "#d8847b",
};

type Values = { run: boolean; send: boolean; own: boolean; shell: "powershell" | "cmd"; handoff: "suggest" | "everything" };
type Element = React.ReactElement<Record<string, any>>;

// The footer and its children are plain functions: no hooks and no host components to mount, so a
// test can render one by calling it and walk the elements it returns. The hosted footer's data path
// is a plain controller for the same reason, so its RPC conversation can be driven directly.
function load() {
  const h = clientHarness(directory, {
    "react-native": { Platform: { OS: "web" }, View: "View", Text: "Text", Pressable: "Pressable", Switch: "Switch" },
    "@getpaseo/plugin/client": { useSettings: () => ({ status: "loading" }) },
    "@getpaseo/plugin/client/ui": { Icon: "Icon" },
  });
  return { ...h.load("client/auto-switches.tsx"), hosted: h.load("client/host-settings.ts") };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function nameOf(element: React.ReactElement): string | undefined {
  if (typeof element.type === "string") return element.type;
  return typeof element.type === "function" ? (element.type as { name?: string }).name : undefined;
}

function childrenOf(node: React.ReactNode): Element[] {
  if (!React.isValidElement(node)) return [];
  const props = node.props as { children?: React.ReactNode };
  return React.Children.toArray(props.children).filter((child): child is Element => React.isValidElement(child));
}

function findAll(node: React.ReactNode, name: string, found: Element[] = []): Element[] {
  for (const child of childrenOf(node)) {
    if (nameOf(child) === name) found.push(child);
    if (typeof child.type === "string") findAll(child, name, found);
  }
  return found;
}

function render(element: Element): Element {
  return (element.type as (props: Record<string, unknown>) => React.ReactNode)(element.props) as Element;
}

function textOf(element: React.ReactElement): string | undefined {
  const props = element.props as { children?: unknown };
  return typeof props.children === "string" ? props.children : undefined;
}

function ready(overrides: Partial<Values> = {}) {
  const saves: { values: Values; revision: string }[] = [];
  const settings = {
    status: "ready" as const,
    values: { run: false, send: true, own: false, shell: "powershell", handoff: "suggest", ...overrides } as Values,
    revision: "rev-7",
    saving: false,
    saveError: null,
    save: (values: Values, revision: string) => {
      saves.push({ values, revision });
      return Promise.resolve(true);
    },
    reset: () => Promise.resolve(true),
    reload: () => Promise.resolve(),
  };
  return { settings, saves };
}

function footer(element: Element) {
  const [choice] = findAll(element, "ShellChoice");
  assert.ok(choice, "the footer renders a shell choice");
  const view = render(choice);
  const options = findAll(view, "ShellOption");
  return { view, options };
}

function optionView(options: Element[], value: Values["shell"]): Element {
  const option = options.find((candidate) => candidate.props.option.value === value);
  assert.ok(option, `the ${value} option renders`);
  return render(option);
}

// The stored document and the methods that serve it, with the rule the daemon applies: a write
// carries the revision it read, and a stale one is answered `conflict`, never applied. Each request
// records the name of the RPC it would have travelled on.
const STALE = "Settings changed on another client. Reload before saving again.";

function stored(overrides: Partial<Values> = {}, revision = "rev-1") {
  let values: Values = { run: false, send: false, own: false, shell: "powershell", handoff: "suggest", ...overrides };
  let rev = revision;
  let versions = Number(revision.slice("rev-".length)) || 1;
  const requests: { name: string; input: any }[] = [];
  const commit = (next: Values) => {
    values = next;
    rev = `rev-${++versions}`;
  };
  return {
    requests,
    values: () => ({ ...values }),
    revision: () => rev,
    // The settings screen, or another chat, saves first: the revision on disk moves on.
    elsewhere(next: Partial<Values>) {
      commit({ ...values, ...next });
    },
    // A save that fails before it reaches the document, as an unreachable daemon would.
    failure: null as Error | null,
    async read() {
      requests.push({ name: "shell-yeah.settings.read", input: {} });
      return { status: "ready" as const, revision: rev, values: { ...values } };
    },
    async write(input: { revision: string; values: Values }) {
      requests.push({ name: "settings.auto-run.write", input: plain(input) });
      if (this.failure) throw this.failure;
      if (input.revision !== rev) return { status: "conflict" as const, error: STALE };
      commit({ ...input.values });
      return { status: "saved" as const, revision: rev, values: { ...values } };
    },
    async reset(input: { revision: string }) {
      requests.push({ name: "settings.auto-run.reset", input: plain(input) });
      if (input.revision !== rev) return { status: "conflict" as const, error: STALE };
      commit({ run: false, send: false, own: false, shell: "powershell", handoff: "suggest" });
      return { status: "saved" as const, revision: rev, values: { ...values } };
    },
  };
}

type Store = ReturnType<typeof stored>;
type Settings = { state: any; load(): Promise<void> };

async function hosted(store: Store): Promise<{ settings: Settings; render(): Element; store: Store }> {
  const { AutoSwitchesFooter, hosted: controller } = load();
  const settings: Settings = controller.createHostedSettings(store);
  await settings.load();
  return {
    settings,
    store,
    render: () => AutoSwitchesFooter({ settings: settings.state, colors: COLORS, compact: true }) as Element,
  };
}

function radios(element: Element, group: "ShellChoice" | "HandoffChoice", name: "ShellOption" | "HandoffOption"): Element[] {
  const [choice] = findAll(element, group);
  assert.ok(choice, `the footer renders ${group}`);
  return findAll(render(choice), name);
}

const labels = (options: Element[]) => options.map((option) => option.props.option.label);

function dangerText(element: Element): string[] {
  return findAll(element, "Text")
    .filter((text) => (text.props.style as { color?: string } | undefined)?.color === COLORS.statusDanger)
    .map(textOf)
    .filter((text): text is string => typeof text === "string");
}

test("the Run window's footer names both shells above the switches", () => {
  const { AutoSwitchesFooter } = load();
  const { settings } = ready();
  const element = AutoSwitchesFooter({ settings, colors: COLORS, compact: false }) as Element;
  assert.ok(React.isValidElement(element));
  const top = childrenOf(element);
  assert.equal(nameOf(top[0]), "ShellChoice", "the shell choice sits above the switches");
  assert.equal(top.filter((child) => nameOf(child) === "Row").length, 3, "the three switches follow it");
  const { view, options } = footer(element);
  const labels = findAll(view, "Text").map(textOf);
  for (const option of options) labels.push(...findAll(render(option), "Text").map(textOf));
  assert.deepEqual(labels.filter(Boolean), ["Shell", "PowerShell", "Command Prompt"]);
  assert.deepEqual(options.map((option) => option.props.option.label), ["PowerShell", "Command Prompt"]);
});

test("the option matching settings.values.shell is marked selected, with a 44 px target and a focus ring", () => {
  const { AutoSwitchesFooter } = load();
  const { settings } = ready({ shell: "cmd" });
  const element = AutoSwitchesFooter({ settings, colors: COLORS, compact: false }) as Element;
  const { options } = footer(element);
  assert.deepEqual(options.map((option) => option.props.selected), [false, true]);

  for (const option of options) {
    const view = render(option);
    assert.equal(view.type, "Pressable");
    assert.equal(view.props.accessibilityRole, "radio");
    assert.equal(view.props["aria-checked"], option.props.selected, "the selected state is announced");
    assert.equal(typeof view.props.accessibilityHint, "string", "the one-sentence difference is available");
    const base = view.props.style({ pressed: false, focused: false });
    assert.ok(base.minHeight >= 44 && base.minWidth >= 44, "both targets are at least 44 px");
    assert.equal(base.outlineWidth, undefined, "no ring until focused");
    const focused = view.props.style({ pressed: false, focused: true });
    assert.equal(focused.outlineWidth, 2, "focus is visible");
    assert.equal(focused.outlineColor, COLORS.accent);
  }
});

test("pressing the other shell saves once and leaves run, send and own alone", () => {
  const { AutoSwitchesFooter } = load();
  const { settings, saves } = ready({ run: true, send: false, own: true, shell: "powershell" });
  const element = AutoSwitchesFooter({ settings, colors: COLORS, compact: false }) as Element;
  const { options } = footer(element);

  optionView(options, "cmd").props.onPress();
  assert.deepEqual(plain(saves), [{ values: { run: true, send: false, own: true, shell: "cmd", handoff: "suggest" }, revision: "rev-7" }]);

  optionView(options, "powershell").props.onPress();
  assert.equal(saves.length, 1, "pressing the selected shell saves nothing");
});

test("inside Pill hub the footer renders all five controls from the read, not a link", async () => {
  const view = await hosted(stored({ shell: "cmd", handoff: "everything" }));
  assert.deepEqual(view.store.requests.map((request) => request.name), ["shell-yeah.settings.read"], "the controls are fed by this plugin's RPC");
  const element = view.render();
  assert.deepEqual(
    childrenOf(element).filter((child) => nameOf(child) === "Row").map((row) => row.props.label),
    ["Auto-run", "Auto forward results", "Forward my own commands"],
  );
  const shells = radios(element, "ShellChoice", "ShellOption");
  const handoffs = radios(element, "HandoffChoice", "HandoffOption");
  assert.deepEqual(labels(shells), ["PowerShell", "Command Prompt"]);
  assert.deepEqual(labels(handoffs), ["Suggest", "Everything"]);
  assert.deepEqual(shells.map((option) => option.props.selected), [false, true], "the stored shell is the selected one");
  assert.deepEqual(handoffs.map((option) => option.props.selected), [false, true], "and so is the stored handoff");
  assert.equal(findAll(element, "Button").length, 0, "no settings link stands in for a control");
});

test("choosing Command Prompt in the hosted footer writes once through the RPC, with the revision it read", async () => {
  const view = await hosted(stored({ run: true, send: true, own: true }));
  optionView(radios(view.render(), "ShellChoice", "ShellOption"), "cmd").props.onPress();
  await settle();
  assert.deepEqual(view.store.requests.map((request) => request.name), ["shell-yeah.settings.read", "settings.auto-run.write"]);
  assert.deepEqual(view.store.requests[1].input, { revision: "rev-1", values: { run: true, send: true, own: true, shell: "cmd", handoff: "suggest" } });
  assert.equal(view.settings.state.saving, false);
  assert.equal(view.settings.state.status, "ready");
  assert.equal(view.settings.state.values.shell, "cmd", "the saved document is what the footer shows next");
  assert.notEqual(view.settings.state.revision, "rev-1", "and the save moved the revision on");
});

test("a stale revision is refused, shown, and re-read: the newer setting survives", async () => {
  const view = await hosted(stored({ shell: "powershell" }));
  // The settings screen saves first, so the footer's revision is now one behind.
  view.store.elsewhere({ shell: "cmd" });

  optionView(radios(view.render(), "ShellChoice", "ShellOption"), "cmd").props.onPress();
  await settle();

  assert.deepEqual(view.store.requests.map((request) => request.name), ["shell-yeah.settings.read", "settings.auto-run.write", "shell-yeah.settings.read"], "the write is not retried; the document is re-read");
  assert.deepEqual(view.store.requests[1].input, { revision: "rev-1", values: { run: false, send: false, own: false, shell: "cmd", handoff: "suggest" } });
  assert.equal(view.store.revision(), "rev-2", "the stale write never landed");
  assert.deepEqual(view.store.values(), { run: false, send: false, own: false, shell: "cmd", handoff: "suggest" }, "the stored document is the one the other surface saved");
  assert.equal(view.settings.state.saveError, STALE, "the refusal is visible");
  assert.equal(view.settings.state.saving, false, "and the controls are usable again");
  assert.equal(view.settings.state.values.shell, "cmd", "the footer now shows the value that won");

  const element = view.render();
  assert.deepEqual(dangerText(element), [STALE], "the reason sits under the controls");
  assert.deepEqual(radios(element, "ShellChoice", "ShellOption").map((option) => option.props.selected), [false, true]);

  // A second press saves against the revision that was re-read, so the document moves on for real.
  optionView(radios(element, "ShellChoice", "ShellOption"), "powershell").props.onPress();
  await settle();
  assert.deepEqual(view.store.requests[3], { name: "settings.auto-run.write", input: { revision: "rev-2", values: { run: false, send: false, own: false, shell: "powershell", handoff: "suggest" } } });
  assert.equal(view.store.values().shell, "powershell");
  assert.equal(view.settings.state.saveError, null);
});

test("a save in flight disables every control and keeps the values on screen", async () => {
  const { AutoSwitchesFooter, hosted: controller } = load();
  const store = stored({ send: true, shell: "cmd" });
  let finish: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => (finish = resolve));
  const settings: Settings = controller.createHostedSettings({
    read: store.read,
    write: async () => {
      await pending;
      return { status: "saved" as const, revision: "rev-9", values: { run: false, send: true, own: false, shell: "cmd", handoff: "suggest" } };
    },
    reset: store.reset,
  });
  await settings.load();
  const saving = settings.state.save({ run: false, send: true, own: false, shell: "cmd", handoff: "suggest" }, "rev-1");
  await settle();

  const element = AutoSwitchesFooter({ settings: settings.state, colors: COLORS, compact: true }) as Element;
  assert.equal(settings.state.saving, true);
  assert.deepEqual(childrenOf(element).filter((child) => nameOf(child) === "Row").map((row) => row.props.disabled), [true, true, true]);
  assert.deepEqual(radios(element, "ShellChoice", "ShellOption").map((option) => render(option).props["aria-disabled"]), [true, true]);
  assert.deepEqual(radios(element, "HandoffChoice", "HandoffOption").map((option) => render(option).props["aria-disabled"]), [true, true]);
  assert.deepEqual(radios(element, "ShellChoice", "ShellOption").map((option) => option.props.selected), [false, true], "the value stays visible while it saves");

  finish({});
  assert.equal(await saving, true);
  assert.equal(settings.state.saving, false);
  assert.equal(settings.state.revision, "rev-9");
});

test("a failed save shows its reason and leaves the controls usable for a retry", async () => {
  const view = await hosted(stored({ handoff: "suggest" }));
  view.store.failure = new Error("Paseo isn't connected yet.");
  const everything = radios(view.render(), "HandoffChoice", "HandoffOption").find((option) => option.props.option.value === "everything");
  assert.ok(everything);
  render(everything).props.onPress();
  await settle();

  assert.equal(view.settings.state.saveError, "Paseo isn't connected yet.");
  assert.equal(view.settings.state.saving, false);
  assert.deepEqual(dangerText(view.render()), ["Paseo isn't connected yet."]);
  assert.deepEqual(radios(view.render(), "HandoffChoice", "HandoffOption").map((option) => render(option).props["aria-disabled"]), [false, false], "nothing stays disabled");

  view.store.failure = null;
  render(radios(view.render(), "HandoffChoice", "HandoffOption").find((option) => option.props.option.value === "everything")!).props.onPress();
  await settle();
  assert.equal(view.store.values().handoff, "everything");
  assert.equal(view.settings.state.saveError, null);
});

test("outside Pill hub the footer still reads with useSettings and renders the same five controls", () => {
  const source = readFileSync(new URL("../client/auto-switches.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/useSettings\(/g) ?? []).length, 1, "one settings hook, on the non-hosted path only");
  const live = source.slice(source.indexOf("function LiveAutoSwitches"), source.indexOf("function LiveAutoSwitches") + 320);
  assert.match(live, /useSettings\(autoRunSettings\)/, "the hook is the non-hosted branch's");
  assert.match(source, /useRpc\(settingsRead\)/, "the hosted branch reads through this plugin's RPC");
  assert.match(source, /useRpc\(hostSettingsWrite\)/, "and saves through the host's revision-checked write");
  assert.doesNotMatch(source, /Auto-run settings/, "the hosted link is gone, not standing in for a control");
});

test("loading renders nothing, a read error offers Reload, and an invalid document adds Reset", () => {
  const { AutoSwitchesFooter } = load();
  assert.equal(AutoSwitchesFooter({ settings: { status: "loading", saving: false, saveError: null }, colors: COLORS, compact: false }), null);

  const failure = { status: "error" as const, error: "Couldn't read the settings.", saving: false, saveError: null, save: () => Promise.resolve(true), reset: () => Promise.resolve(true), reload: () => Promise.resolve() };
  const errorView = AutoSwitchesFooter({ settings: failure, colors: COLORS, compact: false }) as Element;
  assert.deepEqual(findAll(errorView, "Text").map(textOf), ["Couldn't read the settings."]);
  assert.deepEqual(findAll(errorView, "Button").map((button) => button.props.label), ["Reload"]);

  const invalid = { status: "invalid" as const, error: "The settings document is damaged.", revision: "rev-3", saving: false, saveError: null, save: () => Promise.resolve(true), reset: () => Promise.resolve(true), reload: () => Promise.resolve() };
  const invalidView = AutoSwitchesFooter({ settings: invalid, colors: COLORS, compact: false }) as Element;
  assert.deepEqual(findAll(invalidView, "Text").map(textOf), ["The settings document is damaged."]);
  assert.deepEqual(findAll(invalidView, "Button").map((button) => button.props.label), ["Reload", "Reset"]);
});

// The settings screen renders its own labelled "Shell on Windows" control, so it hides the footer's.
// Two controls for one setting is how they drift apart.
test("showShell false hides the footer's shell choice, and the settings screen passes it", () => {
  const { AutoSwitchesFooter } = load();
  const { settings } = ready();
  const hidden = AutoSwitchesFooter({ settings, colors: COLORS, compact: false, showShell: false }) as Element;
  const top = childrenOf(hidden);
  assert.equal(top.filter((child) => nameOf(child) === "ShellChoice").length, 0, "no shell choice when the screen owns it");
  assert.equal(top.filter((child) => nameOf(child) === "Row").length, 3, "the three switches stay");
  const screen = readFileSync(new URL("../client/auto-settings-screen.tsx", import.meta.url), "utf8");
  assert.match(screen, /showShell=\{false\}/, "the settings screen hides the duplicate");
  assert.match(screen, /showHandoff=\{false\}/, "and the handoff duplicate the footer now carries too");
});
