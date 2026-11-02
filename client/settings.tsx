import { Text } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { autoRunSettings } from "../shared/settings.ts";

export function ShellYeahSettings({ theme }: Pick<PluginSurfaceProps, "theme">) {
  const settings = useSettings(autoRunSettings);
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 };
  return (
    <SettingsSection title="Commands from the agent">
      {settings.status === "loading" ? (
        <Text style={muted}>Loading settings…</Text>
      ) : settings.status === "ready" ? (
        <SettingsCard>
          <SettingsSwitch
            label="Run commands automatically"
            hint="When an agent hands you a command in a Run card, start it as soon as the reply ends instead of waiting for you to press Run. Several commands in one reply run one after another and stop at the first that fails. They run on this computer as you, with no confirmation, so only turn this on for agents you trust with it. Off by default."
            error={settings.saveError}
            value={settings.values.enabled}
            disabled={settings.saving}
            onValueChange={(enabled) => void settings.save({ ...settings.values, enabled }, settings.revision)}
          />
        </SettingsCard>
      ) : (
        <>
          <Text style={muted}>{settings.error}</Text>
          <SettingsCard>
            <SettingsAction label="Try again" actionLabel="Reload" onPress={settings.reload} />
            {settings.status === "invalid" ? (
              <SettingsAction label="Reset to the default (off)" actionLabel="Reset" onPress={settings.reset} />
            ) : null}
          </SettingsCard>
        </>
      )}
    </SettingsSection>
  );
}
