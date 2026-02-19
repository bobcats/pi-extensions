/**
 * Confirm Before rm Extension
 *
 * Prompts for confirmation before any bash command containing `rm`.
 * Blocks automatically in non-interactive mode (no UI to confirm).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const rmPattern = /\brm\b/;

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = event.input.command as string;

    if (!rmPattern.test(command)) return undefined;

    if (!ctx.hasUI) {
      return { block: true, reason: "rm command blocked (no UI for confirmation)" };
    }

    const choice = await ctx.ui.select(
      `⚠️  This command uses rm:\n\n  ${command}\n\nAllow?`,
      ["Yes", "No"]
    );

    if (choice !== "Yes") {
      return { block: true, reason: "rm command blocked by user" };
    }

    return undefined;
  });
}
