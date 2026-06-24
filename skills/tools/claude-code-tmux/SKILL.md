---
name: claude-code-tmux
description: Drive Claude Code through an isolated interactive tmux session instead of `claude -p`, always with `--dangerously-skip-permissions` and a constrained no-Bash tool set. Use when asked to run or delegate work to Claude Code while preserving an inspectable terminal session, avoiding non-interactive Claude Code, or working across agents that can run shell scripts.
compatibility: Requires tmux, Claude Code CLI (`claude`), Claude authentication, and shell access.
metadata:
  bucket: tools
---

# Claude Code via tmux

Use this to run Claude Code interactively through tmux, not through `claude -p`. The helper always appends `--dangerously-skip-permissions` and constrains Claude Code to `Read,Edit,MultiEdit,Write,Glob,Grep,LS,TodoWrite` (no Bash).

## Workflow

1. **Prefer the helper script**
   ```bash
   scripts/claude-code-tmux --cwd . --task "Investigate the failing test and report findings" --timeout 1800 --keep-open
   ```

2. **For longer prompts, pipe stdin**
   ```bash
   cat <<'EOF' | scripts/claude-code-tmux --cwd . --timeout 1800 --keep-open
   <task>
   EOF
   ```

3. **Review the result**
   - The script appends a unique completion marker to the task and waits for it in the tmux pane.
   - Confirm the returned `claudeCommand` includes `--dangerously-skip-permissions` and the constrained tool list.
   - Return the transcript, session name, socket path, timeout/completion status, and whether the pane was left open.
   - If the run times out, tell the user where to attach instead of claiming completion.

4. **Clean up when appropriate**
   - Omit `--keep-open` for disposable runs.
   - If kept open, kill only the private session/socket created by the script when the user no longer needs it.

## Guardrails

- Do not use this when normal local tools are enough; it is for explicitly driving Claude Code as another interactive agent.
- Do not send secrets unless the user explicitly approves; tmux pane history can retain them.
- Keep the tmux socket private. Do not attach to or kill user-owned tmux sessions.
- Do not broaden the default Claude Code tool set for routine use; no Bash is intentional.
- Remember that this avoids `claude -p`, but it still depends on Claude Code CLI behavior and auth.

## Stop and ask

Ask before continuing if Claude Code is not installed/authenticated, the environment lacks tmux, or the task requires shell/Bash/network/destructive access outside the constrained tool set.

## Output

Report: command used, allowed tools, session/socket, cwd, status, transcript evidence, and cleanup/kept-open state.
