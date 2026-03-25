# Async Subagent Tmux Policy

## Goal

Refine async subagent UI behavior so single async runs remain visible and local, while parallel async runs avoid destroying the tmux layout.

## Problem

The current async implementation always creates a tmux split next to the spawning pi pane. That works for one-off tasks but fails for parallel fanout. Launching many async tasks creates too many splits, makes the layout unreadable, and couples visibility to whatever pane the user happens to be focused on.

We want a policy that preserves the main pi workflow, scales to parallel work, and still lets the user observe background execution.

## Decisions

| Case | Behavior |
| --- | --- |
| Single async | Open a temporary split next to the spawning pi pane |
| Parallel async | Open a dedicated tmux window for that batch |
| Parallel window naming | Derive from the source pi pane/window identity |
| Parallel layout | One pane per task, tiled |
| Single cleanup | Auto-close pane on completion |
| Parallel cleanup | Auto-close the batch window when the last task finishes |
| Non-tmux environment | Fail fast with a clear error |

## UX Policy

Async mode should behave differently for single and parallel work.

**Single async** remains local and immediate. When the agent launches one async task, the extension creates a horizontal split beside the pi pane that spawned it. The user can watch the subagent work in context without losing the main layout. When the task finishes, the pane closes automatically.

**Parallel async** should not create a stack of splits. Instead, the extension creates a dedicated tmux window for that batch. Each task gets its own pane within that window, and the window is tiled after all panes are created. This keeps the main pi pane stable and gives parallel work a separate, inspectable workspace.

## Naming Policy

A dedicated parallel window must be associated with the pi pane that spawned it. We should not use a shared global name like `subagents`, because multiple pi sessions may exist inside the same tmux session.

The window name should be **source-derived**, based on the spawning pane or window identity. The exact format can be finalized during implementation, but the name should be:

- human-readable
- traceable to the source pi pane
- unique enough to avoid collisions

A practical format is something like `subagents-5-a1b2`, where `5` comes from the source window and `a1b2` is a short batch ID.

## Architecture

The async orchestration layer should move from a pure run-based model to a mixed **run + batch** model.

### Single async

A single async task is still one run:

- source pane ID
- spawned pane ID
- session file
- temp files
- watcher state

### Parallel async

A parallel async launch becomes a batch:

- source pi pane/window identity
- tmux window ID/name
- child run IDs
- completed count
- auto-close policy

Each child run still owns its own pane ID, session file, temp files, and steer-back result. The batch exists only to manage tmux window creation, tiled layout, and cleanup when the last child finishes.

## Tmux Helper Responsibilities

The tmux helper layer should expose explicit operations instead of a single split primitive:

- `createSplitWithCommand(parentPane, name, command)`
- `createWindow(name, parentPane)`
- `createPaneInWindow(windowId, name, command)`
- `tileWindow(windowId)`
- `closePane(paneId)`
- `closeWindow(windowId)`
- `readScreen(paneId, lines)`
- `pollForExit(paneId, signal, opts)`

This keeps single and parallel flows separate while reusing watcher logic.

## Data Flow

### Single async flow

1. Validate tmux environment
2. Create split next to the spawning pi pane
3. Run interactive pi with auto-exit extension loaded
4. Poll the pane for sentinel completion
5. Read the session file and extract the last assistant message
6. Steer the result back to the parent session
7. Close the pane

### Parallel async flow

1. Validate tmux environment
2. Create a dedicated tmux window for the batch
3. Create one pane per task inside that window
4. Tile the window
5. Start one watcher per child run
6. Steer each result back independently as tasks finish
7. When the last child completes, close the batch window

## Error Handling

- If `async: true` is requested without tmux, fail fast
- If window creation fails for a parallel batch, do not launch any tasks
- If one child task fails, still let other child tasks run to completion
- If window cleanup fails, do not block result delivery
- Cleanup must be batch-aware: individual child completion should not close the parallel window early

## Verification Targets

The implementation should verify three behaviors:

1. Single async opens beside the correct pi pane and auto-closes
2. Parallel async creates a dedicated window, tiles panes, and closes only after the last child finishes
3. Results steer back correctly for both successful and failed child tasks

## Non-Goals

This design does **not** add:

- headless async without tmux
- persistent completed windows for inspection
- user-configurable cleanup policies
- dynamic switching between split and window modes based on task count

Those can come later if needed. For now, the rule stays simple:

- single async = split
- parallel async = dedicated window
