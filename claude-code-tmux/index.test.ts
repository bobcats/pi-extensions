import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { buildScriptArgs, resolveWorkingDirectory, runClaudeCodeTmux, type ScriptResult } from "./index.ts";

test("buildScriptArgs passes task, cwd, timeout, and keep-open", () => {
  const args = buildScriptArgs(
    {
      task: "do work",
      timeoutSeconds: 99999,
      keepOpen: true,
    },
    "/tmp/work",
  );

  assert.deepEqual(args, [
    "--json",
    "--cwd",
    "/tmp/work",
    "--timeout",
    "7200",
    "--task",
    "do work",
    "--keep-open",
  ]);
});

test("resolveWorkingDirectory keeps cwd inside workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-code-tmux-test-"));
  const resolved = await resolveWorkingDirectory(root, ".");
  assert.equal(resolved, await realpath(root));

  await assert.rejects(
    () => resolveWorkingDirectory(root, ".."),
    /cwd must stay inside the current workspace/,
  );
});

test("runClaudeCodeTmux formats script JSON results", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-code-tmux-test-"));
  const scriptResult: ScriptResult = {
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({
      ok: true,
      status: "completed",
      session: "s1",
      socket: "/tmp/sock",
      cwd: await realpath(root),
      claudeCommand: "claude --dangerously-skip-permissions --tools Read,Edit,MultiEdit,Write,Glob,Grep,LS,TodoWrite --allowedTools Read,Edit,MultiEdit,Write,Glob,Grep,LS,TodoWrite",
      allowedTools: "Read,Edit,MultiEdit,Write,Glob,Grep,LS,TodoWrite",
      keptOpen: false,
      transcript: "done",
    }),
  };

  const result = await runClaudeCodeTmux(
    { task: "do work" },
    root,
    {
      scriptPath: "/unused",
      runScript: async () => scriptResult,
    },
  );

  assert.equal(result.details.ok, true);
  assert.match(result.content[0].text, /Claude Code tmux status: completed/);
  assert.match(result.content[0].text, /Allowed tools: Read,Edit,MultiEdit,Write,Glob,Grep,LS,TodoWrite/);
  assert.match(result.content[0].text, /Transcript:\ndone/);
});
