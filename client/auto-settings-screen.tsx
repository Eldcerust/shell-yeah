import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { autoRunSettings } from "../shared/settings.ts";
import { withAlpha, type ThemeColors } from "./palette.ts";
import { AutoSwitches } from "./auto-switches.tsx";

// The same switches as the Run window's footer, on Paseo's Settings page. It is where the footer
// sends you when the Run window is shown inside the Pill hub. The two choices below live here and
// nowhere else: they apply to every command and every new agent, and the footer is only about
// starting and sending.
export function AutoRunSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  return (
    <View style={{ padding: layout.compact ? 16 : 24, gap: 14 }}>
      {/* The screen owns the labelled Shell on Windows and Agent handoff controls below, so the
          footer hides its own. Two controls for one setting is how they drift apart. */}
      <AutoSwitches colors={theme.colors} compact={layout.compact} showShell={false} showHandoff={false} />
      <Choices colors={theme.colors} compact={layout.compact} />
    </View>
  );
}

const SHELLS = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "Command Prompt" },
] as const;

const HANDOFFS = [
  { value: "suggest", label: "Suggest" },
  { value: "everything", label: "Everything" },
] as const;

// The shell a Windows command runs in, and how much the prompt asks an agent to hand over. Both are
// one host-wide setting the server reads, so a choice here applies to every chat. The hint under
// each states the difference in one sentence, because the labels alone can't.
function Choices({ colors, compact }: { colors: ThemeColors; compact: boolean }) {
  const settings = useSettings(autoRunSettings);
  if (settings.status === "loading") return null;
  if (settings.status !== "ready") {
    return (
      <View style={{ borderTopWidth: 1, borderTopColor: withAlpha(colors.border, 0.6), paddingTop: 10 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>{settings.error}</Text>
      </View>
    );
  }

  const save = (next: Partial<typeof settings.values>) => void settings.save({ ...settings.values, ...next }, settings.revision);
  const saving = settings.saving;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: withAlpha(colors.border, 0.6), paddingTop: 10, gap: 14 }}>
      <Choice
        label="Shell on Windows"
        hint="PowerShell takes the command as an encoded script. Command Prompt takes the command as typed."
        options={SHELLS}
        value={settings.values.shell}
        saving={saving}
        colors={colors}
        compact={compact}
        onChoose={(shell) => save({ shell: shell as typeof settings.values.shell })}
      />
      <Choice
        label="Agent handoff"
        hint="Suggest lets the agent run other commands itself. Everything asks it to send every command through Shell Yeah."
        options={HANDOFFS}
        value={settings.values.handoff}
        saving={saving}
        colors={colors}
        compact={compact}
        onChoose={(handoff) => save({ handoff: handoff as typeof settings.values.handoff })}
      />
      {settings.saveError ? <Text style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 16 }}>{settings.saveError}</Text> : null}
    </View>
  );
}

function Choice({ label, hint, options, value, saving, colors, compact, onChoose }: {
  label: string;
  hint: string;
  options: readonly { value: string; label: string }[];
  value: string;
  saving: boolean;
  colors: ThemeColors;
  compact: boolean;
  onChoose(choice: string): void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${option.label}`}
              aria-checked={selected}
              aria-disabled={saving}
              disabled={saving}
              onPress={() => {
                if (!selected) onChoose(option.value);
              }}
              style={({ pressed }) => ({
                minHeight: 44, minWidth: 44, paddingHorizontal: 14, paddingVertical: compact ? 6 : 8, justifyContent: "center",
                borderRadius: 6, borderWidth: 1,
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: pressed ? colors.surface2 : selected ? withAlpha(colors.accent, 0.16) : colors.surface1,
                opacity: saving ? 0.5 : 1,
              })}
            >
              <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: selected ? "600" : "400" }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>{hint}</Text>
    </View>
  );
}
