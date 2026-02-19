# @bobcats/pi-extensions

Extensions and skills for [pi](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [beads](./beads/) | Issue tracking via `br` CLI — tools, commands, hooks, and mode guards |
| [confirm-rm](./confirm-rm/) | Prompts before any `rm` command |
| [ext-prof](./ext-prof/) | Profiles extension handler execution time |
| [memory](./memory/) | Persistent agent memory across sessions |

## Install

```bash
pi install /path/to/pi-extensions
```

Or in `~/.pi/agent/settings.json`:

```json
{
  "packages": ["/path/to/pi-extensions"]
}
```

All extensions and skills load automatically. Use `pi config` to enable/disable individual resources.

## Development

Run tests:

```bash
cd beads && npm test
cd confirm-rm && npm test
cd ext-prof && npm test
cd memory && npm test
```

Hot-reload in a running session:

```
/reload
```

## License

MIT
