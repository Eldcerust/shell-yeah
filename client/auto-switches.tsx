import { useSettings, type SettingsState } from "@getpaseo/plugin/client";
import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { LIMITS } from "../shared/limits.ts";
import { autoRunSettings } from "../shared/settings.ts";
import { autoCaption } from "../shared/view.ts";
import { withAlpha, type ThemeColors } from "./palette.ts";
import { useHostedClient } from "./hub-compat.tsx";
import { Button } from "./ui.tsx";

export const AUTO_RUN_SETTINGS_ID = "auto-run";

type AutoRunState = SettingsState<typeof autoRunSettings.schema>;
type AutoRunValues = Extract<AutoRunState, { status: "ready" }>["values"];
type Shell = AutoRunValues["shell"];

// The shell a Windows command runs in. Both options save the same host-wide document the
// switches below save, so the settings screen and this footer always agree.
const SHELLS: readonly { value: Shell; label: string; hint: string }[] = [
  { value: "powershell", label: "PowerShell", hint: "PowerShell takes the command as an encoded script." },
  { value: "cmd", label: "Command Prompt", hint: "Command Prompt takes the command as typed." },
];

// The Run window's footer: the shell for every command, whether the agent's commands start on
// their own, and whether their results go back on their own. All of it is one host-wide setting
// the server reads, so a choice here applies to every chat and takes effect for the next reply.
//
// Settings belong to the plugin that owns them, so inside the Pill hub this footer cannot edit
// them. It links to the plugin's own settings screen instead.
export function AutoSwitches({ colors, compact, showShell = true }: { colors: ThemeColors; compact: boolean; showShell?: boolean }) {
  const hosted = useHostedClient();
  if (!hosted) return <LiveAutoSwitches colors={colors} compact={compact} showShell={showShell} />;
  return <HostedAutoSwitches colors={colors} compact={compact} openSettings={() => hosted.openSettings(AUTO_RUN_SETTINGS_ID)} />;
}

// The hub's footer: one button, because a hosted plugin can't write another plugin's settings.
export function HostedAutoSwitches({ colors, compact, openSettings }: { colors: ThemeColors; compact: boolean; openSettings(): void }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: withAlpha(colors.border, 0.6), paddingTop: 10 }}>
      <Button icon="Settings2" label="Auto-run settings" tone="ghost" onPress={openSettings} compact={compact} colors={colors} accessibilityLabel="Open the automatic run settings" />
    </View>
  );
}

function LiveAutoSwitches({ colors, compact, showShell }: { colors: ThemeColors; compact: boolean; showShell: boolean }) {
  const settings = useSettings(autoRunSettings);
  return <AutoSwitchesFooter settings={settings} colors={colors} compact={compact} showShell={showShell} />;
}

// The footer's states and its ready view, with the hooks kept above so a test can render it.
export function AutoSwitchesFooter({ settings, colors, compact, showShell = true }: { settings: AutoRunState; colors: ThemeColors; compact: boolean; showShell?: boolean }) {
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
        </View>
      </View>
    );
  }

  const { run, send, own } = settings.values;
  const caption = autoCaption(run, send, own, LIMITS.autoRunsPerHour);
  // The handoff choice lives on the settings screen; every save here carries it through.
  const save = (next: Partial<AutoRunValues>) => void settings.save({ ...settings.values, ...next }, settings.revision);
  return (
    <View style={divider}>
      {showShell ? <ShellChoice value={settings.values.shell} saving={settings.saving} colors={colors} compact={compact} onChoose={(shell) => save({ shell })} /> : null}
      <Row label="Auto-run" value={run} disabled={settings.saving} colors={colors} compact={compact} onChange={(value) => save({ run: value })} />
      <Row label="Auto forward results" value={send} disabled={settings.saving} colors={colors} compact={compact} onChange={(value) => save({ send: value })} />
      <Row label="Forward my own commands" value={own} disabled={settings.saving} colors={colors} compact={compact} onChange={(value) => save({ own: value })} />
      <Text style={{ ...muted, color: caption.tone === "warning" ? colors.statusWarning : colors.foregroundMuted }}>{caption.text}</Text>
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

// A radio large enough for a thumb, with the theme's accent as its ring: the border and fill mark
// the selected option, and focus adds an outline so a keyboard user can see where they are.
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
      style={(state: { pressed: boolean; focused?: boolean }) => ({
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 12,
        paddingVertical: compact ? 6 : 8,
        justifyContent: "center",
        borderRadius: 6,
        borderWidth: 1,
        borderColor: selected ? colors.accent : withAlpha(colors.border, 0.9),
        backgroundColor: state.pressed ? withAlpha(colors.border, 0.6) : selected ? withAlpha(colors.accent, 0.16) : "transparent",
        opacity: saving ? 0.5 : 1,
        ...(state.focused ? { outlineColor: colors.accent, outlineWidth: 2, outlineOffset: 2 } : null),
      })}
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
