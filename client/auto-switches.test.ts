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
// test can render one by calling it and walk the elements it returns.
function load() {
  const h = clientHarness(directory, {
    "react-native": { Platform: { OS: "web" }, View: "View", Text: "Text", Pressable: "Pressable", Switch: "Switch" },
    "@getpaseo/plugin/client": { useSettings: () => ({ status: "loading" }) },
    "@getpaseo/plugin/client/ui": { Icon: "Icon" },
  });
  return h.load("client/auto-switches.tsx");
}

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

test("inside Pill hub the footer still shows only the settings button, with no shell options", () => {
  const { HostedAutoSwitches } = load();
  let opened = 0;
  const element = HostedAutoSwitches({ colors: COLORS, compact: true, openSettings: () => (opened += 1) }) as Element;
  const buttons = findAll(element, "Button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.label, "Auto-run settings");
  assert.equal(buttons[0].props.accessibilityLabel, "Open the automatic run settings");
  assert.equal(findAll(element, "ShellChoice").length, 0);
  assert.equal(findAll(element, "ShellOption").length, 0);
  buttons[0].props.onPress();
  assert.equal(opened, 1);
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
});
