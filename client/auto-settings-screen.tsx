import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import React from "react";
import { View } from "react-native";
import { AutoSwitches } from "./auto-switches.tsx";

// The same switches as the Run window's footer, on Paseo's Settings page. It is where the footer
// sends you when the Run window is shown inside the Pill hub.
export function AutoRunSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  return (
    <View style={{ padding: layout.compact ? 16 : 24 }}>
      <AutoSwitches colors={theme.colors} compact={layout.compact} />
    </View>
  );
}
