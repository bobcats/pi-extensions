import * as fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

export function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitProbe(dir: string, args: string[]): { ok: boolean; stdout: string } {
  if (!fs.existsSync(dir)) return { ok: false, stdout: "" };
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
  };
}

function isGitWorkTree(dir: string): boolean {
  return gitProbe(dir, ["rev-parse", "--is-inside-work-tree"]).stdout === "true";
}

function hasHead(dir: string): boolean {
  return gitProbe(dir, ["rev-parse", "--verify", "HEAD"]).ok;
}

export function initGitRepo(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const toplevel = gitProbe(dir, ["rev-parse", "--show-toplevel"]);
  if (toplevel.ok && fs.realpathSync(toplevel.stdout) === fs.realpathSync(dir)) return;
  git(dir, ["init"]);
  git(dir, ["add", "-A"]);
  if (hasChanges(dir)) {
    git(dir, ["-c", "user.name=memory", "-c", "user.email=memory@local", "commit", "-m", "init: memory vault"]);
  }
}

export function hasChanges(dir: string): boolean {
  if (!isGitWorkTree(dir)) return false;
  const status = git(dir, ["status", "--porcelain"]);
  return status.length > 0;
}

export function getChangedFiles(dir: string): string[] {
  if (!isGitWorkTree(dir)) return [];
  const raw = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  return raw.split("\n").filter(Boolean).map((line) => line.slice(3).trim());
}

export function commitVault(dir: string, message: string): { committed: boolean; commit?: string } {
  if (!hasChanges(dir)) return { committed: false };
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.name=memory", "-c", "user.email=memory@local", "commit", "-m", message]);
  try {
    const sha = git(dir, ["rev-parse", "--short=7", "HEAD"]);
    return { committed: true, commit: sha };
  } catch {
    return { committed: true };
  }
}

export function undoLastCommit(dir: string): { success: true; undoneMessage: string } | { success: false; error: string } {
  try {
    git(dir, ["rev-parse", "--show-toplevel"]);
  } catch {
    return { success: false, error: "Not a git repository" };
  }
  try {
    git(dir, ["rev-parse", "--verify", "HEAD~1"]);
  } catch {
    return { success: false, error: "Cannot undo initial commit" };
  }
  const lastMessage = git(dir, ["log", "-1", "--format=%s"]);
  git(dir, ["reset", "--hard", "HEAD~1"]);
  return { success: true, undoneMessage: lastMessage };
}

export function getGitLog(dir: string, count: number): string[] {
  if (!isGitWorkTree(dir) || !hasHead(dir)) return [];
  const output = git(dir, ["log", "--oneline", `-${count}`]);
  return output ? output.split("\n") : [];
}
