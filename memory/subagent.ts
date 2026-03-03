import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function buildVaultSnapshot(dir: string): string {
  const sections: string[] = [];

  function walk(currentDir: string, prefix: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(currentDir, entry.name), relativePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const content = fs.readFileSync(path.join(currentDir, entry.name), "utf-8");
        sections.push(`=== ${relativePath} ===\n${content}`);
      }
    }
  }

  walk(dir, "");
  return sections.join("\n\n");
}

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
}

// Matches brainmaxxing extract-conversations.py limits
const USER_TEXT_LIMIT = 3000;
const ASSISTANT_TEXT_LIMIT = 800;
const MIN_TEXT_LENGTH = 10;
export const MIN_FILE_SIZE = 500;

export interface SubagentResult {
  output: string;
  exitCode: number;
  stderr: string;
  logFile: string;
}

export function encodeProjectSessionPath(cwd: string): string {
  return "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--";
}

export function parseSessionMessages(jsonlContent: string): SessionMessage[] {
  const messages: SessionMessage[] = [];
  for (const line of jsonlContent.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry.message?.role) continue;
      const role = entry.message.role;
      if (role !== "user" && role !== "assistant") continue;

      // Skip meta messages (e.g. tool results injected by the system)
      if (role === "user" && entry.isMeta) continue;

      const textParts: string[] = [];
      const content = entry.message.content;
      if (typeof content === "string") {
        textParts.push(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string") {
            textParts.push(part.text);
          }
        }
      }

      for (const t of textParts) {
        const clean = t.trim();
        if (clean.length <= MIN_TEXT_LENGTH) continue;
        // Skip system-reminder-only messages
        if (clean.startsWith("<system-reminder>") && clean.endsWith("</system-reminder>")) continue;

        const limit = role === "user" ? USER_TEXT_LIMIT : ASSISTANT_TEXT_LIMIT;
        messages.push({ role, text: `[${role.toUpperCase()}]: ${t.slice(0, limit)}` });
      }
    } catch {
      // ignore malformed lines
    }
  }
  return messages;
}

export function batchConversations(conversations: string[], numBatches: number): string[][] {
  const batches: string[][] = Array.from({ length: numBatches }, () => []);
  for (let i = 0; i < conversations.length; i++) {
    batches[i % numBatches].push(conversations[i]);
  }
  return batches;
}

export interface ExtractResult {
  outputDir: string;
  conversationCount: number;
  batches: string[]; // paths to batch manifest files
}

/**
 * Extract conversations from a sessions directory into per-conversation text files
 * and batch manifests, mirroring brainmaxxing's extract-conversations.py.
 */
export interface DateFilter {
  fromDate?: Date;
  toDate?: Date;
}

export function extractConversations(
  sessionsDir: string,
  outputDir: string,
  numBatches: number,
  options?: DateFilter,
): ExtractResult {
  // Find JSONL files, filter by min size, sort by mtime descending
  const jsonlFiles: { path: string; mtime: number }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const stat = fs.statSync(full);
        if (stat.size >= MIN_FILE_SIZE) {
          if (options?.fromDate && stat.mtime < options.fromDate) continue;
          if (options?.toDate && stat.mtime > options.toDate) continue;
          jsonlFiles.push({ path: full, mtime: stat.mtimeMs });
        }
      }
    }
  };
  walk(sessionsDir);
  jsonlFiles.sort((a, b) => b.mtime - a.mtime);

  // Extract messages per conversation, write to individual files
  fs.mkdirSync(outputDir, { recursive: true });
  const extracted: string[] = [];

  for (let idx = 0; idx < jsonlFiles.length; idx++) {
    const raw = fs.readFileSync(jsonlFiles[idx].path, "utf-8");
    const msgs = parseSessionMessages(raw);
    if (msgs.length === 0) continue;

    const basename = path.basename(jsonlFiles[idx].path, ".jsonl");
    const outPath = path.join(outputDir, `${String(idx).padStart(3, "0")}_${basename}.txt`);
    fs.writeFileSync(outPath, msgs.map((m) => m.text).join("\n\n"));
    extracted.push(outPath);
  }

  // Create batch manifests
  const batchDir = path.join(outputDir, "batches");
  fs.mkdirSync(batchDir, { recursive: true });
  const batchSize = Math.max(1, Math.ceil(extracted.length / numBatches));
  const batchPaths: string[] = [];

  for (let b = 0; b < numBatches; b++) {
    const batchFiles = extracted.slice(b * batchSize, (b + 1) * batchSize);
    if (batchFiles.length === 0) continue;
    const manifestPath = path.join(batchDir, `batch_${b}.txt`);
    fs.writeFileSync(manifestPath, batchFiles.join("\n") + "\n");
    batchPaths.push(manifestPath);
  }

  return { outputDir, conversationCount: extracted.length, batches: batchPaths };
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolName: string; args: Record<string, unknown> };

export function parseJsonEvent(line: string): StreamEvent | null {
  try {
    const event = JSON.parse(line);
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      return { type: "text_delta", text: event.assistantMessageEvent.delta };
    }
    if (event.type === "tool_execution_start") {
      return { type: "tool_call", toolName: event.toolName, args: event.args };
    }
    return null;
  } catch {
    return null;
  }
}

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes

export async function runSubagent(
  agentPath: string,
  task: string,
  cwd: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  onData?: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<SubagentResult> {
  const args = [
    "--mode", "json",
    "-p",
    "--no-session",
    "--append-system-prompt", agentPath,
    `Task: ${task}`,
  ];

  const logFile = path.join(os.tmpdir(), `pi-subagent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);

  if (signal?.aborted) {
    const stderr = "Subagent cancelled";
    const log = [
      "=== subagent cancelled before spawn ===",
      `agent: ${agentPath}`,
      `cwd: ${cwd}`,
    ].join("\n");
    fs.writeFileSync(logFile, log);
    return { output: "", exitCode: 1, stderr, logFile };
  }

  return new Promise((resolve) => {
    const proc = spawn("pi", args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: SubagentResult) => {
      if (resolved) return;
      resolved = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => {
      proc.kill();
      const cancelStderr = "Subagent cancelled";
      const log = [
        "=== subagent cancelled ===",
        `agent: ${agentPath}`,
        `cwd: ${cwd}`,
        "",
        "=== stderr ===",
        stderr || "(empty)",
      ].join("\n");
      fs.writeFileSync(logFile, log);
      finish({ output: "", exitCode: 1, stderr: cancelStderr, logFile });
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    timeout = setTimeout(() => {
      proc.kill();
      const timeoutStderr = `Subagent timed out after ${Math.round(timeoutMs / 1000)}s`;
      const log = [
        `=== subagent timeout ===`,
        `agent: ${agentPath}`,
        `cwd: ${cwd}`,
        `timeout: ${timeoutMs}ms`,
        ``,
        `=== stderr ===`,
        stderr || "(empty)",
      ].join("\n");
      fs.writeFileSync(logFile, log);
      finish({ output: "", exitCode: 1, stderr: timeoutStderr, logFile });
    }, timeoutMs);
    timeout.unref();

    let stdoutBuffer = "";

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      if (onData) {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) {
          const event = parseJsonEvent(line);
          if (event) onData(event);
        }
      }
    });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (resolved) return;

      let output = "";
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "message_end" && event.message?.role === "assistant") {
            for (const part of event.message.content) {
              if (part.type === "text") output = part.text;
            }
          }
        } catch {
          // ignore malformed lines
        }
      }

      const log = [
        `=== subagent log ===`,
        `agent: ${agentPath}`,
        `cwd: ${cwd}`,
        `args: ${JSON.stringify(args)}`,
        `exitCode: ${code}`,
        `output length: ${output.length}`,
        `stderr length: ${stderr.length}`,
        ``,
        `=== stderr ===`,
        stderr || "(empty)",
        ``,
        `=== stdout ===`,
        stdout || "(empty)",
      ].join("\n");
      fs.writeFileSync(logFile, log);

      finish({ output, exitCode: code ?? 1, stderr, logFile });
    });

    proc.on("error", (err) => {
      if (resolved) return;

      const log = [
        `=== subagent spawn error ===`,
        `agent: ${agentPath}`,
        `error: ${err.message}`,
      ].join("\n");
      fs.writeFileSync(logFile, log);

      finish({ output: "", exitCode: 1, stderr: "Failed to spawn pi", logFile });
    });
  });
}
