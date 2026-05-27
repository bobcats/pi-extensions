---
name: tmux
description: Control interactive terminal programs with tmux. Use for REPLs, debuggers, long-running servers, CLIs, or programs that need keystrokes and pane scraping.
metadata:
  bucket: tools
---

# tmux

Use isolated tmux sessions for interactive work instead of fighting non-interactive shells.

## Workflow

1. **Create an isolated socket/session**
   ```bash
   SOCKET_DIR=${TMPDIR:-/tmp}/bobcats-tmux-sockets
   mkdir -p "$SOCKET_DIR"
   SOCKET="$SOCKET_DIR/agent.sock"
   SESSION=<slug>
   tmux -S "$SOCKET" new -d -s "$SESSION" -n shell
   ```

2. **Send commands/keys**
   ```bash
   tmux -S "$SOCKET" send-keys -t "$SESSION" 'python' C-m
   tmux -S "$SOCKET" send-keys -t "$SESSION" 'print(1)' C-m
   ```

3. **Capture output**
   ```bash
   tmux -S "$SOCKET" capture-pane -pt "$SESSION" -S -200
   ```
   - Wait/poll for prompts or expected output; `scripts/wait-for-text.sh` is available for regex/fixed-string polling.
   - Use `scripts/find-sessions.sh` to discover private tmux sessions when needed.
   - Keep a transcript of important commands/results.

4. **Clean up**
   ```bash
   tmux -S "$SOCKET" kill-session -t "$SESSION"
   ```

## Guardrails

- Use a private socket/session name; do not interfere with the user’s personal tmux.
- Do not leave runaway servers or REPLs unless the user needs them.
- Avoid sending secrets into pane history.

## Stop and ask

Ask before attaching to user-owned sessions, killing unknown sessions, or running destructive interactive commands.

## Output

Return session/socket used, commands sent, captured evidence, and cleanup status.
