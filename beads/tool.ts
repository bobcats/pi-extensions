import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  formatEnrichedReadyOutput,
  formatFileListComment,
  formatIssueCard,
  formatIssueLabel,
  getBeadsModeOffMessage,
  isRecord,
  parseBrDepListJson,
  parseBrReadyJson,
  parseBrShowJson,
  summarizeBeadsActionResult,
  type BeadsAction,
  type BrIssueSummary,
  type BrShowIssue,
  type EnrichedReadyIssue,
} from "./lib.ts";

const beadsToolSchema = Type.Object({
  action: StringEnum(["ready", "show", "claim", "close", "comment", "create", "status"] as const),
  id: Type.Optional(Type.String({ description: "Issue id (e.g. br-abc)" })),
  title: Type.Optional(Type.String({ description: "Issue title for create" })),
  description: Type.Optional(Type.String({ description: "Issue description for create" })),
  type: Type.Optional(Type.String({ description: "Issue type for create (task/feature/bug/epic)" })),
  priority: Type.Optional(Type.Number({ description: "Issue priority for create (0-4)" })),
  comment: Type.Optional(Type.String({ description: "Comment text for comment action" })),
  reason: Type.Optional(Type.String({ description: "Close reason for close action" })),
});

type BeadsToolInput = Static<typeof beadsToolSchema>;

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
};

type DisabledToolDetails = {
  action: BeadsAction;
  beadsEnabled: false;
};

type RunToolDetails = {
  action: "claim" | "close" | "status";
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  closeWarning?: string | null;
};

type ReadyToolDetails = {
  action: "ready";
  command: string;
  issues: BrIssueSummary[];
  issueCount: number;
  stdout: string;
  stderr: string;
  exitCode: number;
};

type ShowToolDetails = {
  action: "show";
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  issueCard: BrShowIssue | null;
};

type CommentToolDetails = {
  action: "comment";
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  commentText: string;
};

type CreateToolDetails = {
  action: "create";
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  issueCard: BrShowIssue;
};

type BeadsToolDetails =
  | DisabledToolDetails
  | RunToolDetails
  | ReadyToolDetails
  | ShowToolDetails
  | CommentToolDetails
  | CreateToolDetails;

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

function isBeadsAction(value: unknown): value is BeadsAction {
  return (
    value === "ready" ||
    value === "show" ||
    value === "claim" ||
    value === "close" ||
    value === "comment" ||
    value === "create" ||
    value === "status"
  );
}

function parseBeadsToolDetails(details: unknown): BeadsToolDetails | null {
  if (!isRecord(details) || !isBeadsAction(details.action)) {
    return null;
  }

  if (details.beadsEnabled === false) {
    return {
      action: details.action,
      beadsEnabled: false,
    };
  }

  const action = details.action;

  if (action === "ready") {
    if (
      typeof details.command === "string" &&
      Array.isArray(details.issues) &&
      typeof details.issueCount === "number" &&
      typeof details.stdout === "string" &&
      typeof details.stderr === "string" &&
      typeof details.exitCode === "number"
    ) {
      return {
        action,
        command: details.command,
        issues: details.issues as BrIssueSummary[],
        issueCount: details.issueCount,
        stdout: details.stdout,
        stderr: details.stderr,
        exitCode: details.exitCode,
      };
    }
    return null;
  }

  if (action === "show") {
    if (
      typeof details.command === "string" &&
      typeof details.stdout === "string" &&
      typeof details.stderr === "string" &&
      typeof details.exitCode === "number"
    ) {
      return {
        action,
        command: details.command,
        stdout: details.stdout,
        stderr: details.stderr,
        exitCode: details.exitCode,
        issueCard: isRecord(details.issueCard) ? (details.issueCard as BrShowIssue) : null,
      };
    }
    return null;
  }

  if (action === "comment") {
    if (
      typeof details.command === "string" &&
      typeof details.stdout === "string" &&
      typeof details.stderr === "string" &&
      typeof details.exitCode === "number" &&
      typeof details.commentText === "string"
    ) {
      return {
        action,
        command: details.command,
        stdout: details.stdout,
        stderr: details.stderr,
        exitCode: details.exitCode,
        commentText: details.commentText,
      };
    }
    return null;
  }

  if (action === "create") {
    if (
      typeof details.command === "string" &&
      typeof details.stdout === "string" &&
      typeof details.stderr === "string" &&
      typeof details.exitCode === "number" &&
      isRecord(details.issueCard)
    ) {
      return {
        action,
        command: details.command,
        stdout: details.stdout,
        stderr: details.stderr,
        exitCode: details.exitCode,
        issueCard: details.issueCard as BrShowIssue,
      };
    }
    return null;
  }

  if (action === "claim" || action === "close" || action === "status") {
    if (
      typeof details.command === "string" &&
      typeof details.stdout === "string" &&
      typeof details.stderr === "string" &&
      typeof details.exitCode === "number"
    ) {
      return {
        action,
        command: details.command,
        stdout: details.stdout,
        stderr: details.stderr,
        exitCode: details.exitCode,
        closeWarning: typeof details.closeWarning === "string" || details.closeWarning === null
          ? details.closeWarning
          : undefined,
      };
    }
    return null;
  }

  return null;
}

type UiContext = { ui: { setStatus: (key: string, value?: string) => void } };
type NotifyContext = { hasUI: boolean; ui: { notify: (message: string, level: "info" | "warning" | "error") => void } };

export function registerBeadsTool(
  pi: ExtensionAPI,
  deps: {
    isEnabled(): boolean;
    runBr(args: string[], timeout?: number): Promise<ExecResult>;
    refreshBeadsStatus(ctx: UiContext): Promise<void>;
    maybeNudgeCommitAfterClose(ctx: NotifyContext): Promise<string | null>;
    onClaim(issueId: string): void;
    onClose(issueId: string): void;
    getEditedFiles(issueId: string): Set<string> | undefined;
    onCheckpoint(): void;
    sendContinueMessage(closedId: string): void;
  },
) {
  pi.registerTool({
    name: "beads",
    label: "Beads",
    description:
      "Run deterministic beads operations (ready, show, claim, close, comment, create, status) through br CLI.",
    parameters: beadsToolSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as BeadsToolInput;

      if (!deps.isEnabled()) {
        return {
          content: [{ type: "text" as const, text: getBeadsModeOffMessage() }],
          details: {
            action: input.action,
            beadsEnabled: false,
          },
        };
      }

      const fail = (message: string, details: Record<string, unknown>) => {
        const summary = extractErrorSummary(details.stderr) ?? extractErrorSummary(details.stdout);
        const text = summary ? `${message}: ${summary}` : message;

        return {
          content: [{ type: "text" as const, text }],
          isError: true,
          details,
        };
      };

      const mutatingActions = new Set<BeadsAction>(["create", "claim", "close"]);

      const runBrForTool = async (args: string[]) => {
        const result = await deps.runBr(args);

        if (result.code !== 0) {
          return fail(`beads ${input.action} failed`, {
            action: input.action,
            command: `br ${args.join(" ")}`,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.code,
          });
        }

        if (mutatingActions.has(input.action)) {
          deps.refreshBeadsStatus(ctx).catch(() => {});
        }

        let closeWarning: string | null = null;
        if (input.action === "close") {
          closeWarning = await deps.maybeNudgeCommitAfterClose(ctx);
        }

        const outputText = closeWarning
          ? `${result.stdout || "OK"}\n\n${closeWarning}`
          : result.stdout || "OK";

        return {
          content: [{ type: "text" as const, text: outputText }],
          details: {
            action: input.action,
            command: `br ${args.join(" ")}`,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.code,
            closeWarning,
          },
        };
      };

      switch (input.action) {
        case "ready": {
          const result = await deps.runBr(["ready", "--sort", "priority", "--json"]);

          if (result.code !== 0) {
            return fail("beads ready failed", {
              action: input.action,
              command: "br ready --sort priority --json",
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.code,
            });
          }

          const issues = parseBrReadyJson(result.stdout);

          // V7: Enrich first 5 issues with dep info
          const MAX_ENRICH = 5;
          const toEnrich = issues.slice(0, MAX_ENRICH);
          const enriched: EnrichedReadyIssue[] = await Promise.all(
            toEnrich.map(async (issue) => {
              const [upResult, downResult] = await Promise.all([
                deps.runBr(["dep", "list", issue.id, "--direction", "up", "--json"], 5000).catch(() => ({ stdout: "[]", stderr: "", code: 1, killed: false })),
                deps.runBr(["dep", "list", issue.id, "--direction", "down", "--json"], 5000).catch(() => ({ stdout: "[]", stderr: "", code: 1, killed: false })),
              ]);

              const parents = upResult.code === 0 ? parseBrDepListJson(upResult.stdout) : [];
              const unblocks = downResult.code === 0 ? parseBrDepListJson(downResult.stdout) : [];

              return { issue, parent: parents[0] ?? null, unblocks };
            }),
          );

          // Append remaining issues without enrichment
          for (let i = MAX_ENRICH; i < issues.length; i++) {
            enriched.push({ issue: issues[i], parent: null, unblocks: [] });
          }

          const text = formatEnrichedReadyOutput(enriched);

          return {
            content: [{ type: "text" as const, text }],
            details: {
              action: input.action,
              command: "br ready --sort priority --json",
              issues,
              issueCount: issues.length,
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.code,
            },
          };
        }

        case "show": {
          if (!input.id) {
            return fail("beads show requires id", { action: input.action, missing: "id" });
          }
          const showArgs = ["show", input.id, "--json"];
          const showResult = await deps.runBr(showArgs);
          if (showResult.code !== 0) {
            return fail("beads show failed", {
              action: input.action,
              command: `br ${showArgs.join(" ")}`,
              stdout: showResult.stdout,
              stderr: showResult.stderr,
              exitCode: showResult.code,
            });
          }
          const showIssue = parseBrShowJson(showResult.stdout);
          return {
            content: [{ type: "text" as const, text: showResult.stdout || "OK" }],
            details: {
              action: input.action,
              command: `br ${showArgs.join(" ")}`,
              stdout: showResult.stdout,
              stderr: showResult.stderr,
              exitCode: showResult.code,
              issueCard: showIssue,
            },
          };
        }

        case "claim": {
          if (!input.id) {
            return fail("beads claim requires id", { action: input.action, missing: "id" });
          }
          const claimResult = await runBrForTool(["update", input.id, "--status", "in_progress"]);

          if (!claimResult.isError) {
            deps.onClaim(input.id);
          }

          return claimResult;
        }

        case "close": {
          if (!input.id) {
            return fail("beads close requires id", { action: input.action, missing: "id" });
          }

          // V3: Flush file list as comment before closing
          const fileListComment = formatFileListComment(deps.getEditedFiles(input.id));
          if (fileListComment) {
            await deps.runBr(["comments", "add", input.id, fileListComment], 5000).catch(() => {});
          }

          const reason = input.reason?.trim() || "Verified: completed";
          const closeResult = await runBrForTool(["close", input.id, "--reason", reason]);

          if (!closeResult.isError) {
            deps.onClose(input.id);
            deps.sendContinueMessage(input.id);
          }

          return closeResult;
        }

        case "comment": {
          if (!input.id) {
            return fail("beads comment requires id", { action: input.action, missing: "id" });
          }
          if (!input.comment?.trim()) {
            return fail("beads comment requires comment text", { action: input.action, missing: "comment" });
          }
          const commentArgs = ["comments", "add", input.id, input.comment];
          const commentResult = await deps.runBr(commentArgs);
          if (commentResult.code !== 0) {
            return fail("beads comment failed", {
              action: input.action,
              command: `br ${commentArgs.join(" ")}`,
              stdout: commentResult.stdout,
              stderr: commentResult.stderr,
              exitCode: commentResult.code,
            });
          }
          // V6: Comment counts as checkpoint
          deps.onCheckpoint();

          return {
            content: [{ type: "text" as const, text: commentResult.stdout || "OK" }],
            details: {
              action: input.action,
              command: `br ${commentArgs.join(" ")}`,
              stdout: commentResult.stdout,
              stderr: commentResult.stderr,
              exitCode: commentResult.code,
              commentText: input.comment,
            },
          };
        }

        case "create": {
          if (!input.title?.trim()) {
            return fail("beads create requires title", { action: input.action, missing: "title" });
          }

          const createArgs = [
            "create",
            input.title,
            "--type",
            input.type?.trim() || "task",
            "--priority",
            String(typeof input.priority === "number" ? input.priority : 2),
          ];

          if (input.description?.trim()) {
            createArgs.push("--description", input.description);
          }

          const createResult = await deps.runBr(createArgs);
          if (createResult.code !== 0) {
            return fail("beads create failed", {
              action: input.action,
              command: `br ${createArgs.join(" ")}`,
              stdout: createResult.stdout,
              stderr: createResult.stderr,
              exitCode: createResult.code,
            });
          }

          deps.refreshBeadsStatus(ctx).catch(() => {});

          const createdCard: BrShowIssue = {
            id: createResult.stdout.match(/Created\s+(\S+)/)?.[1] ?? "???",
            title: input.title,
            type: input.type?.trim() || "task",
            priority: typeof input.priority === "number" ? input.priority : 2,
            status: "open",
            description: input.description?.trim() || undefined,
          };

          return {
            content: [{ type: "text" as const, text: createResult.stdout || "OK" }],
            details: {
              action: input.action,
              command: `br ${createArgs.join(" ")}`,
              stdout: createResult.stdout,
              stderr: createResult.stderr,
              exitCode: createResult.code,
              issueCard: createdCard,
            },
          };
        }

        case "status": {
          return runBrForTool(["stats"]);
        }
      }
    },

    renderCall(args, theme) {
      const action = typeof args.action === "string" ? args.action : "unknown";
      const id = typeof args.id === "string" ? ` ${args.id}` : "";
      let text = theme.fg("toolTitle", theme.bold("beads ")) + theme.fg("muted", action) + theme.fg("accent", id);

      if (action === "comment" && typeof args.comment === "string" && args.comment.trim()) {
        const preview = args.comment.length > 80 ? args.comment.slice(0, 77) + "..." : args.comment;
        text += theme.fg("dim", ` — ${preview}`);
      }

      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Processing..."), 0, 0);
      }

      if (result.isError) {
        const details = isRecord(result.details) ? result.details : undefined;
        const stderr = typeof details?.stderr === "string" ? details.stderr : undefined;
        const stdout = typeof details?.stdout === "string" ? details.stdout : undefined;
        const command = typeof details?.command === "string" ? details.command : undefined;

        const summary = extractErrorSummary(stderr) ?? extractErrorSummary(stdout);

        let text = theme.fg("error", "✖ beads action failed");
        if (summary) {
          text += theme.fg("muted", ` — ${summary}`);
        }

        if (expanded) {
          if (command) {
            text += `\n${theme.fg("dim", command)}`;
          }
          if (stderr?.trim()) {
            text += `\n${theme.fg("dim", stderr)}`;
          }
          if (stdout?.trim()) {
            text += `\n${theme.fg("dim", stdout)}`;
          }
        }

        return new Text(text, 0, 0);
      }

      const details = parseBeadsToolDetails(result.details);
      const action: BeadsAction = details?.action ?? "status";
      const stdout = details && "stdout" in details ? details.stdout : "";

      // Mini card for show/create
      if ((action === "show" || action === "create") && details && "issueCard" in details && details.issueCard) {
        const prefix = action === "create" ? "Created " : "";
        const cardLines = formatIssueCard(details.issueCard);
        let text = theme.fg("success", "✓ ") + theme.fg("muted", `${prefix}${cardLines[0]}`);
        for (let i = 1; i < cardLines.length; i++) {
          text += "\n" + theme.fg("dim", `  ${cardLines[i]}`);
        }
        if (expanded) {
          const block = result.content.find((item) => item.type === "text");
          if (block && block.type === "text" && block.text.trim()) {
            text += `\n${theme.fg("dim", block.text)}`;
          }
        }
        return new Text(text, 0, 0);
      }

      let summary: string;
      if (action === "ready" && details && details.action === "ready") {
        summary = details.issueCount === 0 ? "No ready issues" : `${details.issueCount} ready issue(s)`;
      } else {
        summary = summarizeBeadsActionResult(action, stdout);
      }

      let text = theme.fg("success", "✓ ") + theme.fg("muted", summary);

      if (action === "comment" && details && details.action === "comment") {
        const [firstLine = ""] = details.commentText.split("\n");
        const preview = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
        const extraCount = details.commentText.split("\n").length - 1;
        text += "\n" + theme.fg("dim", `  "${preview}"${extraCount > 0 ? ` (+${extraCount} lines)` : ""}`);
      }

      if (expanded) {
        const block = result.content.find((item) => item.type === "text");
        if (block && block.type === "text" && block.text.trim()) {
          text += `\n${theme.fg("dim", block.text)}`;
        }
      }

      return new Text(text, 0, 0);
    },
  });
}
