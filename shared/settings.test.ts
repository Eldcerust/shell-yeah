import assert from "node:assert/strict";
import { test } from "node:test";
import { autoRunSettings } from "./settings.ts";

test("the handoff setting defaults to suggest, and an older document still validates", () => {
  assert.equal(autoRunSettings.schema.parse({}).handoff, "suggest");
  assert.equal(autoRunSettings.schema.parse({ run: true, send: true, own: true }).handoff, "suggest", "a document from before the key");
  assert.equal(autoRunSettings.schema.parse({ handoff: "everything" }).handoff, "everything");
  assert.equal(autoRunSettings.schema.safeParse({ handoff: "always" }).success, false, "only the two modes");
  assert.equal(autoRunSettings.schema.parse({}).shell, "powershell", "the round-17 choice keeps its default");
  assert.equal(autoRunSettings.scope, "host");
  assert.equal(autoRunSettings.version, 1);
});
