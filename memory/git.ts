import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function isGitRepo(dir: string): boolean {
  try {
    git(dir, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

function gitCommit(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.name=memory", "-c", "user.email=memory@local", "commit", "-m", message]);
}

export function initGitRepo(dir: string): void {
  if (isGitRepo(dir)) return;
  if (!fs.existsSync(dir)) return;

  git(dir, ["init"]);
  gitCommit(dir, "init: memory vault");
}

export function hasChanges(dir: string): boolean {
  if (!isGitRepo(dir)) return false;
  const status = git(dir, ["status", "--porcelain"]);
  return status.length > 0;
}

export function commitVaultChanges(dir: string, message: string): boolean {
  if (!hasChanges(dir)) return false;
  gitCommit(dir, message);
  return true;
}

export function undoLastCommit(dir: string): { success: true; undoneMessage: string } | { success: false; error: string } {
  if (!isGitRepo(dir)) return { success: false, error: "Not a git repository" };

  try {
    git(dir, ["rev-parse", "--verify", "HEAD~1"]);
  } catch {
    return { success: false, error: "Cannot undo initial commit" };
  }

  const lastMessage = git(dir, ["log", "-1", "--format=%s"]);
  git(dir, ["reset", "--hard", "HEAD~1"]);
  return { success: true, undoneMessage: lastMessage };
}

export function getLog(dir: string, count: number): string[] {
  if (!isGitRepo(dir)) return [];
  try {
    const output = git(dir, ["log", `--oneline`, `-${count}`]);
    return output ? output.split("\n") : [];
  } catch {
    return [];
  }
}
