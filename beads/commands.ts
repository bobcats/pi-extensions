import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  formatIssueLabel,
  parseBrReadyJson,
  type ExecResult,
  type UiContext,
  type NotifyContext,
} from "./lib.ts";

export interface BeadsState {
  isBeadsProject: boolean;
  beadsEnabled: boolean;
  shouldPrime: boolean;
  contextReminderShown: boolean;
  cachedModeText: string;
  // V1: Rich recovery stores
  currentIssueId: string | null;
  editedFiles: Map<string, Set<string>>;
  checkpointState: { lastCheckpointTurn: number; turnIndex: number };
  autoContinuePending: boolean;
}

export function registerBeadsCommands(
  pi: ExtensionAPI,
  deps: {
    state: BeadsState;
    runBr(args: string[], timeout?: number): Promise<ExecResult>;
    commandOut(ctx: NotifyContext, message: string, level?: "info" | "warning" | "error"): void;
    summarizeExecFailure(result: ExecResult): string;
    refreshBeadsStatus(ctx: UiContext): Promise<void>;
    maybeNudgeCommitAfterClose(ctx: NotifyContext): Promise<string | null>;
  },
) {
  const { state } = deps;

  const setBeadsMode = async (
    enabled: boolean,
    ctx: UiContext & NotifyContext,
  ) => {
    state.beadsEnabled = enabled;
    state.shouldPrime = state.beadsEnabled;
    state.contextReminderShown = false;

    if (state.beadsEnabled && state.isBeadsProject) {
      state.cachedModeText = "";
    }

    await deps.refreshBeadsStatus(ctx);
  };

  pi.registerCommand("beads", {
    description: "Interactive beads picker with quick issue actions",
    handler: async (args, ctx) => {
      const readyResult = await deps.runBr(["ready", "--sort", "priority", "--json"]);
      if (readyResult.code !== 0) {
        deps.commandOut(ctx, `beads ready failed: ${deps.summarizeExecFailure(readyResult)}`, "error");
        return;
      }

      let issues = parseBrReadyJson(readyResult.stdout);
      const filter = args.trim().toLowerCase();
      if (filter) {
        issues = issues.filter((issue) => `${issue.id} ${issue.title}`.toLowerCase().includes(filter));
      }

      if (!ctx.hasUI) {
        if (!issues.length) {
          process.stdout.write("No ready issues.\n");
          return;
        }
        process.stdout.write(`${issues.map((issue) => `${issue.id} ${issue.title}`).join("\n")}\n`);
        return;
      }

      if (!issues.length) {
        ctx.ui.notify(filter ? `No ready issues match \"${filter}\".` : "No ready issues.", "info");
        return;
      }

      const labels = issues.map((issue) => formatIssueLabel(issue));
      const pickedLabel = await ctx.ui.select("Choose beads issue", labels);
      if (!pickedLabel) {
        return;
      }

      const index = labels.indexOf(pickedLabel);
      if (index < 0) {
        ctx.ui.notify("Issue selection failed.", "error");
        return;
      }
      const issue = issues[index];

      while (true) {
        const action = await ctx.ui.select(`Issue ${issue.id}: ${issue.title}`, [
          "Work on this issue",
          "Show details",
          "Add checkpoint comment",
          "Close issue",
          "Back",
        ]);

        if (!action || action === "Back") {
          return;
        }

        if (action === "Work on this issue") {
          const claim = await deps.runBr(["update", issue.id, "--status", "in_progress"]);
          if (claim.code !== 0) {
            ctx.ui.notify(`Failed to claim ${issue.id}: ${deps.summarizeExecFailure(claim)}`, "error");
            continue;
          }

          await deps.refreshBeadsStatus(ctx);

          ctx.ui.setEditorText(
            [
              `Work on beads issue ${issue.id}: ${issue.title}`,
              "- Follow @test-driven-development",
              "- Verify with @verification-before-completion",
            ].join("\n"),
          );
          ctx.ui.notify(`Claimed ${issue.id}; prompt prefilled in editor.`, "info");
          return;
        }

        if (action === "Show details") {
          const details = await deps.runBr(["show", issue.id]);
          if (details.code !== 0) {
            ctx.ui.notify(`Failed to show ${issue.id}: ${deps.summarizeExecFailure(details)}`, "error");
            continue;
          }

          const keyLines = details.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 10)
            .join("\n");

          ctx.ui.notify(keyLines || `No details available for ${issue.id}.`, "info");
          continue;
        }

        if (action === "Add checkpoint comment") {
          const comment = await ctx.ui.editor(
            `Checkpoint comment for ${issue.id}`,
            "Progress update:\n-\n\nNext:\n-",
          );

          if (!comment?.trim()) {
            ctx.ui.notify("No comment added.", "warning");
            continue;
          }

          const commentResult = await deps.runBr(["comments", "add", issue.id, comment]);
          if (commentResult.code !== 0) {
            ctx.ui.notify(`Failed to add comment: ${deps.summarizeExecFailure(commentResult)}`, "error");
            continue;
          }

          ctx.ui.notify(`Added checkpoint comment to ${issue.id}.`, "info");
          continue;
        }

        if (action === "Close issue") {
          const reason = await ctx.ui.input(`Close reason for ${issue.id}`, "Verified: completed and tested");
          if (!reason?.trim()) {
            ctx.ui.notify("Close cancelled: reason is required.", "warning");
            continue;
          }

          const closeResult = await deps.runBr(["close", issue.id, "--reason", reason]);
          if (closeResult.code !== 0) {
            ctx.ui.notify(`Failed to close ${issue.id}: ${deps.summarizeExecFailure(closeResult)}`, "error");
            continue;
          }

          await deps.refreshBeadsStatus(ctx);
          await deps.maybeNudgeCommitAfterClose(ctx);

          ctx.ui.notify(`Closed ${issue.id}.`, "info");
          return;
        }
      }
    },
  });

  pi.registerCommand("beads-ready", {
    description: "Run br ready --sort priority",
    handler: async (_args, ctx) => {
      const result = await deps.runBr(["ready", "--sort", "priority"]);
      if (result.code !== 0) {
        deps.commandOut(ctx, `beads-ready failed: ${deps.summarizeExecFailure(result)}`, "error");
        return;
      }

      deps.commandOut(ctx, result.stdout.trim() || "No ready issues.", "info");
    },
  });

  pi.registerCommand("beads-status", {
    description: "Show beads stats, blocked issues, and in-progress issues",
    handler: async (_args, ctx) => {
      const [stats, blocked, inProgress] = await Promise.all([
        deps.runBr(["stats"]),
        deps.runBr(["blocked"]),
        deps.runBr(["list", "--status", "in_progress"]),
      ]);

      const lines: string[] = [];

      if (stats.code === 0) {
        lines.push("=== br stats ===", stats.stdout.trim() || "(empty)");
      } else {
        lines.push(`=== br stats (failed) ===`, deps.summarizeExecFailure(stats));
      }

      if (blocked.code === 0) {
        lines.push("", "=== br blocked ===", blocked.stdout.trim() || "(none)");
      } else {
        lines.push("", "=== br blocked (failed) ===", deps.summarizeExecFailure(blocked));
      }

      if (inProgress.code === 0) {
        lines.push("", "=== br list --status in_progress ===", inProgress.stdout.trim() || "(none)");
      } else {
        lines.push("", "=== br list --status in_progress (failed) ===", deps.summarizeExecFailure(inProgress));
      }

      const hasError = stats.code !== 0 || blocked.code !== 0 || inProgress.code !== 0;
      deps.commandOut(ctx, lines.join("\n"), hasError ? "warning" : "info");
    },
  });

  pi.registerCommand("beads-claim", {
    description: "Mark issue in_progress: /beads-claim <id>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) {
        deps.commandOut(ctx, "Usage: /beads-claim <id>", "warning");
        return;
      }

      const result = await deps.runBr(["update", id, "--status", "in_progress"]);
      if (result.code !== 0) {
        deps.commandOut(ctx, `Failed to claim ${id}: ${deps.summarizeExecFailure(result)}`, "error");
        return;
      }

      await deps.refreshBeadsStatus(ctx);
      deps.commandOut(ctx, `Claimed ${id} (in_progress).`, "info");
    },
  });

  pi.registerCommand("beads-close", {
    description: "Close issue: /beads-close <id>",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) {
        deps.commandOut(ctx, "Usage: /beads-close <id>", "warning");
        return;
      }

      let reason = "Verified: completed";
      if (ctx.hasUI) {
        const input = await ctx.ui.input(`Close reason for ${id}`, reason);
        if (!input?.trim()) {
          ctx.ui.notify("Close cancelled: reason is required.", "warning");
          return;
        }
        reason = input;
      }

      const result = await deps.runBr(["close", id, "--reason", reason]);
      if (result.code !== 0) {
        deps.commandOut(ctx, `Failed to close ${id}: ${deps.summarizeExecFailure(result)}`, "error");
        return;
      }

      await deps.refreshBeadsStatus(ctx);
      await deps.maybeNudgeCommitAfterClose(ctx);
      deps.commandOut(ctx, `Closed ${id}.`, "info");
    },
  });

  pi.registerCommand("beads-reset-reminder", {
    description: "Reset one-time beads context reminder",
    handler: async (_args, ctx) => {
      state.contextReminderShown = false;
      deps.commandOut(ctx, "Beads context reminder reset.", "info");
    },
  });

  pi.registerCommand("beads-mode", {
    description: "Set/query beads mode: /beads-mode [on|off|status]",
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();

      if (!value || value === "status") {
        deps.commandOut(ctx, state.beadsEnabled ? "Beads mode is ON." : "Beads mode is OFF.", "info");
        return;
      }

      if (value !== "on" && value !== "off") {
        deps.commandOut(ctx, "Usage: /beads-mode [on|off|status]", "warning");
        return;
      }

      await setBeadsMode(value === "on", ctx);

      deps.commandOut(
        ctx,
        state.beadsEnabled
          ? state.isBeadsProject ? "Beads mode enabled." : "Beads mode enabled (no project detected)."
          : "Beads mode disabled.",
        "info",
      );
    },
  });

  pi.registerShortcut("ctrl+b", {
    description: "Toggle beads mode on/off",
    handler: async (ctx) => {
      await setBeadsMode(!state.beadsEnabled, ctx);

      const toggleMessage = state.beadsEnabled
        ? state.isBeadsProject ? "Beads mode enabled." : "Beads mode enabled (no project detected)."
        : "Beads mode disabled.";

      ctx.ui.notify(toggleMessage, "info");
    },
  });
}
