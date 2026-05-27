#!/usr/bin/env python3
"""
Build and install Bobcats skills for AI coding agents.

Skill sources live in nested buckets under ./skills/<bucket>/<skill>/SKILL.md.
This builder flattens them into ./build/skills/<skill>/, then installs the
flattened tree for:
- Claude Code (~/.claude/skills)
- OpenCode, Pi, Codex (~/.agents/skills)

The installer uses a manifest and staged swaps so updates preserve unmanaged
files and refuse to overwrite local edits unless --force is provided.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterable
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Literal

if sys.version_info < (3, 11):
    sys.exit("Error: Python 3.11+ required")

ROOT = Path(__file__).parent.parent
SKILLS_DIR = ROOT / "skills"
BUILD_DIR = ROOT / "build"

HOME = Path.home()
INSTALL_PATHS = {
    "claude": HOME / ".claude" / "skills",
    "unified": HOME / ".agents" / "skills",  # OpenCode, Pi, Codex
}
STATE_DIR = Path(os.environ.get("XDG_STATE_HOME", HOME / ".local" / "state")) / "bobcats-skills"
MANIFEST_PATH = STATE_DIR / "install-manifest.json"
LOCK_PATH = STATE_DIR / "install.lock"
MANIFEST_VERSION = 1


class InstallConflict(RuntimeError):
    pass


@dataclass(frozen=True)
class InstallTarget:
    name: str
    source: Path
    destination: Path
    kind: Literal["tree", "file"]


@dataclass(frozen=True)
class InstallResult:
    files_written: int
    files_removed: int


@dataclass(frozen=True)
class StagedTarget:
    target: InstallTarget
    stage_path: Path
    previous_files: dict[str, str]
    next_files: dict[str, str]


@dataclass(frozen=True)
class SwappedTarget:
    target: InstallTarget
    backup_path: Path | None


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def remove_path(path: Path) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink()


def empty_manifest() -> dict:
    return {"version": MANIFEST_VERSION, "targets": {}}


def load_install_manifest(manifest_path: Path = MANIFEST_PATH) -> dict | None:
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("version") != MANIFEST_VERSION:
        raise InstallConflict(
            f"Unsupported bobcats-skills install manifest version at {manifest_path}. "
            "Run `make install FORCE=1` to reinitialize it."
        )
    return manifest


def iter_source_files(target: InstallTarget) -> dict[str, Path]:
    if target.kind == "file":
        if not target.source.is_file():
            return {}
        return {target.destination.name: target.source}

    files: dict[str, Path] = {}
    if not target.source.exists():
        return files

    for source_file in sorted(path for path in target.source.rglob("*") if path.is_file()):
        files[source_file.relative_to(target.source).as_posix()] = source_file
    return files


def destination_file(target: InstallTarget, relative_path: str) -> Path:
    if target.kind == "file":
        return target.destination
    return target.destination / relative_path


def target_files_from_manifest(manifest: dict, target: InstallTarget) -> dict[str, str]:
    target_data = manifest.get("targets", {}).get(target.name, {})
    return dict(target_data.get("files", {}))


def desired_hashes(target: InstallTarget) -> dict[str, str]:
    return {
        relative_path: hash_file(source_file)
        for relative_path, source_file in iter_source_files(target).items()
    }


def target_destination_is_empty(target: InstallTarget) -> bool:
    destination = target.destination
    if not destination.exists() and not destination.is_symlink():
        return True
    if target.kind == "file":
        return False
    if not destination.is_dir() or destination.is_symlink():
        return False
    return next(destination.iterdir(), None) is None


def ensure_non_empty_sources(targets: Iterable[InstallTarget]) -> None:
    empty = [str(target.source) for target in targets if not iter_source_files(target)]
    if empty:
        details = "\n".join(f"  - {path}" for path in empty)
        raise InstallConflict(f"Refusing to install empty source targets:\n{details}")


def manifest_for_install(
    targets: list[InstallTarget], manifest_path: Path, force: bool
) -> dict:
    try:
        manifest = load_install_manifest(manifest_path)
    except InstallConflict:
        if not force:
            raise
        return empty_manifest()

    if manifest is not None and not force:
        return manifest

    if manifest is not None and force:
        return empty_manifest()

    if force:
        return empty_manifest()

    non_empty = [target.destination for target in targets if not target_destination_is_empty(target)]
    if non_empty:
        details = "\n".join(f"  - {path}" for path in non_empty)
        raise InstallConflict(
            "No bobcats-skills install manifest found, and install destinations are not empty. "
            "Run `make install FORCE=1` once to initialize managed install state.\n"
            f"Non-empty destinations:\n{details}"
        )

    return empty_manifest()


def path_has_symlink_ancestor(path: Path, stop_at: Path) -> Path | None:
    """Return a symlink parent inside stop_at, ignoring system ancestors above it."""
    try:
        relative_parent = path.parent.relative_to(stop_at)
    except ValueError:
        return None

    current = stop_at
    for part in relative_parent.parts:
        current = current / part
        if current.exists() and current.is_symlink():
            return current
    return None


def validate_target_structure(target: InstallTarget, relative_paths: Iterable[str]) -> None:
    destination = target.destination

    if target.kind == "tree":
        if destination.exists() and (not destination.is_dir() or destination.is_symlink()):
            raise InstallConflict(f"{destination} must be a real directory")
    elif destination.exists() and destination.is_dir():
        raise InstallConflict(f"{destination} must be a file")

    for relative_path in relative_paths:
        file_path = destination_file(target, relative_path)
        symlink_parent = path_has_symlink_ancestor(file_path, destination)
        if symlink_parent is not None:
            raise InstallConflict(f"Refusing to write through symlink parent {symlink_parent}")
        if file_path.exists() and file_path.is_dir():
            raise InstallConflict(f"{file_path} is a directory, expected a file")


def preflight_install_targets(targets: list[InstallTarget], manifest: dict, force: bool) -> None:
    conflicts: list[str] = []

    for target in targets:
        previous_files = target_files_from_manifest(manifest, target)
        desired_files = desired_hashes(target)
        validate_target_structure(target, set(previous_files) | set(desired_files))

        if force:
            continue

        for relative_path, previous_hash in previous_files.items():
            destination = destination_file(target, relative_path)
            if not destination.exists() and not destination.is_symlink():
                if relative_path in desired_files:
                    conflicts.append(f"{destination} was locally deleted")
                continue
            if destination.is_symlink() or hash_file(destination) != previous_hash:
                conflicts.append(f"{destination} was locally modified")

        for relative_path, desired_hash in desired_files.items():
            destination = destination_file(target, relative_path)
            if relative_path in previous_files:
                continue
            if destination.exists() or destination.is_symlink():
                if destination.is_symlink() or hash_file(destination) != desired_hash:
                    conflicts.append(f"{destination} already exists and is not managed")

    if conflicts:
        details = "\n".join(f"  - {conflict}" for conflict in conflicts)
        raise InstallConflict(f"Refusing to overwrite locally modified install files:\n{details}")


def prune_empty_parents(path: Path, stop_at: Path) -> None:
    current = path.parent
    stop_at = stop_at.resolve()
    while current.exists() and current.resolve() != stop_at:
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def copy_destination_to_stage(target: InstallTarget, stage_path: Path) -> None:
    if target.kind == "tree":
        if target.destination.exists():
            shutil.copytree(target.destination, stage_path, symlinks=True)
        else:
            stage_path.mkdir(parents=True, exist_ok=True)
        return

    stage_path.parent.mkdir(parents=True, exist_ok=True)
    if target.destination.exists():
        shutil.copy2(target.destination, stage_path)


def stage_file_path(target: InstallTarget, stage_path: Path, relative_path: str) -> Path:
    if target.kind == "file":
        return stage_path
    return stage_path / relative_path


def stage_target(target: InstallTarget, stage_path: Path, manifest: dict) -> dict[str, str]:
    copy_destination_to_stage(target, stage_path)
    previous_files = target_files_from_manifest(manifest, target)
    files = iter_source_files(target)
    next_files: dict[str, str] = {}

    for relative_path in sorted(set(previous_files) - set(files)):
        staged_destination = stage_file_path(target, stage_path, relative_path)
        if staged_destination.exists() or staged_destination.is_symlink():
            staged_destination.unlink()
            if target.kind == "tree":
                prune_empty_parents(staged_destination, stage_path)

    for relative_path, source_file in files.items():
        staged_destination = stage_file_path(target, stage_path, relative_path)
        staged_destination.parent.mkdir(parents=True, exist_ok=True)
        if staged_destination.exists() or staged_destination.is_symlink():
            staged_destination.unlink()
        shutil.copy2(source_file, staged_destination)
        next_files[relative_path] = hash_file(staged_destination)

    return next_files


def unique_sibling_path(destination: Path, label: str) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1000):
        candidate = destination.with_name(
            f".{destination.name}.bobcats-skills-{label}-{os.getpid()}-{attempt}"
        )
        if not candidate.exists() and not candidate.is_symlink():
            return candidate
    raise RuntimeError(f"Could not allocate temporary {label} path next to {destination}")


def swap_target_into_place(stage_path: Path, target: InstallTarget) -> Path | None:
    backup_path = None
    if target.destination.exists() or target.destination.is_symlink():
        backup_path = unique_sibling_path(target.destination, "backup")
        target.destination.rename(backup_path)

    target.destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        stage_path.rename(target.destination)
    except Exception:
        if backup_path is not None and backup_path.exists():
            backup_path.rename(target.destination)
        raise
    return backup_path


def rollback_swaps(swapped: list[SwappedTarget]) -> None:
    for swapped_target in reversed(swapped):
        remove_path(swapped_target.target.destination)
        if swapped_target.backup_path is not None and swapped_target.backup_path.exists():
            swapped_target.backup_path.rename(swapped_target.target.destination)


def cleanup_backups(swapped: list[SwappedTarget]) -> None:
    for swapped_target in swapped:
        if swapped_target.backup_path is not None:
            remove_path(swapped_target.backup_path)


def cleanup_staged_paths(
    staged_targets: list[StagedTarget], staged_manifest: Path | None = None
) -> None:
    for staged_target in staged_targets:
        remove_path(staged_target.stage_path)
    if staged_manifest is not None:
        remove_path(staged_manifest)


def stage_install_targets(
    targets: list[InstallTarget], manifest: dict
) -> tuple[list[StagedTarget], dict, InstallResult]:
    next_manifest = deepcopy(manifest)
    files_written = 0
    files_removed = 0
    staged_targets: list[StagedTarget] = []

    try:
        for target in targets:
            stage_path = unique_sibling_path(target.destination, "stage")
            try:
                previous_files = target_files_from_manifest(next_manifest, target)
                next_files = stage_target(target, stage_path, next_manifest)
            except Exception:
                remove_path(stage_path)
                raise

            files_removed += len(set(previous_files) - set(next_files))
            files_written += len(next_files)
            next_manifest["targets"][target.name] = {
                "path": str(target.destination),
                "kind": target.kind,
                "files": next_files,
            }
            staged_targets.append(StagedTarget(target, stage_path, previous_files, next_files))
    except Exception:
        cleanup_staged_paths(staged_targets)
        raise

    return staged_targets, next_manifest, InstallResult(files_written, files_removed)


def write_staged_manifest(manifest: dict, manifest_path: Path) -> Path:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    staged_manifest = unique_sibling_path(manifest_path, "stage")
    try:
        staged_manifest.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    except Exception:
        remove_path(staged_manifest)
        raise
    return staged_manifest


def commit_staged_install(
    staged_targets: list[StagedTarget], staged_manifest: Path, manifest_path: Path
) -> None:
    swapped: list[SwappedTarget] = []
    try:
        for staged_target in staged_targets:
            backup_path = swap_target_into_place(staged_target.stage_path, staged_target.target)
            swapped.append(SwappedTarget(staged_target.target, backup_path))
        os.replace(staged_manifest, manifest_path)
    except Exception:
        rollback_swaps(swapped)
        raise
    else:
        cleanup_backups(swapped)


def safe_install_targets(
    targets: Iterable[InstallTarget],
    *,
    manifest_path: Path = MANIFEST_PATH,
    force: bool = False,
) -> InstallResult:
    targets = list(targets)
    ensure_non_empty_sources(targets)
    manifest = manifest_for_install(targets, manifest_path, force)
    preflight_install_targets(targets, manifest, force)

    staged_targets: list[StagedTarget] = []
    staged_manifest: Path | None = None
    try:
        staged_targets, next_manifest, result = stage_install_targets(targets, manifest)
        staged_manifest = write_staged_manifest(next_manifest, manifest_path)
        commit_staged_install(staged_targets, staged_manifest, manifest_path)
    finally:
        cleanup_staged_paths(staged_targets, staged_manifest)

    return result


def fix_skill_frontmatter_name(content: str, expected_name: str) -> str:
    """Fix SKILL.md frontmatter `name` to match the flattened directory name."""
    import re

    frontmatter_pattern = r"^---\s*\n(.*?)\n---"
    match = re.match(frontmatter_pattern, content, re.DOTALL)
    if not match:
        return content

    frontmatter = match.group(1)
    name_pattern = r"^name:\s*(.+)$"
    name_match = re.search(name_pattern, frontmatter, re.MULTILINE)
    if not name_match:
        return content

    current_name = name_match.group(1).strip().strip("\"'")
    if current_name == expected_name:
        return content

    new_frontmatter = re.sub(
        name_pattern, f"name: {expected_name}", frontmatter, flags=re.MULTILINE
    )
    return content[: match.start(1)] + new_frontmatter + content[match.end(1) :]


def discover_skill_sources() -> list[tuple[str, Path]]:
    if not SKILLS_DIR.exists():
        return []

    skills: list[tuple[str, Path]] = []
    names: dict[str, Path] = {}
    for skill_md in sorted(SKILLS_DIR.rglob("SKILL.md")):
        skill_dir = skill_md.parent
        relative_parts = skill_dir.relative_to(SKILLS_DIR).parts
        if "deprecated" in relative_parts:
            continue
        name = skill_dir.name
        if name in names:
            raise RuntimeError(
                f"Duplicate skill name {name!r}: {names[name]} and {skill_dir}. "
                "Flattened installs require unique skill directory names."
            )
        names[name] = skill_dir
        skills.append((name, skill_dir))
    return skills


def build_skill(name: str, source: Path) -> bool:
    skill_md = source / "SKILL.md"
    if not skill_md.exists():
        print(f"    Warning: {source} has no SKILL.md, skipping")
        return False

    raw_content = skill_md.read_text()

    dest = BUILD_DIR / "skills" / name
    dest.mkdir(parents=True, exist_ok=True)

    (dest / "SKILL.md").write_text(fix_skill_frontmatter_name(raw_content, name))

    for item in source.iterdir():
        if item.name == "SKILL.md":
            continue
        dest_item = dest / item.name
        if item.is_dir():
            shutil.copytree(item, dest_item, dirs_exist_ok=True)
        else:
            shutil.copy2(item, dest_item)

    return True


def build_skills() -> None:
    print("Building skills...")

    skills_build = BUILD_DIR / "skills"
    if skills_build.exists():
        shutil.rmtree(skills_build)
    skills_build.mkdir(parents=True)

    built = 0
    for name, source in discover_skill_sources():
        if build_skill(name, source):
            print(f"  {name}")
            built += 1

    print(f"  Built {built} skills")


@contextmanager
def install_lock():
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with LOCK_PATH.open("w") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        yield


def skill_install_targets() -> list[InstallTarget]:
    source = BUILD_DIR / "skills"
    return [
        InstallTarget("bobcats-claude-skills", source, INSTALL_PATHS["claude"], "tree"),
        InstallTarget("bobcats-unified-skills", source, INSTALL_PATHS["unified"], "tree"),
    ]


def deprecated_skill_names() -> set[str]:
    deprecated_dir = SKILLS_DIR / "deprecated"
    if not deprecated_dir.exists():
        return set()
    return {skill_md.parent.name for skill_md in deprecated_dir.rglob("SKILL.md")}


def remove_deprecated_install_entries(
    targets: Iterable[InstallTarget], deprecated_names: set[str]
) -> int:
    if not deprecated_names:
        return 0

    removed = 0
    for target in targets:
        if target.kind != "tree":
            continue
        for name in deprecated_names:
            entry = target.destination / name
            if entry.exists() or entry.is_symlink():
                remove_path(entry)
                removed += 1
    return removed


def install_skills(force: bool = False) -> None:
    print("Installing skills...")

    source = BUILD_DIR / "skills"
    if not source.exists():
        print("  No skills built, run 'make build' first")
        return

    targets = skill_install_targets()
    result = safe_install_targets(targets, force=force)
    deprecated_removed = remove_deprecated_install_entries(targets, deprecated_skill_names())

    count = len([path for path in source.iterdir() if path.is_dir()])
    for name, dest in INSTALL_PATHS.items():
        print(f"  {name}: {count} skills -> {dest}")
    print(f"  Synced {result.files_written} files, removed {result.files_removed} managed files")
    if deprecated_removed:
        print(f"  Removed {deprecated_removed} deprecated installed skill entries")


def clean() -> None:
    print("Cleaning build artifacts...")
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
        print("  Removed build directory")
    else:
        print("  Nothing to clean")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and install Bobcats agent skills")
    parser.add_argument(
        "command",
        choices=["build", "install", "install-skills", "clean"],
        help="Command to run",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite colliding install files and initialize/reset managed install state",
    )
    args = parser.parse_args()

    try:
        if args.command == "build":
            build_skills()
        elif args.command in {"install", "install-skills"}:
            with install_lock():
                build_skills()
                install_skills(force=args.force)
            print("\nAll done!")
        elif args.command == "clean":
            clean()
    except (InstallConflict, RuntimeError) as error:
        sys.exit(f"Error: {error}")


if __name__ == "__main__":
    main()
