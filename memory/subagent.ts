import { spawn } from "node:child_process";
import * as fs from "node:fs";
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

export interface SubagentResult {
  output: string;
  exitCode: number;
  stderr: string;
}

export function parseSessionMessages(jsonlContent: string): SessionMessage[] {
  const messages: SessionMessage[] = [];
  for (const line of jsonlContent.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "message" || !entry.message?.role) continue;
      const role = entry.message.role;
      if (role !== "user" && role !== "assistant") continue;

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

      const text = textParts.join("\n").trim();
      if (text) messages.push({ role, text });
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

export async function runSubagent(
  agentPath: string,
  task: string,
  cwd: string,
): Promise<SubagentResult> {
  const args = [
    "--mode", "json",
    "-p",
    "--no-session",
    "--append-system-prompt", agentPath,
    `Task: ${task}`,
  ];

  return new Promise((resolve) => {
    const proc = spawn("pi", args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
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
      resolve({ output, exitCode: code ?? 1, stderr });
    });

    proc.on("error", () => {
      resolve({ output: "", exitCode: 1, stderr: "Failed to spawn pi" });
    });
  });
}
