import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// Off until the user turns it on: with it on, a reply from an agent starts a command on
// this computer, as the user, without a click. Host-scoped, so it applies to every chat.
export const autoRunSettings = defineSettings({
  id: "auto-run",
  scope: "host",
  version: 1,
  schema: z.object({ enabled: z.boolean().default(false) }),
});
