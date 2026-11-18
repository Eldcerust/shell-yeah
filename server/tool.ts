import { z } from "zod";
import { errorMessage } from "../shared/text.ts";
import type { RunRegistry } from "./runs.ts";

// The name an agent calls. The SDK's rule for a tool name: a lower-case letter first, then lower-case
// letters, digits and underscores.
export const SHELL_YEAH_TOOL_NAME = "shell_yeah_run";

// The plugin SDK this fork pins is 0.13, which has no `defineAgentTool` and no `tools` on the
// session-open request; the daemon's agent.open.before guard does accept tools. This is the shape
// 0.14's helper produces, written out so the tool can be typed here.
export interface AgentToolDefinition {
  name: string;
  title?: string;
  description: string;
  input: z.ZodType;
  execute(input: unknown, context: unknown): Promise<ToolResult>;
}

export type ToolResult =
  | { status: "started"; runId: string; message: string }
  | { status: "refused"; runId: null; message: string };

export const SHELL_YEAH_TOOL_INPUT = z.object({
  // The command as the user would type it in their own shell.
  command: z.string().min(1),
  // A few plain words for the card's title. The run row has no title field, so it is echoed back
  // in the result rather than stored.
  title: z.string().min(1).max(120).optional(),
});

// A tool that hands a command to the same registry the Run button uses, and returns at once: the
// command runs as the user, and its output shows in the chat card the agent just made. A refused
// start (a limit, a full queue, a folder that is gone) comes back as a result, never a throw, so the
// agent reads it and can tell the user.
export function shellYeahTool(runs: Pick<RunRegistry, "start">, where: { agentId: string; cwd: string }): AgentToolDefinition {
  return {
    name: SHELL_YEAH_TOOL_NAME,
    title: "Run with Shell Yeah",
    description: "Run a shell command as the user, in their folder, with the output in this chat. Starts the run and returns at once with its id; the user decides what the agent sees.",
    input: SHELL_YEAH_TOOL_INPUT,
    async execute(raw: unknown): Promise<ToolResult> {
      const input = SHELL_YEAH_TOOL_INPUT.parse(raw);
      const named = input.title ? `"${input.title}"` : "the command";
      try {
        const { runId } = await runs.start({ agentId: where.agentId, cwd: where.cwd, command: input.command, origin: "claude" });
        return { status: "started", runId, message: `Started ${named} as run ${runId}. The output shows in the card; the user sends it to you if they choose.` };
      } catch (error) {
        return { status: "refused", runId: null, message: `Shell Yeah did not start ${named}: ${errorMessage(error)}` };
      }
    },
  };
}
