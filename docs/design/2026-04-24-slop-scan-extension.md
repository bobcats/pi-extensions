# Slop Scan Extension

## Goal

Add a pi integration for [`slop-scan`](https://github.com/modem-dev/slop-scan) that gives the agent a structured checkpoint tool and gives users a manual `/slop-scan` command.

`slop-scan` is a repository/path analyzer for JavaScript and TypeScript code, not a stdin or single-snippet checker. The pi integration should therefore treat it as a review/completion checkpoint for meaningful JS/TS work, not as an every-edit hook.

## Decisions

| Topic | Decision |
|---|---|
| Primary integration | Pi extension |
| Agent tool | `slop_scan` |
| Manual command | `/slop-scan [path]` |
| Prompt-only integration | Rejected — prompt templates add no capability |
| Skill-only integration | Rejected for v1 — leaves command execution and parsing to the model |
| Execution path | Use `slop-scan`'s exported TypeScript/JS library API, not the CLI binary |
| Dependency | Add `slop-scan` as the extension package dependency |
| Scope default | `.` resolved relative to `ctx.cwd` |
| Explicit path | Supported for subtrees under `ctx.cwd` |
| Outside-cwd paths | Rejected for v1 |
| Stdin | Not supported |
| Single-file special mode | Not supported |
| Delta comparison | Not shipped in v1 |
| Automatic hook | Not shipped — model-directed checkpointing only |
| Full report storage | Write full JSON to a temp file; keep session `details` compact |

## Why an extension

`slop-scan` already produces structured analysis: summary metrics, file scores, directory scores, findings, metadata, and configuration-aware results. A pi extension can expose that structure directly to the agent.

A prompt template would only tell the model to shell out. A skill would improve the workflow text, but the model would still own invocation, parsing, truncation, and error handling. The extension makes scanning deterministic, testable, and reusable from both the agent tool and the slash command.

## Architecture

Add a new extension package:

```text
slop-scan/
├── index.ts
├── index.test.ts
└── package.json
```

The local extension package should be named `pi-slop-scan` so it can depend on the npm package named `slop-scan` without ambiguity.

Update the root `package.json` `pi.extensions` list to include `./slop-scan/index.ts`.

The extension exports `createSlopScanExtension(deps?)` for testability and defaults to real `slop-scan` dependencies in production.

## Library API integration

Use the public package export from `slop-scan`. The published package exposes:

- `analyzeRepository`
- `loadConfigFile`
- `createDefaultRegistry`
- `buildReportMetadata`
- `AnalysisResult` and related types

The scan helper mirrors the upstream CLI scan flow:

1. Resolve the target root.
2. Verify the target is a directory.
3. Treat the target as both the scan root and config root.
4. Load `slop-scan.config.*` from the target root with `loadConfigFile(rootDir)`.
5. Create the default registry with `createDefaultRegistry()`.
6. Register plugins returned by config loading.
7. Run `analyzeRepository(rootDir, config, registry)`.
8. Attach report metadata with `buildReportMetadata(config, plugins)`.
9. Return the `AnalysisResult` to the pi formatting layer.

This intentionally matches upstream `slop-scan scan <path>` semantics. Scanning `src/` means `src/` is the analysis/config root; v1 does not support "scan this subtree while using a different repo-root config". Users who need root config should scan `.` or a package root that owns its own config.

This avoids subprocess execution, avoids JSON parsing failures, and keeps tests simple through dependency injection.

## Tool API

Register `slop_scan`:

| Parameter | Type | Default | Notes |
|---|---:|---:|---|
| `path` | string | `.` | Target repo/subtree to scan. Leading `@` is stripped for compatibility with pi file mentions. |
| `maxFindings` | integer | `10` | Maximum number of findings to include in compact output and details. Clamp to `0..50`. |

Prompt metadata should make the intended behavior explicit:

- Use `slop_scan` during JS/TS code-review and refactor tasks.
- Use `slop_scan` after meaningful JS/TS edits before claiming completion.
- Do not run `slop_scan` after every edit.
- Treat findings as leads, not proof of authorship or required changes.
- Prefer passing a relevant package/subtree scan root when the repo is large, understanding that the passed path becomes the `slop-scan` config root.

## Command API

Register `/slop-scan [path]`.

The command uses the same scan helper and formatter as the tool. It defaults to `.` and shows a compact notification with the summary and temp report path.

The command is for manual inspection. The agent-facing tool is the main workflow integration.

## Path handling

Path normalization rules:

1. Default missing or empty path to `.`.
2. Strip a single leading `@` to tolerate pi file mention style.
3. Resolve relative paths against `ctx.cwd`.
4. Canonicalize `ctx.cwd` and the target with `realpath` when possible.
5. Reject targets outside `ctx.cwd`.
6. Reject non-directory targets with a clear "slop_scan scans directories, not files" error.
7. Pass the resolved target root to `slop-scan`.

This keeps v1 safe and predictable. `@src/file.ts` is accepted syntactically because pi may insert file mentions, but it resolves to a file and is rejected rather than treated as a special single-file scan. Broader scans outside the current project can be added later if a real workflow needs them.

## Output strategy

The agent should see a compact report, not the full JSON.

Compact text includes:

- root path
- file count, directory count, function count, logical lines
- finding count and repo score
- normalized metrics when present
- top file hotspots by score, capped at 5
- top directory hotspots by score, capped at 5
- top findings capped by `maxFindings` (`0..50`, default 10)
- temp report path for full JSON

Tool `details` stores only compact structured data:

- `rootDir`
- `summary`
- `fileScores` capped at 5
- `directoryScores` capped at 5
- `findings` capped by clamped `maxFindings`
- `reportPath` when temp-file writing succeeds

The full `AnalysisResult` is written to a temp JSON file. This preserves full fidelity for follow-up inspection without bloating pi session files.

## Error handling

| Condition | Behavior |
|---|---|
| Path missing/empty | Use `.` |
| Path outside `ctx.cwd` | Throw a clear tool error / notify command error |
| Target does not exist | Throw a clear tool error / notify command error |
| Target is a file | Throw `slop_scan scans directories, not files` / notify command error |
| Config load error | Surface the upstream error |
| Plugin load error | Surface the upstream error |
| Analysis error | Surface the upstream error |
| Temp report write fails | Return compact summary and omit `reportPath` |
| No findings | Return a clean summary with zero findings |

## Testing strategy

Use dependency injection instead of running real slop analysis in unit tests.

Test cases:

1. Registers the `slop_scan` tool.
2. Registers the `/slop-scan` command.
3. Defaults missing path to `.`.
4. Strips leading `@` from path arguments.
5. Rejects paths outside `ctx.cwd`.
6. Rejects non-directory targets.
7. Calls injected scanner with the resolved target directory.
8. Documents and tests that the target directory is the config root.
9. Formats summary metrics from an injected `AnalysisResult`.
10. Caps findings according to clamped `maxFindings`.
11. Caps file and directory scores at 5.
12. Stores compact data in `details` instead of the full report.
13. Writes full JSON to a temp report when possible.
14. Continues without `reportPath` when temp writing fails.
15. Command reports success through `ctx.ui.notify`.
16. Command reports errors through `ctx.ui.notify`.
17. Prompt guidelines include review/refactor/completion checkpoint behavior.

Run tests with the repo convention:

```bash
cd slop-scan && npm test
```

## Explicit non-goals for v1

- No stdin scanning.
- No single-file special mode.
- No automatic scan on every edit or tool call.
- No file mutation or automated remediation.
- No `slop_scan_delta` yet.
- No custom TUI renderer.
- No workspace-root auto-detection.
- No prompt template.
- No remediation skill.

## Future extensions

Potential follow-ups after v1 ships:

- `slop_scan_delta` wrapping upstream delta APIs.
- Workspace-root detection for monorepos.
- A `slop-remediate` skill that runs scan → fixes high-signal issues → reruns scan.
- A `/slop-scan --changed` command that scans inferred changed subtrees.
- Custom result renderer for a richer TUI summary.

## Verification performed for this design

- Confirmed pi extension APIs for tools, commands, prompt snippets, and prompt guidelines in the local pi docs.
- Confirmed pi package dependency behavior in the local pi package docs.
- Confirmed current repo packaging pattern in root `package.json` and existing extension packages.
- Confirmed `slop-scan` package metadata via npm/package source: version `0.3.0`, package export, `type: module`, and public library entry.
- Confirmed `slop-scan` exports include `analyzeRepository`, `loadConfigFile`, `createDefaultRegistry`, and `buildReportMetadata`.
- Confirmed `AnalysisResult` shape includes `summary`, `findings`, `fileScores`, and `directoryScores`.

## References

- `package.json` — root pi package manifest
- `tldraw-desktop/index.ts` — compact extension with multiple tools and a command
- `exa/index.ts` — dependency-backed extension and tool registration patterns
- Pi docs: extensions, skills, prompt templates, packages
- `slop-scan` README and package source
