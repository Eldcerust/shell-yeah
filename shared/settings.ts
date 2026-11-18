import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// Both off until the user turns them on. With `run` on, a reply from an agent starts a command
// on this computer, as the user, without a click; with `send` on, the result goes back to the
// agent without a click, which can start its next turn. Host-scoped, so they apply to every chat.
export const autoRunSettings = defineSettings({
  id: "auto-run",
  scope: "host",
  version: 1,
  schema: z.object({
    // Start the commands an agent hands over as soon as its reply ends.
    run: z.boolean().default(false),
    // Send the output of a command the agent handed over back to it when it finishes, or the
    // moment you stop it.
    send: z.boolean().default(false),
    // The same for a command the user typed (/sh or the Run window's box). Separate, because
    // what one of those prints is the user's own business until they say otherwise.
    own: z.boolean().default(false),
    // The shell a Windows command runs in: "powershell" (the default) or "cmd". PowerShell takes
    // the command as an encoded script, Command Prompt takes it as typed. Host-scoped, like the
    // rest, so every chat runs commands the same way. An older saved document has no `shell` and
    // the default fills it in, so the version stays 1.
    shell: z.enum(["powershell", "cmd"]).default("powershell"),
    // How the injected prompt asks an agent to hand commands over. "suggest" (the default) tells it
    // to run everything else itself; "everything" tells it every command goes through Shell Yeah.
    handoff: z.enum(["suggest", "everything"]).default("suggest"),
  }),
});
