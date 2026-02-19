import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  buildBeadsPrimeMessage,
  buildObservabilitySummary,
  buildResumeContext,
  isBrCloseCommand,
  parseBeadsSessionMode,
  parseBrReadyJson,
  parseBrShowJson,
  shouldShowContextReminder,
} from "./lib.ts";
import type { BeadsState } from "./commands.ts";

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
};

type UiContext = { ui: { setStatus: (key: string, value?: string) => void } };
type NotifyContext = { hasUI: boolean; ui: { notify: (message: string, level: "info" | "warning" | "error") => void } };

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
    }
  });

  pi.on("before_agent_start", async () => {
    if (!state.beadsEnabled || !state.shouldPrime) {
      return;
    }

    state.shouldPrime = false;

    let resumeContext: string | undefined;
    const inProgress = await deps.runBr(["list", "--status", "in_progress", "--sort", "updated_at", "--json"]);
    if (inProgress.code === 0) {
      const [firstIssue] = parseBrReadyJson(inProgress.stdout);
      if (firstIssue) {
        const showResult = await deps.runBr(["show", firstIssue.id, "--json"]);
        if (showResult.code === 0) {
          const detail = parseBrShowJson(showResult.stdout);
          if (detail) {
            resumeContext = buildResumeContext(detail);
          }
        }
      }
    }

    return {
      message: {
        customType: "beads-prime",
        content: buildBeadsPrimeMessage({ beadsEnabled: state.beadsEnabled, resumeContext }),
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
