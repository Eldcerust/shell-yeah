import { useSettings } from "@getpaseo/plugin/client";
import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { LIMITS } from "../shared/limits.ts";
import { autoRunSettings } from "../shared/settings.ts";
import { autoCaption } from "../shared/view.ts";
import { withAlpha, type ThemeColors } from "./palette.ts";
import { Button } from "./ui.tsx";

// The Run window's footer: whether the agent's commands start on their own, and whether their
// results go back on their own. Both are one host-wide setting the server reads, so a switch
// here applies to every chat and takes effect for the next reply.
export function AutoSwitches({ colors, compact }: { colors: ThemeColors; compact: boolean }) {
  const settings = useSettings(autoRunSettings);
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

  const { run, send } = settings.values;
  const caption = autoCaption(run, send, LIMITS.autoRunsPerHour);
  const save = (next: { run: boolean; send: boolean }) => void settings.save(next, settings.revision);
  return (
    <View style={divider}>
      <Row label="Auto-run" value={run} disabled={settings.saving} colors={colors} compact={compact} onChange={(value) => save({ run: value, send })} />
      <Row label="Auto forward results" value={send} disabled={settings.saving} colors={colors} compact={compact} onChange={(value) => save({ run, send: value })} />
      <Text style={{ ...muted, color: caption.tone === "warning" ? colors.statusWarning : colors.foregroundMuted }}>{caption.text}</Text>
      {settings.saveError ? <Text style={{ ...muted, color: colors.statusDanger }}>{settings.saveError}</Text> : null}
    </View>
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
