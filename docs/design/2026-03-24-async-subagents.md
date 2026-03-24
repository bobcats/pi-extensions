# Async Subagents with Tmux Panes

## Goal

Add async execution, tmux pane visibility, a status widget, and agent configuration features to the subagent extension. The main agent keeps working while subagents run in background tmux panes. Results steer back on completion.

## Decisions

| Feature | Decision |
|---------|----------|
| Async mode | Opt-in via `async: true` parameter. Default stays synchronous. |
| Tmux panes | Async only. Sync keeps invisible `spawn()` with piped stdio. |
| Pane lifecycle | Always closes on exit. No `auto-exit` flag. |
| Result delivery | `sendMessage({ deliverAs: "steer", triggerTurn: true })` immediately on completion. |
| Status widget | Persistent TUI widget. Copy from HazAT's pi-interactive-subagents. Hidden when empty. |
| Notification | Desktop notification on completion via existing `notify` event. |
| `thinking` | Frontmatter default, overridable per tool invocation. Uses `--thinking` flag. |
| `spawning` | Boolean. `false` spawns child with `--no-extensions` — lean process, no subagent tool. |
| `skills` | Comma-separated in frontmatter. Passed via `--skill <path>` flags. |
| `cwd` | Frontmatter default. Per-invocation `cwd` param overrides. |
| Async chains | Not supported. Chains depend on `{previous}` — async breaks sequencing. |

## Frontmatter Changes

Four new optional fields in agent `.md` files:

```yaml
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
thinking: high          # off | minimal | low | medium | high | xhigh
spawning: false         # default true — prevents sub-subagents
skills: brave-search    # comma-separated skill names
cwd: ./src              # default working directory
---
```

`AgentConfig` gains matching fields:

```typescript
interface AgentConfig {
  // existing
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "bundled" | "user" | "project";
  filePath: string;
  // new
  thinking?: string;
  spawning?: boolean;  // default true
  skills?: string[];
  cwd?: string;
}
```

## Tool Parameter Changes

Two new optional parameters on the `subagent` tool:

```typescript
async: Type.Optional(Type.Boolean({
  description: "Run in background. Returns immediately, result steers back on completion.",
  default: false,
})),
thinking: Type.Optional(Type.String({
  description: "Override thinking level: off, minimal, low, medium, high, xhigh",
})),
```

### Mode interaction with `async`

| Mode | `async: false` (default) | `async: true` |
|------|--------------------------|---------------|
| Single | Blocks, streams via `onUpdate` | Tmux pane, returns immediately |
| Parallel | Blocks, concurrency-limited | Each task gets a tmux pane, results steer back individually |
| Chain | Blocks, sequential | Error — not supported |

### Resolution order

**Thinking:** tool param → agent frontmatter → none.

**Cwd:** tool param → agent frontmatter → `ctx.cwd`.

**Spawning:** agent frontmatter only (not overridable at call time).

## Tmux Pane Spawning

Async invocations spawn into a tmux split pane instead of invisible child processes. The subagent runs interactively (no `--mode json`) so the user can watch it work. A session file captures output for result extraction.

```typescript
const runId = crypto.randomUUID().slice(0, 8);
const sessionFile = path.join(os.tmpdir(), `pi-subagent-${runId}.jsonl`);

// Create pane without stealing focus (-d), get pane ID back
const pane = execFileSync("tmux", [
  "split-window", "-h", "-d", "-P", "-F", "#{pane_id}",
], { encoding: "utf8" }).trim();

// Build pi command with session file for result extraction
const piCmd = buildPiCommand(args); // includes --session <sessionFile>, NOT --mode json
const shellCmd = `pi ${piCmd}; echo '__SUBAGENT_DONE_'$?'__'`;

// Send command to the pane
execFileSync("tmux", ["send-keys", "-t", pane, "-l", shellCmd]);
execFileSync("tmux", ["send-keys", "-t", pane, "Enter"]);
```

- `tmux split-window -h -d` opens a horizontal split without stealing focus from the main session.
- `--session <file>` writes the session JSONL so the watcher can extract the final assistant message.
- `__SUBAGENT_DONE_N__` sentinel marks completion with exit code — detected by polling `tmux capture-pane`.
- The pane is closed by the watcher after result extraction.

## Background Watcher

A fire-and-forget watcher monitors each async run via sentinel polling and delivers results. Starts per-run; no singleton needed.

```
subagent tool ──spawn pane──→ tmux pane (pi running interactively)
              ──register run──→ asyncRuns map + widget refresh
              ──fire watcher──→ pollForExit (1s interval, reads pane screen)
                                    │
                 sentinel found ────┘
                                    │
                 read session JSONL → extract last assistant message
                 close pane ────────→ tmux kill-pane
                 cleanup temp files → prompt file, session file
                 steer result back ─→ sendMessage + notify
                 remove from map ───→ widget updates
```

```typescript
// Fire-and-forget per async run (inside runAsyncAgent)
pollForExit(pane, abortSignal, { interval: 1000, onTick: () => updateWidget(...) })
  .then((exitCode) => {
    const summary = readLastAssistantMessage(run.sessionFile);
    asyncRuns.delete(run.id);
    updateWidget(latestCtx, asyncRuns);
    closePane(pane);
    cleanupTempFiles(run); // prompt file + session file

    pi.sendMessage(
      {
        customType: "subagent_result",
        content: `Async subagent "${run.agent}" ${exitCode === 0 ? "completed" : "failed"}.\n\n${summary}`,
        display: true,
        details: { runId: run.id, agent: run.agent, task: run.task, exitCode },
      },
      { triggerTurn: true, deliverAs: "steer" },
    );

    pi.events.emit("notify", {
      title: `Subagent done: ${run.agent}`,
      body: exitCode === 0 ? "Completed" : "Failed",
    });
  })
  .catch(() => {
    asyncRuns.delete(run.id);
    updateWidget(latestCtx, asyncRuns);
    try { closePane(pane); } catch {}
    cleanupTempFiles(run);
  });
```

**Result extraction:** The watcher reads the session JSONL file (`--session <file>`) and finds the last assistant message. This is the same pattern HazAT uses — `getNewEntries()` + `findLastAssistantMessage()`.

**Error handling:** If the subagent crashes, the sentinel still fires (the shell emits it after pi exits with non-zero). The watcher reads whatever was written, reports the error, and cleans up.

**Orphan cleanup on shutdown:** `session_shutdown` iterates `asyncRuns`, closes each pane, clears the map, and stops the widget timer.

## Status Widget

Persistent TUI widget showing running async subagents. **Copy from HazAT's pi-interactive-subagents** and adapt to our extension structure.

```
╭─ Subagents ──────────────────────── 2 running ─╮
│ 00:23  scout "analyze auth module"              │
│ 01:12  worker "implement caching layer"         │
╰─────────────────────────────────────────────────╯
```

- Hidden when no async agents are running.
- 1-second timer updates the elapsed clock.
- Read HazAT's source to match their widget registration API usage exactly.

## `spawning: false` Implementation

When `spawning` is `false`, the child process gets `--no-extensions`. This is intentionally a sledgehammer — a subagent with `spawning: false` should be lean. No extensions means no subagent tool, no extra overhead, no surprises. The agent's `tools` field controls which built-in tools it gets.

```typescript
if (agent.spawning === false) {
  args.push("--no-extensions");
}
```

## `thinking` Implementation

Verified: pi supports `--thinking <level>` natively.

```typescript
const thinking = params.thinking ?? agent.thinking;
if (thinking) {
  args.push("--thinking", thinking);
}
```

No model string mangling needed.

## `skills` Implementation

Verified: pi supports `--skill <path>` and `--no-skills`.

When agent frontmatter specifies skills, resolve each skill name to its `SKILL.md` path (same discovery as pi: project `.pi/skills/`, user `~/.pi/agent/skills/`), then pass `--skill <path>` for each.

## `cwd` Implementation

Resolved working directory, in priority order:

1. Per-invocation `cwd` param (from tool call)
2. Agent frontmatter `cwd` field
3. `ctx.cwd` (parent session's working directory)

Relative paths in frontmatter resolve against the project root.
