import { spawn } from "node:child_process";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export type ClaudeCodeTmuxParams = {
  task: string;
  cwd?: string;
  timeoutSeconds?: number;
  keepOpen?: boolean;
};

export type ClaudeCodeTmuxDeps = {
  runScript?: (args: string[], signal?: AbortSignal) => Promise<ScriptResult>;
  scriptPath?: string;
};

export type ScriptResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_SECONDS = 1800;
const MAX_TIMEOUT_SECONDS = 7200;

function extensionDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function defaultScriptPath(): string {
  return path.resolve(extensionDir(), "../skills/tools/claude-code-tmux/scripts/claude-code-tmux");
}

function clampTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TIMEOUT_SECONDS;
  return Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, Math.trunc(value)));
}

function isInside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveWorkingDirectory(baseCwd: string, input: string | undefined): Promise<string> {
  const requested = input?.trim() || ".";
  const resolved = path.resolve(baseCwd, requested);
  const [realBase, realTarget] = await Promise.all([realpath(baseCwd), realpath(resolved)]);

  if (!isInside(realBase, realTarget)) {
    throw new Error(`claude_code_tmux cwd must stay inside the current workspace: ${requested}`);
  }

  const targetStat = await stat(realTarget);
  if (!targetStat.isDirectory()) {
    throw new Error(`claude_code_tmux cwd is not a directory: ${requested}`);
  }

  return realTarget;
}

export function buildScriptArgs(params: ClaudeCodeTmuxParams, cwd: string): string[] {
  const args = [
    "--json",
    "--cwd",
    cwd,
    "--timeout",
    String(clampTimeout(params.timeoutSeconds)),
    "--task",
    params.task,
  ];

  if (params.keepOpen) args.push("--keep-open");

  return args;
}

export function defaultRunScript(scriptPath: string): (args: string[], signal?: AbortSignal) => Promise<ScriptResult> {
  return (args: string[], signal?: AbortSignal) => new Promise((resolve, reject) => {
    const child = spawn(scriptPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

type JsonParseResult =
  | { ok: true; value: any }
  | { ok: false; error: string };

function parseJsonResult(result: ScriptResult): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function formatToolText(details: any | null, result: ScriptResult, parseError?: string): string {
  if (!details) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    return [
      `claude-code-tmux failed to return JSON (exit ${result.exitCode ?? "unknown"}).`,
      parseError ? `JSON parse error: ${parseError}` : "",
      stderr,
      stdout,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const lines = [
    `Claude Code tmux status: ${details.status ?? "unknown"}`,
    `Session: ${details.session ?? "unknown"}`,
    `Socket: ${details.socket ?? "unknown"}`,
    `Cwd: ${details.cwd ?? "unknown"}`,
    `Claude command: ${details.claudeCommand ?? "unknown"}`,
    `Allowed tools: ${details.allowedTools ?? "unknown"}`,
    `Kept open: ${details.keptOpen ? "yes" : "no"}`,
  ];

  if (details.error) lines.push(`Error: ${details.error}`);
  if (result.exitCode && result.exitCode !== 0) lines.push(`Exit code: ${result.exitCode}`);
  if (details.transcript) lines.push("", "Transcript:", String(details.transcript).trim());
  if (result.stderr.trim()) lines.push("", "stderr:", result.stderr.trim());

  return lines.join("\n");
}

export async function runClaudeCodeTmux(
  params: ClaudeCodeTmuxParams,
  baseCwd: string,
  deps: Required<ClaudeCodeTmuxDeps>,
  signal?: AbortSignal,
) {
  const cwd = await resolveWorkingDirectory(baseCwd, params.cwd);
  const result = await deps.runScript(buildScriptArgs(params, cwd), signal);
  const parsed = parseJsonResult(result);
  const details = parsed.ok ? parsed.value : null;

  return {
    content: [{ type: "text" as const, text: formatToolText(details, result, parsed.ok ? undefined : parsed.error) }],
    details: {
      ok: details?.ok ?? false,
      exitCode: result.exitCode,
      stderr: result.stderr,
      parseError: parsed.ok ? undefined : parsed.error,
      result: details,
    },
  };
}

export function createClaudeCodeTmuxExtension(deps: ClaudeCodeTmuxDeps = {}) {
  const scriptPath = deps.scriptPath ?? defaultScriptPath();
  const resolvedDeps: Required<ClaudeCodeTmuxDeps> = {
    scriptPath,
    runScript: deps.runScript ?? defaultRunScript(scriptPath),
  };

  return function claudeCodeTmux(pi: ExtensionAPI) {
    pi.registerTool({
      name: "claude_code_tmux",
      label: "Claude Code tmux",
      description:
        "Drive Claude Code through an isolated interactive tmux session instead of `claude -p`. Always launches with `--dangerously-skip-permissions` and a constrained Claude Code tool set (no Bash). Requires tmux, the Claude Code CLI, and existing Claude auth.",
      promptSnippet: "Run Claude Code interactively in a private tmux session and capture the transcript.",
      promptGuidelines: [
        "Use when the user explicitly asks to drive Claude Code, avoid `claude -p`, or preserve an inspectable Claude Code terminal session.",
        "Do not use this for ordinary local shell work; it launches another coding agent.",
        "Warn that the environment must have tmux, the `claude` CLI, and Claude authentication.",
        "The wrapper always appends `--dangerously-skip-permissions` plus `--tools Read,Edit,MultiEdit,Write,Glob,Grep,LS,TodoWrite`; do not try to broaden tools for routine use.",
        "If the run times out, report the session/socket so the user can attach instead of claiming completion.",
        "Avoid sending secrets; tmux pane history can retain them.",
      ],
      parameters: Type.Object({
        task: Type.String({ description: "Task prompt to send to Claude Code." }),
        cwd: Type.Optional(Type.String({ description: "Workspace-relative directory to run Claude Code in. Defaults to the current working directory." })),
        timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_SECONDS, description: "Seconds to wait for the completion marker. Default 1800, max 7200." })),
        keepOpen: Type.Optional(Type.Boolean({ description: "Leave the private tmux session open after completion or timeout." })),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return runClaudeCodeTmux(params, ctx.cwd, resolvedDeps, signal);
      },
    });
  };
}

export default createClaudeCodeTmuxExtension();
