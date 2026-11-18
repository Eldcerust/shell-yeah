import assert from "node:assert/strict";
import { test } from "node:test";
import { autoRunSettings } from "../shared/settings.ts";
import { encodePowerShell, shellCommand } from "./shells.ts";

const WINDOWS: NodeJS.Platform = "win32";
const LINUX: NodeJS.Platform = "linux";
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const PROMPT = "C:\\Windows\\system32\\cmd.exe";

// A PATH with nothing on it, so PowerShell resolution falls back to the one Windows ships.
function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { SystemRoot: "C:\\Windows", PATH: "C:\\nowhere", ComSpec: PROMPT, ...extra };
}

test("powershell mode on Windows keeps the encoded-script argv", () => {
  const command = "Get-ChildItem | Where-Object { $_.Name -eq \"a&b\" }";
  assert.deepEqual(shellCommand(env(), command, WINDOWS, "powershell"), {
    file: POWERSHELL,
    args: ["-NoLogo", "-NoProfile", "-EncodedCommand", encodePowerShell(command)],
  });
});

test("the mode argument defaults to PowerShell, so a caller that passes none is unchanged", () => {
  const command = "git status --short";
  assert.deepEqual(shellCommand(env(), command, WINDOWS), shellCommand(env(), command, WINDOWS, "powershell"));
});

test("cmd mode on Windows hands the command to ComSpec as one argument after /d /s /c", () => {
  const command = "git status --short | findstr \"a&b\"";
  assert.deepEqual(shellCommand(env(), command, WINDOWS, "cmd"), { file: PROMPT, args: ["/d", "/s", "/c", command] });
});

test("cmd mode without ComSpec uses the Command Prompt in System32", () => {
  assert.equal(shellCommand(env({ ComSpec: "" }), "dir", WINDOWS, "cmd").file, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(shellCommand({ SystemRoot: "C:\\Windows" }, "dir", WINDOWS, "cmd").file, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(shellCommand(env({ ComSpec: "  " }), "dir", WINDOWS, "cmd").file, "C:\\Windows\\System32\\cmd.exe");
});

test("a command with quotes, a pipe and an ampersand reaches the launcher unchanged, in one argv element", () => {
  const command = "echo \"a|b\" & dir c:\\temp && git status";
  const cmd = shellCommand(env(), command, WINDOWS, "cmd");
  assert.equal(cmd.args.length, 4);
  assert.deepEqual(cmd.args, ["/d", "/s", "/c", command]);
  assert.equal(cmd.args[3], command, "byte for byte, no quoting added");
  // PowerShell carries it inside the encoded script instead, and it survives the round trip.
  const powershell = shellCommand(env(), command, WINDOWS, "powershell");
  assert.equal(powershell.args.length, 4);
  assert.ok(Buffer.from(powershell.args[3]!, "base64").toString("utf16le").includes(command));
});

test("POSIX is the same in both modes: the login shell with -c and the command", () => {
  const command = "ls \"a|b\" & echo done";
  const powershell = shellCommand({ SHELL: "/bin/bash" }, command, LINUX, "powershell");
  const cmd = shellCommand({ SHELL: "/bin/bash" }, command, LINUX, "cmd");
  assert.deepEqual(powershell, cmd);
  assert.deepEqual(powershell.args, ["-c", command]);
});

test("the shell setting defaults to powershell and keeps older documents valid", () => {
  assert.equal(autoRunSettings.schema.parse({}).shell, "powershell");
  assert.equal(autoRunSettings.schema.parse({ run: true, send: true, own: true }).shell, "powershell");
  assert.equal(autoRunSettings.schema.parse({ shell: "cmd" }).shell, "cmd");
  assert.deepEqual(autoRunSettings.schema.parse({}), { run: false, send: false, own: false, shell: "powershell", handoff: "suggest" });
});
