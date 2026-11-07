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
  }),
});
