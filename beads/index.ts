import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  buildContinueMessage,
  DIRTY_TREE_CLOSE_WARNING,
  detectTrackingMode,
  formatBeadsModeStatus,
  parseBrInfoJson,
  parseBrReadyJson,
  type ExecResult,
  type UiContext,
} from "./lib.ts";
import { registerBeadsTool } from "./tool.ts";
import { registerBeadsCommands, type BeadsState } from "./commands.ts";
import { registerBeadsHooks } from "./hooks.ts";

function extractErrorSummary(output: unknown): string | null {
  if (typeof output !== "string") return null;
  const trimmed = output.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: unknown; hint?: unknown } };
    if (parsed?.error && typeof parsed.error === "object") {
      const message = typeof parsed.error.message === "string" ? parsed.error.message.trim() : "";
      const hint = typeof parsed.error.hint === "string" ? parsed.error.hint.trim() : "";

      if (message && hint) return `${message} (${hint})`;
      if (message) return message;
      if (hint) return hint;
    }
  } catch {
    // fall through to first non-empty line
  }

  const firstLine = trimmed
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine ?? null;
}

function toExecError(error: unknown): ExecResult {
  return {
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
    code: 1,
    killed: false,
  };
}

function summarizeExecFailure(result: ExecResult): string {
  return (
    extractErrorSummary(result.stderr) ??
    extractErrorSummary(result.stdout) ??
    `Command failed with exit code ${result.code}`
  );
}

function commandOut(
  ctx: { hasUI: boolean; ui: { notify: (message: string, level: "info" | "warning" | "error") => void } },
  message: string,
  level: "info" | "warning" | "error" = "info",
) {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  } else {
    process.stdout.write(`${message}\n`);
  }
}

export default function beadsExtension(pi: ExtensionAPI) {
  const state: BeadsState = {
    isBeadsProject: false,
    beadsEnabled: false,
    shouldPrime: false,
    contextReminderShown: false,
    cachedModeText: "",
    currentIssueId: null,
    editedFiles: new Map(),
    checkpointState: { lastCheckpointTurn: 0, turnIndex: 0 },
    autoContinuePending: false,
  };

  pi.registerFlag("beads-observe", {
    description: "Enable low-noise beads observability diagnostics",
    type: "boolean",
    default: false,
  });

  const isObservabilityEnabled = () => Boolean(pi.getFlag("--beads-observe"));

  const runBr = (args: string[], timeout = 15000): Promise<ExecResult> =>
    pi.exec("br", args, { timeout }).catch(toExecError);

  const runGit = (args: string[], timeout = 5000): Promise<ExecResult> =>
    pi.exec("git", args, { timeout }).catch(toExecError);

  const clearBeadsModeUi = (ctx: UiContext) => {
    ctx.ui.setStatus("beads-mode", undefined);
  };

  const setBeadsModeUiStatus = (ctx: UiContext) => {
    ctx.ui.setStatus(
      "beads-mode",
      formatBeadsModeStatus({
        beadsEnabled: state.beadsEnabled,
        isBeadsProject: state.isBeadsProject,
        modeText: state.cachedModeText,
        issueCount: 0,
        inProgressIssues: [],
      }),
    );
  };

  const refreshBeadsStatus = async (ctx: UiContext) => {
    if (!state.beadsEnabled || !state.isBeadsProject) {
      setBeadsModeUiStatus(ctx);
      return;
    }

    const [info, listResult, inProgressResult] = await Promise.all([
      runBr(["info", "--json"]),
      runBr(["list", "--json"]),
      runBr(["list", "--status", "in_progress", "--sort", "updated_at", "--json"]),
    ]);

    if (info.code !== 0) {
      clearBeadsModeUi(ctx);
      return;
    }

    const parsedInfo = parseBrInfoJson(info.stdout);

    // br info issue_count includes tombstones; use br list for live count
    const liveIssues = listResult.code === 0 ? parseBrReadyJson(listResult.stdout) : [];
    const issueCount = liveIssues.length;
    const inProgressIssues = inProgressResult.code === 0 ? parseBrReadyJson(inProgressResult.stdout) : [];

    if (!state.cachedModeText) {
      const checkIgnore = await runGit(["check-ignore", ".beads/"]);
      const mode = detectTrackingMode(checkIgnore.code);
      const modeLabel = mode === "stealth" ? "stealth" : "git-tracked";
      const backendMode = parsedInfo?.mode ?? "unknown";
      state.cachedModeText = `${modeLabel} (${backendMode})`;
    }

    ctx.ui.setStatus(
      "beads-mode",
      formatBeadsModeStatus({
        beadsEnabled: state.beadsEnabled,
        isBeadsProject: state.isBeadsProject,
        modeText: state.cachedModeText,
        issueCount,
        inProgressIssues,
      }),
    );
  };

  const maybeNudgeCommitAfterClose = async (ctx: {
    hasUI: boolean;
    ui: { notify: (message: string, level: "info" | "warning" | "error") => void };
  }): Promise<string | null> => {
    const status = await runGit(["status", "--porcelain"]);
    if (status.code !== 0) {
      return null;
    }

    if (!status.stdout.trim()) {
      return null;
    }

    commandOut(ctx, DIRTY_TREE_CLOSE_WARNING, "warning");

    pi.sendMessage(
      {
        customType: "beads-dirty-tree-warning",
        content: DIRTY_TREE_CLOSE_WARNING,
        display: false,
      },
      { deliverAs: "nextTurn" },
    );

    return DIRTY_TREE_CLOSE_WARNING;
  };

  registerBeadsTool(pi, {
    isEnabled: () => state.beadsEnabled,
    runBr,
    refreshBeadsStatus,
    maybeNudgeCommitAfterClose,
    onClaim(issueId: string) {
      state.currentIssueId = issueId;
      state.editedFiles.set(issueId, new Set());
      state.checkpointState = { lastCheckpointTurn: 0, turnIndex: 0 };
    },
    onClose(issueId: string) {
      state.currentIssueId = null;
      state.editedFiles.delete(issueId);
      state.checkpointState = { lastCheckpointTurn: 0, turnIndex: 0 };
    },
    getEditedFiles(issueId: string) {
      return state.editedFiles.get(issueId);
    },
    onCheckpoint() {
      state.checkpointState.lastCheckpointTurn = state.checkpointState.turnIndex;
    },
    sendContinueMessage(closedId: string) {
      if (state.autoContinuePending) return;
      state.autoContinuePending = true;
      const msg = buildContinueMessage(closedId);
      pi.sendMessage(
        {
          customType: "beads-auto-continue",
          content: msg,
          display: false,
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    },
  });

  registerBeadsCommands(pi, {
    state,
    runBr,
    commandOut,
    summarizeExecFailure,
    refreshBeadsStatus,
    maybeNudgeCommitAfterClose,
  });

  registerBeadsHooks(pi, {
    state,
    runBr,
    runGit,
    commandOut,
    refreshBeadsStatus,
    setBeadsModeUiStatus,
    isObservabilityEnabled,
  });
}
