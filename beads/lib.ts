export type TrackingMode = "stealth" | "git-tracked";

export type BrIssueSummary = {
  id: string;
  title: string;
  type?: string;
  priority?: number;
  status?: string;
};

export type BeadsAction = "ready" | "show" | "claim" | "close" | "comment" | "create" | "status";

export const DIRTY_TREE_CLOSE_WARNING =
  "Warning: Issue closed. You still have uncommitted changes — run @semantic-commit before continuing.";

const BEADS_MODE_OFF_MESSAGE = "Beads mode is off. Enable with /beads-mode on (or Ctrl+B).";
const BEADS_STATUS_OFF = "beads: off";
const BEADS_STATUS_ON_NO_PROJECT = "beads: on (no project)";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBrComment(value: unknown): value is BrComment {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "number" &&
    typeof value.issue_id === "string" &&
    typeof value.author === "string" &&
    typeof value.text === "string" &&
    typeof value.created_at === "string"
  );
}

export function parseBrInfoJson(json: string): { mode: string; issueCount: number } | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed)) return null;

    const mode = typeof parsed.mode === "string" && parsed.mode.trim() ? parsed.mode : "unknown";
    const issueCount = typeof parsed.issue_count === "number" ? parsed.issue_count : 0;
    return { mode, issueCount };
  } catch {
    return null;
  }
}

export function parseBeadsSessionMode(args: { brInfoExitCode: number }): {
  isBeadsProject: boolean;
  beadsEnabled: boolean;
} {
  const isBeadsProject = args.brInfoExitCode === 0;
  return {
    isBeadsProject,
    beadsEnabled: isBeadsProject,
  };
}

export function parseBrReadyJson(json: string): BrIssueSummary[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.issues)
        ? parsed.issues
        : [];

    return rows
      .map((row) => normalizeIssueRow(row))
      .filter((issue): issue is BrIssueSummary => issue !== null);
  } catch {
    return [];
  }
}

export function detectTrackingMode(gitCheckIgnoreExitCode: number): TrackingMode {
  return gitCheckIgnoreExitCode === 0 ? "stealth" : "git-tracked";
}

export function isBrCloseCommand(command: string): boolean {
  return /^\s*br\s+close\b/.test(command);
}

export function shouldShowContextReminder(args: {
  usagePercent: number | null;
  thresholdPercent: number;
  alreadyShown: boolean;
  beadsEnabled?: boolean;
}): boolean {
  if (args.beadsEnabled === false) return false;
  if (args.alreadyShown) return false;
  if (args.usagePercent === null) return false;
  return args.usagePercent >= args.thresholdPercent;
}

export function buildObservabilitySummary(input: {
  enabled: boolean;
  eventType: "message_start" | "message_end" | "tool_execution_start" | "tool_execution_update" | "tool_execution_end" | string;
  toolName?: string;
  isError?: boolean;
}): string | null {
  if (!input.enabled) return null;

  if (input.eventType === "tool_execution_update") {
    // Streaming updates are too noisy for default diagnostics.
    return null;
  }

  if (input.eventType === "tool_execution_start") {
    return `obs: tool start ${input.toolName ?? "unknown"}`;
  }

  if (input.eventType === "tool_execution_end") {
    const suffix = input.isError ? " (error)" : "";
    return `obs: tool end ${input.toolName ?? "unknown"}${suffix}`;
  }

  if (input.eventType === "message_start" || input.eventType === "message_end") {
    return `obs: ${input.eventType}`;
  }

  return null;
}

export type BrComment = {
  id: number;
  issue_id: string;
  author: string;
  text: string;
  created_at: string;
};

export type BrShowIssue = BrIssueSummary & {
  description?: string;
  comments?: BrComment[];
};

export function parseBrShowJson(json: string): BrShowIssue | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (!arr.length) return null;

    const row = arr[0];
    const base = normalizeIssueRow(row);
    if (!base) return null;
    if (!isRecord(row)) return null;

    const description = typeof row.description === "string" && row.description.trim() ? row.description : undefined;

    const comments: BrComment[] = [];
    if (Array.isArray(row.comments)) {
      for (const comment of row.comments) {
        if (isBrComment(comment)) {
          comments.push(comment);
        }
      }
    }

    return { ...base, description, comments: comments.length ? comments : undefined };
  } catch {
    return null;
  }
}

export function parseBrDepListJson(json: string): BrIssueSummary[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => normalizeIssueRow(row))
      .filter((issue): issue is BrIssueSummary => issue !== null);
  } catch {
    return [];
  }
}

function formatRelativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  if (!Number.isFinite(diffMs)) return "unknown";
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatCheckpointTrail(
  comments: BrComment[] | undefined,
  now: Date,
): string[] {
  if (!comments?.length) return [];

  const MAX_COMMENTS = 5;
  const MAX_TEXT_LENGTH = 200;

  const recent = comments.slice(-MAX_COMMENTS);
  return recent.map((c) => {
    const time = formatRelativeTime(new Date(c.created_at), now);
    const text = c.text.length > MAX_TEXT_LENGTH
      ? c.text.slice(0, MAX_TEXT_LENGTH - 3) + "..."
      : c.text;
    return `- [${time}] ${text}`;
  });
}

export function buildResumeContext(issue: BrShowIssue): string {
  const lastComment = issue.comments?.length ? issue.comments[issue.comments.length - 1]! : null;
  let line = `## Resuming: ${issue.id} — ${issue.title}`;
  if (lastComment) {
    line += `\nLast checkpoint: ${lastComment.text}`;
  }
  return line;
}

export function formatIssueCard(issue: BrShowIssue): string[] {
  const priority = typeof issue.priority === "number" ? `P${issue.priority}` : "P?";
  const status = issue.status ?? "unknown";
  const type = issue.type ?? "issue";

  const lines: string[] = [];
  lines.push(`${issue.id} — ${issue.title}  [${priority} · ${status} · ${type}]`);

  if (issue.description) {
    const desc = issue.description.length > 120
      ? issue.description.slice(0, 117) + "..."
      : issue.description;
    lines.push(desc);
  }

  if (issue.comments?.length) {
    const last = issue.comments[issue.comments.length - 1]!;
    const preview = last.text.length > 100 ? last.text.slice(0, 97) + "..." : last.text;
    lines.push(`Last comment: ${preview}`);
  }

  return lines;
}

export function getBeadsModeOffMessage(): string {
  return BEADS_MODE_OFF_MESSAGE;
}

type BeadsPrimeMessageArgs = {
  beadsEnabled?: boolean;
  resumeContext?: string;
};

export function buildBeadsPrimeMessage(args?: BeadsPrimeMessageArgs): string {
  const beadsEnabled = args?.beadsEnabled ?? true;
  const resumeContext = args?.resumeContext;

  if (!beadsEnabled) {
    return "";
  }

  const lines = [
    "# Beads Workflow Context",
    "",
    "## Core Rules",
    "- Use beads for ALL task tracking (`br create`, `br ready`, `br close`)",
    "- Do NOT use TodoWrite, TaskCreate, or markdown task files for tracking",
    "- Create beads issue BEFORE writing code",
    "- Mark issue in_progress when starting work",
    "",
    "## Essential Commands",
    "- br ready",
    "- br list --status in_progress",
    "- br show <id>",
    '- br close <id> --reason "Verified: ..."',
  ];

  if (resumeContext) {
    lines.push("", resumeContext);
  }

  return lines.join("\n");
}

export function formatIssueLabel(issue: BrIssueSummary): string {
  const priority = typeof issue.priority === "number" ? `P${issue.priority}` : "P?";
  const type = issue.type ?? "issue";
  return `[${priority}] ${issue.id} (${type}) ${issue.title}`;
}

export function summarizeInProgressIssue(issues: BrIssueSummary[]): string {
  const [first] = issues;
  if (!first) return "none";
  if (issues.length === 1) return `${first.id} — ${first.title}`;
  return `${first.id} — ${first.title} +${issues.length - 1}`;
}

export function formatBeadsModeStatus(args: {
  beadsEnabled?: boolean;
  isBeadsProject?: boolean;
  modeText: string;
  issueCount: number;
  inProgressIssues: BrIssueSummary[];
}): string {
  if (args.beadsEnabled === false) {
    return BEADS_STATUS_OFF;
  }

  if (args.isBeadsProject === false) {
    return BEADS_STATUS_ON_NO_PROJECT;
  }

  return `beads: ${args.modeText} · ${args.issueCount} issue(s) · in-progress: ${summarizeInProgressIssue(args.inProgressIssues)}`;
}

export function summarizeBeadsActionResult(action: BeadsAction, stdout: string): string {
  const firstLine = stdout.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";

  switch (action) {
    case "create": {
      const match = firstLine.match(/Created\s+(\S+):\s+(.+)/);
      if (match) return `Created ${match[1]} — ${match[2]}`;
      return firstLine || "created";
    }

    case "claim": {
      const idMatch = firstLine.match(/Updated\s+(\S+):\s+(.+)/);
      if (idMatch) return `Claimed ${idMatch[1]} — ${idMatch[2]}`;
      return firstLine || "claimed";
    }

    case "close": {
      const match = firstLine.match(/Closed\s+(\S+):\s+(.+)/);
      if (match) return `Closed ${match[1]} — ${match[2]}`;
      return firstLine || "closed";
    }

    case "comment": {
      const match = firstLine.match(/Comment added to\s+(\S+)/);
      if (match) return `Comment added to ${match[1]}`;
      return firstLine || "comment added";
    }

    case "ready": {
      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length || /no\s+(open|ready)/i.test(firstLine)) return "No ready issues";
      return `${lines.length} ready issue(s)`;
    }

    case "show": {
      const match = firstLine.match(/[○●✓✗]\s+(\S+)\s+·\s+(.+?)\s+\[/);
      if (match) return `${match[1]} — ${match[2].trim()}`;
      return firstLine || "shown";
    }

    case "status": {
      const total = stdout.match(/Total Issues:\s+(\d+)/);
      const open = stdout.match(/Open:\s+(\d+)/);
      const inProgress = stdout.match(/In Progress:\s+(\d+)/);
      const closed = stdout.match(/Closed:\s+(\d+)/);
      if (total) {
        const parts = [`${total[1]} total`];
        if (open && open[1] !== "0") parts.push(`${open[1]} open`);
        if (inProgress && inProgress[1] !== "0") parts.push(`${inProgress[1]} in-progress`);
        if (closed && closed[1] !== "0") parts.push(`${closed[1]} closed`);
        return parts.join(", ");
      }
      return firstLine || "status";
    }
  }
}

function normalizeIssueRow(row: unknown): BrIssueSummary | null {
  if (!isRecord(row)) return null;

  if (typeof row.id !== "string" || !row.id.trim()) return null;
  const title = typeof row.title === "string" && row.title.trim() ? row.title : "(untitled issue)";

  return {
    id: row.id,
    title,
    type: typeof row.type === "string" ? row.type : typeof row.issue_type === "string" ? row.issue_type : undefined,
    priority: typeof row.priority === "number" ? row.priority : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
  };
}
