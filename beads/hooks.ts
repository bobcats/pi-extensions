import {
  isToolCallEventType,
  isBashToolResult,
  isWriteToolResult,
  isEditToolResult,
  type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import {
  buildBeadsPrimeMessage,
  buildCheckpointNudgeMessage,
  buildCheckpointSummary,
  buildObservabilitySummary,
  buildRecoveryContext,
  extractEditedFilePath,
  formatRecoveryMessage,
  isBrCloseCommand,
  isBrCommand,
  isGitCommitCommand,
  parseBeadsSessionMode,
  parseGitCommitOutput,
  shouldNudgeCheckpoint,
  shouldShowContextReminder,
  type ExecResult,
  type UiContext,
  type NotifyContext,
} from "./lib.ts";
import type { BeadsState } from "./commands.ts";

export function registerBeadsHooks(
  pi: ExtensionAPI,
  deps: {
    state: BeadsState;
    runBr(args: string[], timeout?: number): Promise<ExecResult>;
    runGit(args: string[], timeout?: number): Promise<ExecResult>;
    commandOut(ctx: NotifyContext, message: string, level?: "info" | "warning" | "error"): void;
    refreshBeadsStatus(ctx: UiContext): Promise<void>;
    setBeadsModeUiStatus(ctx: UiContext): void;
    isObservabilityEnabled(): boolean;
  },
) {
  const { state } = deps;

  pi.on("session_start", async (_event, ctx) => {
    const info = await deps.runBr(["info", "--json"]);
    const sessionMode = parseBeadsSessionMode({ brInfoExitCode: info.code });

    state.isBeadsProject = sessionMode.isBeadsProject;
    state.beadsEnabled = sessionMode.beadsEnabled;
    state.shouldPrime = state.beadsEnabled;
    state.cachedModeText = "";

    if (!state.beadsEnabled) {
      deps.setBeadsModeUiStatus(ctx);
      return;
    }

    await deps.refreshBeadsStatus(ctx);
  });

  pi.on("session_before_compact", async () => {
    if (state.beadsEnabled) {
      state.shouldPrime = true;

      // V4: Auto-checkpoint before compaction
      if (state.currentIssueId) {
        const files = state.editedFiles.get(state.currentIssueId) ?? new Set();
        const turnsSince = state.checkpointState.turnIndex - state.checkpointState.lastCheckpointTurn;

        if (turnsSince > 0 || files.size > 0) {
          const summary = buildCheckpointSummary({ editedFiles: files, turnsSinceCheckpoint: turnsSince });
          deps.runBr(["comments", "add", state.currentIssueId, summary], 3000).catch(() => {});
          state.checkpointState.lastCheckpointTurn = state.checkpointState.turnIndex;
        }
      }
    }
  });

  pi.on("before_agent_start", async () => {
    state.autoContinuePending = false;

    if (!state.beadsEnabled || !state.shouldPrime) {
      return;
    }

    state.shouldPrime = false;

    const recovery = await buildRecoveryContext({ runBr: deps.runBr, runGit: deps.runGit });

    if (recovery) {
      state.currentIssueId = recovery.issue.id;

      return {
        message: {
          customType: "beads-prime",
          content: formatRecoveryMessage(recovery),
          display: false,
        },
      };
    }

    return {
      message: {
        customType: "beads-prime",
        content: buildBeadsPrimeMessage({ beadsEnabled: state.beadsEnabled }),
        display: false,
      },
    };
  });

  pi.on("tool_call", async (event) => {
    if (!state.beadsEnabled) {
      return;
    }

    if (!isToolCallEventType("bash", event)) {
      return;
    }

    const command = event.input.command;
    if (!isBrCloseCommand(command)) {
      return;
    }

    const status = await deps.runGit(["status", "--porcelain"]);
    if (status.code !== 0) {
      return;
    }

    if (status.stdout.trim()) {
      return {
        block: true,
        reason: "Cannot run `br close` with uncommitted changes. Commit/stash first, then close the issue.",
      };
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!state.beadsEnabled) return;

    // Refresh status when any successful raw br command runs via bash.
    if (isBashToolResult(event) && !event.isError) {
      const command = typeof event.input.command === "string" ? event.input.command : "";

      if (isBrCommand(command)) {
        await deps.refreshBeadsStatus(ctx);
      }

      if (!state.currentIssueId) return;

      // V2: Commit-to-issue linking
      if (isGitCommitCommand(command)) {
        const text = event.content.find((c) => c.type === "text");
        const stdout = text && "text" in text ? text.text : "";
        const parsed = parseGitCommitOutput(stdout);

        if (parsed) {
          deps.runBr(["comments", "add", state.currentIssueId, `commit: ${parsed.hash} ${parsed.message}`], 5000).catch(() => {});
          state.checkpointState.lastCheckpointTurn = state.checkpointState.turnIndex;
        }
      }

      // Detect manual br comments add via bash — reset checkpoint counter
      if (/^\s*br\s+comments\s+add\b/.test(command)) {
        state.checkpointState.lastCheckpointTurn = state.checkpointState.turnIndex;
      }

      return;
    }

    if (!state.currentIssueId) return;

    // V3: File tracking
    if (isWriteToolResult(event) || isEditToolResult(event)) {
      const path = extractEditedFilePath(event.toolName, event.input);
      if (path && state.currentIssueId) {
        let files = state.editedFiles.get(state.currentIssueId);
        if (!files) {
          files = new Set();
          state.editedFiles.set(state.currentIssueId, files);
        }
        files.add(path);
      }
    }
  });

  pi.on("message_start", async (_event, ctx) => {
    if (!state.beadsEnabled) return;

    const summary = buildObservabilitySummary({
      enabled: deps.isObservabilityEnabled(),
      eventType: "message_start",
    });

    if (summary) {
      deps.commandOut(ctx, summary, "info");
    }
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!state.beadsEnabled) return;

    const summary = buildObservabilitySummary({
      enabled: deps.isObservabilityEnabled(),
      eventType: "tool_execution_end",
      toolName: event.toolName,
      isError: event.isError,
    });

    if (summary) {
      deps.commandOut(ctx, summary, event.isError ? "warning" : "info");
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!state.beadsEnabled) {
      return;
    }

    // V6: Increment turn counter and check checkpoint nudge
    state.checkpointState.turnIndex++;

    if (
      state.currentIssueId &&
      shouldNudgeCheckpoint({
        turnIndex: state.checkpointState.turnIndex,
        lastCheckpointTurn: state.checkpointState.lastCheckpointTurn,
        threshold: 8,
        hasActiveIssue: true,
      })
    ) {
      const turnsSince = state.checkpointState.turnIndex - state.checkpointState.lastCheckpointTurn;
      const nudgeText = buildCheckpointNudgeMessage(state.currentIssueId, turnsSince);

      deps.commandOut(ctx, "Consider checkpointing your progress to the beads issue.", "info");

      pi.sendMessage(
        {
          customType: "beads-checkpoint-nudge",
          content: nudgeText,
          display: false,
        },
        { deliverAs: "nextTurn" },
      );

      // Reset to avoid nagging every turn after threshold
      state.checkpointState.lastCheckpointTurn = state.checkpointState.turnIndex;
    }

    const usage = ctx.getContextUsage();
    if (!usage) {
      return;
    }

    const usagePercent = usage.percent;
    if (usagePercent === null) {
      return;
    }

    if (
      shouldShowContextReminder({
        usagePercent,
        thresholdPercent: 85,
        alreadyShown: state.contextReminderShown,
        beadsEnabled: state.beadsEnabled,
      })
    ) {
      state.contextReminderShown = true;

      const reminderText =
        `Context is at ${Math.round(usagePercent)}%. Checkpoint your current progress to the beads issue now, then run /compact.`;

      // Human sees it immediately
      ctx.ui.notify(reminderText, "warning");

      // Model sees it on the next turn so it can act
      pi.sendMessage(
        {
          customType: "beads-context-warning",
          content: reminderText,
          display: false,
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    }
  });
}
