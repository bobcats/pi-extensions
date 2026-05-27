---
name: python
description: Idiomatic Python guidance for writing, reviewing, and refactoring Python code. Use for Python packaging, tests, typing, scripts, CLIs, data processing, or code-quality audits.
metadata:
  bucket: languages
---

# Python

Prefer explicit, typed, testable Python with project-native tooling.

## Workflow

1. Detect the project tooling: `pyproject.toml`, `uv.lock`, `pytest`, `ruff`, `mypy`/`pyright`.
2. Follow existing package layout and import style.
3. Model data with dataclasses, typed dicts, Pydantic, or plain types based on existing patterns.
4. Keep I/O at the edges; make parsing and transformation functions easy to test.
5. Add tests through public behavior; avoid asserting implementation details.
6. Use project-native tests, lint, and type checks as evidence; broaden checks when public APIs, packaging, or data contracts changed.

## Guardrails

- Prefer `uv` when the project already uses it; do not introduce a new package manager casually.
- Avoid bare `except`, mutable default arguments, global runtime state, and implicit relative imports.
- Do not use `Any`, casts, or `type: ignore` to silence design problems.
- Parse external data at boundaries; do not pass raw dicts deep into the system.
- Prefer pathlib and context managers for filesystem work.

## Review checklist

- error handling preserves cause and actionable context
- types describe domain shapes rather than generic dict/list blobs
- tests include semantic invalid inputs and edge cases
- CLI/scripts have clear exit behavior and stderr/stdout separation
- async code has cancellation/error propagation when relevant

## Evidence

Before claiming completion, include evidence for focused behavior, static checks when configured, packaging/runtime compatibility, and boundary parsing.

## Stop and ask

Ask if runtime/tooling choice, data contract, or compatibility target is unclear.
