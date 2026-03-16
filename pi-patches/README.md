# pi patches

Reapply local pi patches after pi upgrades.

## Apply

```bash
./scripts/reapply-pi-patches.sh
```

## What it patches

### pi-tui (tmux image rendering)

Adds tmux passthrough wrapping and Kitty Unicode placeholder protocol so images
render correctly inside tmux. Without this patch, Kitty/iTerm2 escape sequences
are not wrapped in `\ePtmux;...\e\\` and images appear broken.

Patch file: `pi-patches/pi-tui/pi-tui-tmux.patch`
New file:   `pi-patches/pi-tui/dist/placeholder-diacritics.js`

## Options

Target a specific pi version or install path:

```bash
./scripts/reapply-pi-patches.sh 0.56.2
./scripts/reapply-pi-patches.sh /path/to/pi-coding-agent
```

Timestamped backups are stored in `pi-patches/backups/`.

## Notes

- The pi-context tree navigation patch (issue #1781) was removed — the
  pi-context extension now handles message buffer sync via `navigateTree`
  at `agent_end`.
- Patches use unified diff format. If a pi upgrade changes the patched files,
  `patch` will fail loudly instead of silently clobbering new code.
