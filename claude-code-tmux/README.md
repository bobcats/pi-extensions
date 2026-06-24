# claude-code-tmux

Pi tool wrapper for the portable `claude-code-tmux` skill helper.

The core implementation lives at:

```text
skills/tools/claude-code-tmux/scripts/claude-code-tmux
```

Pi exposes it as the `claude_code_tmux` tool. Skill-only agents can use the same script through the `claude-code-tmux` skill after `make build` / `make install`.

Requirements:

- `tmux`
- Claude Code CLI (`claude`)
- existing Claude authentication in the execution environment

The tool launches Claude Code interactively in a private tmux session, always appending `--dangerously-skip-permissions` plus a constrained built-in tool set (`Read,Edit,MultiEdit,Write,Glob,Grep,LS,TodoWrite`; no Bash). It pastes the task, waits for a generated completion marker, and returns the captured transcript plus session/socket metadata.
