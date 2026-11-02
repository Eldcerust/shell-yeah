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
            hint="When an agent hands you a command in a Run card, start it as soon as the reply ends instead of waiting for you to press Run. Several commands in one reply run one after another and stop at the first that fails. They run on this computer as you, with no confirmation, so only turn this on for agents you trust with it. At most 20 start per chat an hour. Off by default."
            value={settings.values.run}
            disabled={settings.saving}
            onValueChange={(run) => void settings.save({ ...settings.values, run }, settings.revision)}
          />
          <SettingsSwitch
            label="Send the result to the agent"
            hint="When commands started that way finish, send their output back to the agent, as the Send button does, so it can carry on without you. A failure is sent too; one you stopped is not. The agent may answer with its next command, which Run commands automatically then starts. Off by default."
            error={settings.saveError}
            value={settings.values.send}
            disabled={settings.saving}
            onValueChange={(send) => void settings.save({ ...settings.values, send }, settings.revision)}
          />
        </SettingsCard>
      ) : (
        <>
          <Text style={muted}>{settings.error}</Text>
          <SettingsCard>
            <SettingsAction label="Try again" actionLabel="Reload" onPress={settings.reload} />
            {settings.status === "invalid" ? (
              <SettingsAction label="Reset to the defaults (both off)" actionLabel="Reset" onPress={settings.reset} />
            ) : null}
          </SettingsCard>
        </>
      )}
    </SettingsSection>
  );
}
