import { useSettings } from "@getpaseo/plugin/client";
import React, { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { LIMITS } from "../shared/limits.ts";
import { settingsRead } from "../shared/rpc.ts";
import { autoRunSettings } from "../shared/settings.ts";
import { autoCaption } from "../shared/view.ts";
import { createHostedSettings, hostSettingsReset, hostSettingsWrite, type AutoRunState, type AutoRunValues, type HostedSettings } from "./host-settings.ts";
import { withAlpha, type ThemeColors } from "./palette.ts";
import { useHostedClient, useRpc } from "./hub-compat.tsx";
import { Button } from "./ui.tsx";

export const AUTO_RUN_SETTINGS_ID = "auto-run";

type Shell = AutoRunValues["shell"];
type Handoff = AutoRunValues["handoff"];

interface AutoSwitchesProps {
  colors: ThemeColors;
  compact: boolean;
  showShell?: boolean;
  showHandoff?: boolean;
}

// The shell a Windows command runs in. Both options save the same host-wide document the
// switches below save, so the settings screen and this footer always agree.
const SHELLS: readonly { value: Shell; label: string; hint: string }[] = [
  { value: "powershell", label: "PowerShell", hint: "PowerShell takes the command as an encoded script." },
  { value: "cmd", label: "Command Prompt", hint: "Command Prompt takes the command as typed." },
];

// How much the injected prompt asks an agent to hand over. Same document, same agreement.
const HANDOFFS: readonly { value: Handoff; label: string; hint: string }[] = [
  { value: "suggest", label: "Suggest", hint: "The agent runs other commands itself." },
  { value: "everything", label: "Everything", hint: "The agent sends every command through Shell Yeah." },
];

// The Run window's footer: the shell for every command, whether the agent's commands start on
// their own, whether their results go back on their own, and how much the agent hands over. All of
// it is one host-wide setting the server reads, so a choice here applies to every chat and takes
// effect for the next reply.
//
// Settings belong to the plugin that owns them, so inside the Pill hub `useSettings` would read the
// hub's settings rather than ours. There the footer reads through an RPC instead, which reaches
// this plugin's backend even under the hub; every control works in both places.
export function AutoSwitches({ colors, compact, showShell = true, showHandoff = true }: AutoSwitchesProps) {
  const hosted = useHostedClient();
  if (!hosted) return <LiveAutoSwitches colors={colors} compact={compact} showShell={showShell} showHandoff={showHandoff} />;
  return (
    <HostedAutoSwitches
      colors={colors}
      compact={compact}
      showShell={showShell}
      showHandoff={showHandoff}
      openSettings={() => hosted.openSettings(AUTO_RUN_SETTINGS_ID)}
    />
  );
}

// The hub's footer: the same controls as anywhere else, fed by this plugin's own client.
function HostedAutoSwitches({ colors, compact, showShell, showHandoff, openSettings }: AutoSwitchesProps & { openSettings(): void }) {
  const read = useRpc(settingsRead);
  const write = useRpc(hostSettingsWrite);
  const reset = useRpc(hostSettingsReset);
  // The controller outlives a render, so it calls whatever the current render's RPCs are.
  const calls = useRef({ read, write, reset });
  calls.current = { read, write, reset };
  const settings = useRef<HostedSettings | null>(null);
  if (!settings.current) {
    settings.current = createHostedSettings({
      read: () => calls.current.read({}),
      write: (input) => calls.current.write(input),
      reset: (input) => calls.current.reset(input),
    });
  }
  const store = settings.current;
  const snapshot = useCallback(() => store.state, [store]);
  const state = useSyncExternalStore(store.subscribe, snapshot, snapshot);
  useEffect(() => {
    void store.load();
  }, [store]);
  return <AutoSwitchesFooter settings={state} colors={colors} compact={compact} showShell={showShell} showHandoff={showHandoff} openSettings={openSettings} />;
}

function LiveAutoSwitches({ colors, compact, showShell, showHandoff }: AutoSwitchesProps) {
  const settings = useSettings(autoRunSettings);
  return <AutoSwitchesFooter settings={settings} colors={colors} compact={compact} showShell={showShell} showHandoff={showHandoff} />;
}

// The footer's states and its ready view, with the hooks kept above so a test can render it.
export function AutoSwitchesFooter({
  settings,
  colors,
  compact,
  showShell = true,
  showHandoff = true,
  openSettings,
}: {
  settings: AutoRunState;
  colors: ThemeColors;
  compact: boolean;
  showShell?: boolean;
  showHandoff?: boolean;
  // Only a hosted footer has one, and only after a read failed: it is the way back to the settings
  // screen when the RPC that carries the controls cannot be reached.
  openSettings?(): void;
}) {
  const muted = { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 };
  const divider = { borderTopWidth: 1, borderTopColor: withAlpha(colors.border, 0.6), paddingTop: 10, gap: 4 };

  if (settings.status === "loading") return null;
  if (settings.status !== "ready") {
    return (
      <View style={divider}>
        <Text style={muted}>{settings.error}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button icon="RefreshCw" label="Reload" tone="ghost" onPress={() => void settings.reload()} compact={compact} colors={colors} accessibilityLabel="Reload the automatic run settings" />
          {settings.status === "invalid" ? <Button icon="RotateCcw" label="Reset" tone="ghost" onPress={() => void settings.reset()} compact={compact} colors={colors} accessibilityLabel="Reset the automatic run settings to off" /> : null}
          {settings.status === "error" && openSettings ? <Button icon="Settings2" label="Open settings" tone="ghost" onPress={openSettings} compact={compact} colors={colors} accessibilityLabel="Open the settings screen, because these controls could not be read" /> : null}
        </View>
      </View>
    );
  }

  const { run, send, own } = settings.values;
  const caption = autoCaption(run, send, own, LIMITS.autoRunsPerHour);
  // Every save here carries the whole document through, so a choice in one control leaves the other
  // four exactly as they were read.
  const save = (next: Partial<AutoRunValues>) => void settings.save({ ...settings.values, ...next }, settings.revision);
  return (
    <View style={divider}>
      {showShell ? <ShellChoice value={settings.values.shell} saving={settings.saving} colors={colors} compact={compact} onChoose={(shell) => save({ shell })} /> : null}
      <Row label="Auto-run" value={run} disabled={settings.saving} colors={colors} compact={compact} onChange={(value) => save({ run: value })} />
      <Row label="Auto forward results" value={send} disabled={settings.saving} colors={colors} compact={compact} onChange={(value) => save({ send: value })} />
      <Row label="Forward my own commands" value={own} disabled={settings.saving} colors={colors} compact={compact} onChange={(value) => save({ own: value })} />
      <Text style={{ ...muted, color: caption.tone === "warning" ? colors.statusWarning : colors.foregroundMuted }}>{caption.text}</Text>
      {showHandoff ? <HandoffChoice value={settings.values.handoff} saving={settings.saving} colors={colors} compact={compact} onChoose={(handoff) => save({ handoff })} /> : null}
      {settings.saveError ? <Text style={{ ...muted, color: colors.statusDanger }}>{settings.saveError}</Text> : null}
    </View>
  );
}

// The shell is short enough to sit on one line with its label, and the two options are named the
// way an operator names them. The one-sentence difference lives in each option's hint, since the
// footer has no room for another paragraph.
function ShellChoice({ value, saving, colors, compact, onChoose }: { value: Shell; saving: boolean; colors: ThemeColors; compact: boolean; onChoose(shell: Shell): void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, fontWeight: "500" }}>Shell</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Shell" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {SHELLS.map((option) => (
          <ShellOption key={option.value} option={option} selected={value === option.value} saving={saving} colors={colors} compact={compact} onChoose={onChoose} />
        ))}
      </View>
    </View>
  );
}

// How much an agent hands over is a choice between two words an operator can weigh, so it gets the
// same row as the shell, and the difference between them stays in the hint.
function HandoffChoice({ value, saving, colors, compact, onChoose }: { value: Handoff; saving: boolean; colors: ThemeColors; compact: boolean; onChoose(handoff: Handoff): void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, fontWeight: "500" }}>Agent handoff</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Agent handoff" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {HANDOFFS.map((option) => (
          <HandoffOption key={option.value} option={option} selected={value === option.value} saving={saving} colors={colors} compact={compact} onChoose={onChoose} />
        ))}
      </View>
    </View>
  );
}

// A radio large enough for a thumb, with the theme's accent as its ring: the border and fill mark
// the selected option, and focus adds an outline so a keyboard user can see where they are. Disabled
// while a save is in flight, with the current value still readable.
function radioStyle(state: { pressed: boolean; focused?: boolean }, selected: boolean, saving: boolean, colors: ThemeColors, compact: boolean) {
  return {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: compact ? 6 : 8,
    justifyContent: "center" as const,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: selected ? colors.accent : withAlpha(colors.border, 0.9),
    backgroundColor: state.pressed ? withAlpha(colors.border, 0.6) : selected ? withAlpha(colors.accent, 0.16) : "transparent",
    opacity: saving ? 0.5 : 1,
    ...(state.focused ? { outlineColor: colors.accent, outlineWidth: 2, outlineOffset: 2 } : null),
  };
}

function ShellOption({ option, selected, saving, colors, compact, onChoose }: { option: { value: Shell; label: string; hint: string }; selected: boolean; saving: boolean; colors: ThemeColors; compact: boolean; onChoose(shell: Shell): void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Shell: ${option.label}`}
      accessibilityHint={option.hint}
      aria-checked={selected}
      aria-disabled={saving}
      disabled={saving}
      onPress={() => {
        if (!selected) onChoose(option.value);
      }}
      style={(state: { pressed: boolean; focused?: boolean }) => radioStyle(state, selected, saving, colors, compact)}
    >
      <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: selected ? "600" : "400" }}>{option.label}</Text>
    </Pressable>
  );
}

function HandoffOption({ option, selected, saving, colors, compact, onChoose }: { option: { value: Handoff; label: string; hint: string }; selected: boolean; saving: boolean; colors: ThemeColors; compact: boolean; onChoose(handoff: Handoff): void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Agent handoff: ${option.label}`}
      accessibilityHint={option.hint}
      aria-checked={selected}
      aria-disabled={saving}
      disabled={saving}
      onPress={() => {
        if (!selected) onChoose(option.value);
      }}
      style={(state: { pressed: boolean; focused?: boolean }) => radioStyle(state, selected, saving, colors, compact)}
    >
      <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: selected ? "600" : "400" }}>{option.label}</Text>
    </Pressable>
  );
}

function Row({ label, value, disabled, colors, compact, onChange }: { label: string; value: boolean; disabled: boolean; colors: ThemeColors; compact: boolean; onChange(value: boolean): void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: compact ? 4 : 1 }}>
      <Pressable accessible={false} focusable={false} disabled={disabled} onPress={() => onChange(!value)} style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{label}</Text>
      </Pressable>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: withAlpha(colors.border, 0.9), true: colors.accent }}
        thumbColor="#ffffff"
      />
    </View>
  );
}
