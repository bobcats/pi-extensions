import importlib.util
import json
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "scripts" / "build.py"


def load_build_module():
    spec = importlib.util.spec_from_file_location("bobcats_skills_build", BUILD_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["bobcats_skills_build"] = module
    spec.loader.exec_module(module)
    return module


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


class BuildInstallerTest(unittest.TestCase):
    def setUp(self):
        self.build = load_build_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def tree_target(self, source: Path, destination: Path):
        return self.build.InstallTarget("bobcats-unified-skills", source, destination, "tree")

    @contextmanager
    def build_path_patches(self, skills_dir: Path, memory_skills_dir: Path, prompts_dir: Path, build_dir: Path):
        with mock.patch.object(self.build, "SHARED_SKILLS_DIR", skills_dir), mock.patch.object(
            self.build, "SKILLS_DIR", skills_dir
        ), mock.patch.object(self.build, "EXTENSION_SKILLS_DIR", memory_skills_dir), mock.patch.object(
            self.build, "AUTHORED_SKILL_ROOTS", (skills_dir, memory_skills_dir)
        ), mock.patch.object(
            self.build, "PROMPTS_DIR", prompts_dir
        ), mock.patch.object(
            self.build, "BUILD_DIR", build_dir
        ):
            yield

    def test_build_flattens_nested_skill_directories(self):
        skills_dir = self.root / "skills"
        build_dir = self.root / "build"
        write_file(
            skills_dir / "engineering" / "diagnose" / "SKILL.md",
            "---\nname: diagnose\ndescription: Debug failures.\n---\n\n# Diagnose\n",
        )
        write_file(
            skills_dir / "engineering" / "diagnose" / "references" / "notes.md",
            "details\n",
        )
        write_file(
            skills_dir / "deprecated" / "old-skill" / "SKILL.md",
            "---\nname: old-skill\ndescription: Old.\n---\n",
        )

        with self.build_path_patches(skills_dir, self.root / "memory" / "skills", self.root / "prompts", build_dir):
            self.build.build_skills()

        self.assertTrue((build_dir / "skills" / "diagnose" / "SKILL.md").exists())
        self.assertEqual(
            (build_dir / "skills" / "diagnose" / "references" / "notes.md").read_text(),
            "details\n",
        )
        self.assertFalse((build_dir / "skills" / "old-skill").exists())

    def test_build_uses_shared_and_extension_skill_roots(self):
        skills_dir = self.root / "skills"
        memory_skills_dir = self.root / "memory" / "skills"
        prompts_dir = self.root / "prompts"
        build_dir = self.root / "build"
        write_file(
            skills_dir / "engineering" / "demo" / "SKILL.md",
            "---\nname: demo\ndescription: Demo.\n---\n\n# Demo\n",
        )
        write_file(
            memory_skills_dir / "memory-ingest" / "SKILL.md",
            "---\nname: memory-ingest\ndescription: Ingest memory.\n---\n\n# Memory ingest\n",
        )
        write_file(
            build_dir / "skills" / "stale" / "SKILL.md",
            "stale\n",
        )

        with self.build_path_patches(skills_dir, memory_skills_dir, prompts_dir, build_dir):
            self.build.build_skills()

        self.assertTrue((build_dir / "skills" / "demo" / "SKILL.md").exists())
        self.assertTrue((build_dir / "skills" / "memory-ingest" / "SKILL.md").exists())
        self.assertFalse((build_dir / "skills" / "stale").exists())

    def test_built_memory_ingest_runner_is_self_contained(self):
        skills_dir = self.root / "skills"
        prompts_dir = self.root / "prompts"
        build_dir = self.root / "build"

        with self.build_path_patches(skills_dir, ROOT / "memory" / "skills", prompts_dir, build_dir):
            self.build.build_skills()

        built_scripts = build_dir / "skills" / "memory-ingest" / "scripts"
        self.assertTrue((built_scripts / "ingest-core.ts").exists())
        self.assertNotIn("../../../ingest.ts", (built_scripts / "ingest-runner.ts").read_text())
        self.assertIn('./ingest-core.ts', (built_scripts / "ingest-runner.ts").read_text())
        built_skill = (build_dir / "skills" / "memory-ingest" / "SKILL.md").read_text()
        self.assertIn("npx tsx scripts/ingest-runner.ts", built_skill)
        self.assertNotIn("memory/skills/memory-ingest/scripts", built_skill)

    def test_duplicate_authored_skill_names_fail_across_roots(self):
        skills_dir = self.root / "skills"
        memory_skills_dir = self.root / "memory" / "skills"
        prompts_dir = self.root / "prompts"
        build_dir = self.root / "build"
        write_file(skills_dir / "engineering" / "demo" / "SKILL.md", "---\nname: demo\n---\n")
        write_file(memory_skills_dir / "demo" / "SKILL.md", "---\nname: demo\n---\n")

        with self.build_path_patches(skills_dir, memory_skills_dir, prompts_dir, build_dir):
            with self.assertRaisesRegex(RuntimeError, "Duplicate skill name 'demo'"):
                self.build.build_skills()

    def test_build_generates_prompt_skills_with_metadata_and_wrapper(self):
        skills_dir = self.root / "skills"
        memory_skills_dir = self.root / "memory" / "skills"
        prompts_dir = self.root / "prompts"
        build_dir = self.root / "build"
        write_file(
            prompts_dir / "zoom-out.md",
            "---\ndescription: Ask for a higher-level map\nargument-hint: \"[area]\"\n---\n\nI don't know this area: $ARGUMENTS\nUse args: $@ and first: $1\n",
        )
        write_file(prompts_dir / "README.md", "# Prompt docs\n")

        with self.build_path_patches(skills_dir, memory_skills_dir, prompts_dir, build_dir):
            self.build.build_skills()

        generated = (build_dir / "skills" / "prompt-zoom-out" / "SKILL.md").read_text()
        self.assertIn("name: prompt-zoom-out", generated)
        self.assertIn("description: \"Ask for a higher-level map\"", generated)
        self.assertIn("disable-model-invocation: true", generated)
        self.assertIn("source-prompt: \"zoom-out\"", generated)
        self.assertIn("argument-hint: \"[area]\"", generated)
        self.assertIn("$ARGUMENTS", generated)
        self.assertIn("user input supplied with the manual skill invocation", generated)
        self.assertFalse((build_dir / "skills" / "prompt-README").exists())
        self.assertFalse((skills_dir / "prompt-zoom-out").exists())
        self.assertFalse((memory_skills_dir / "prompt-zoom-out").exists())

    def test_prompt_skill_generation_uses_prompt_prefix_to_avoid_authored_collision(self):
        skills_dir = self.root / "skills"
        memory_skills_dir = self.root / "memory" / "skills"
        prompts_dir = self.root / "prompts"
        build_dir = self.root / "build"
        write_file(
            skills_dir / "review" / "code-review" / "SKILL.md",
            "---\nname: code-review\ndescription: Review code.\n---\n\n# Review\n",
        )
        write_file(
            prompts_dir / "code-review.md",
            "---\ndescription: Prompt review\n---\n\nReview: $@\n",
        )

        with self.build_path_patches(skills_dir, memory_skills_dir, prompts_dir, build_dir):
            self.build.build_skills()

        self.assertTrue((build_dir / "skills" / "code-review" / "SKILL.md").exists())
        self.assertTrue((build_dir / "skills" / "prompt-code-review" / "SKILL.md").exists())

    def test_prompt_skill_generation_fails_on_generated_name_collision(self):
        skills_dir = self.root / "skills"
        memory_skills_dir = self.root / "memory" / "skills"
        prompts_dir = self.root / "prompts"
        build_dir = self.root / "build"
        write_file(skills_dir / "engineering" / "prompt-zoom-out" / "SKILL.md", "---\nname: prompt-zoom-out\n---\n")
        write_file(prompts_dir / "zoom-out.md", "---\ndescription: Zoom\n---\n\nZoom\n")

        with self.build_path_patches(skills_dir, memory_skills_dir, prompts_dir, build_dir):
            with self.assertRaisesRegex(RuntimeError, "Duplicate skill name 'prompt-zoom-out'"):
                self.build.build_skills()

    def test_prompt_skill_generation_fails_on_duplicate_prompt_generated_names(self):
        skills_dir = self.root / "skills"
        memory_skills_dir = self.root / "memory" / "skills"
        prompts_dir = self.root / "prompts"
        build_dir = self.root / "build"
        first_prompt = prompts_dir / "zoom-out.md"
        second_prompt = prompts_dir / "nested" / "zoom-out.md"
        write_file(first_prompt, "---\ndescription: Zoom\n---\n\nZoom\n")
        write_file(second_prompt, "---\ndescription: Zoom again\n---\n\nZoom again\n")

        with self.build_path_patches(skills_dir, memory_skills_dir, prompts_dir, build_dir), mock.patch.object(
            self.build,
            "discover_prompt_templates",
            return_value=[("zoom-out", first_prompt), ("zoom-out", second_prompt)],
        ):
            with self.assertRaisesRegex(RuntimeError, "Duplicate skill name 'prompt-zoom-out'"):
                self.build.build_skills()

    def test_install_flow_installs_generated_prompt_skills_to_all_targets(self):
        skills_dir = self.root / "skills"
        memory_skills_dir = self.root / "memory" / "skills"
        prompts_dir = self.root / "prompts"
        build_dir = self.root / "build"
        agents_destination = self.root / "home" / ".agents" / "skills"
        claude_destination = self.root / "home" / ".claude" / "skills"
        state_dir = self.root / "state"
        manifest_path = state_dir / "install-manifest.json"
        lock_path = state_dir / "install.lock"
        write_file(prompts_dir / "zoom-out.md", "---\ndescription: Zoom out\n---\n\nZoom $ARGUMENTS\n")
        write_file(
            memory_skills_dir / "memory-ingest" / "SKILL.md",
            "---\nname: memory-ingest\ndescription: Ingest memory.\n---\n\n# Memory ingest\n",
        )

        with self.build_path_patches(skills_dir, memory_skills_dir, prompts_dir, build_dir), mock.patch.object(
            self.build,
            "INSTALL_PATHS",
            {"claude": claude_destination, "unified": agents_destination},
        ), mock.patch.object(self.build, "STATE_DIR", state_dir), mock.patch.object(
            self.build, "MANIFEST_PATH", manifest_path
        ), mock.patch.object(self.build, "LOCK_PATH", lock_path):
            self.build.build_skills()
            self.build.install_skills()

        manifest = json.loads(manifest_path.read_text())
        for target_name in ("bobcats-claude-skills", "bobcats-unified-skills"):
            self.assertIn("prompt-zoom-out/SKILL.md", manifest["targets"][target_name]["files"])
            self.assertIn("memory-ingest/SKILL.md", manifest["targets"][target_name]["files"])
        for destination in (agents_destination, claude_destination):
            generated = (destination / "prompt-zoom-out" / "SKILL.md").read_text()
            self.assertIn("name: prompt-zoom-out", generated)
            self.assertIn("disable-model-invocation: true", generated)
            self.assertTrue((destination / "memory-ingest" / "SKILL.md").exists())

    def test_install_without_manifest_allows_empty_destination(self):
        source = self.root / "build" / "skills"
        destination = self.root / "home" / ".agents" / "skills"
        manifest_path = self.root / "state" / "install-manifest.json"
        write_file(source / "demo" / "SKILL.md", "repo version\n")

        result = self.build.safe_install_targets(
            [self.tree_target(source, destination)], manifest_path=manifest_path, force=False
        )

        self.assertEqual(result.files_written, 1)
        self.assertEqual((destination / "demo" / "SKILL.md").read_text(), "repo version\n")
        self.assertTrue(manifest_path.exists())

    def test_install_without_manifest_requires_force_for_non_empty_destination(self):
        source = self.root / "build" / "skills"
        destination = self.root / "home" / ".agents" / "skills"
        manifest_path = self.root / "state" / "install-manifest.json"
        write_file(source / "demo" / "SKILL.md", "repo version\n")
        write_file(destination / "custom" / "SKILL.md", "manual skill\n")

        with self.assertRaisesRegex(self.build.InstallConflict, "FORCE=1"):
            self.build.safe_install_targets(
                [self.tree_target(source, destination)], manifest_path=manifest_path, force=False
            )

        self.assertEqual((destination / "custom" / "SKILL.md").read_text(), "manual skill\n")
        self.assertFalse(manifest_path.exists())

    def test_force_bootstrap_preserves_unmanaged_siblings(self):
        source = self.root / "build" / "skills"
        destination = self.root / "home" / ".agents" / "skills"
        manifest_path = self.root / "state" / "install-manifest.json"
        write_file(source / "demo" / "SKILL.md", "repo version\n")
        write_file(destination / "demo" / "SKILL.md", "local version\n")
        write_file(destination / "custom" / "SKILL.md", "manual skill\n")

        self.build.safe_install_targets(
            [self.tree_target(source, destination)], manifest_path=manifest_path, force=True
        )

        self.assertEqual((destination / "demo" / "SKILL.md").read_text(), "repo version\n")
        self.assertEqual((destination / "custom" / "SKILL.md").read_text(), "manual skill\n")
        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(set(manifest["targets"]), {"bobcats-unified-skills"})

    def test_normal_install_removes_stale_managed_files_only(self):
        source = self.root / "build" / "skills"
        destination = self.root / "home" / ".agents" / "skills"
        manifest_path = self.root / "state" / "install-manifest.json"
        write_file(source / "demo" / "SKILL.md", "repo v1\n")
        write_file(source / "demo" / "script.py", "print('v1')\n")
        target = self.tree_target(source, destination)
        self.build.safe_install_targets([target], manifest_path=manifest_path, force=True)

        (source / "demo" / "script.py").unlink()
        write_file(destination / "custom" / "SKILL.md", "manual skill\n")

        result = self.build.safe_install_targets([target], manifest_path=manifest_path, force=False)

        self.assertEqual(result.files_removed, 1)
        self.assertTrue((destination / "demo" / "SKILL.md").exists())
        self.assertFalse((destination / "demo" / "script.py").exists())
        self.assertEqual((destination / "custom" / "SKILL.md").read_text(), "manual skill\n")

    def test_safe_install_targets_updates_both_agent_roots_and_manifest(self):
        source = self.root / "build" / "skills"
        agents_destination = self.root / "home" / ".agents" / "skills"
        claude_destination = self.root / "home" / ".claude" / "skills"
        manifest_path = self.root / "state" / "install-manifest.json"
        write_file(source / "demo" / "SKILL.md", "repo v1\n")
        write_file(source / "prompt-zoom-out" / "SKILL.md", "disable-model-invocation: true\n")
        write_file(source / "stale" / "SKILL.md", "stale v1\n")
        targets = [
            self.build.InstallTarget("bobcats-claude-skills", source, claude_destination, "tree"),
            self.build.InstallTarget("bobcats-unified-skills", source, agents_destination, "tree"),
        ]
        self.build.safe_install_targets(targets, manifest_path=manifest_path, force=True)

        (source / "stale" / "SKILL.md").unlink()
        (source / "stale").rmdir()
        write_file(agents_destination / "custom" / "SKILL.md", "manual skill\n")
        write_file(claude_destination / "custom" / "SKILL.md", "manual skill\n")

        result = self.build.safe_install_targets(targets, manifest_path=manifest_path, force=False)

        self.assertEqual(result.files_removed, 2)
        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(set(manifest["targets"]), {"bobcats-claude-skills", "bobcats-unified-skills"})
        for target_name in manifest["targets"]:
            self.assertIn("prompt-zoom-out/SKILL.md", manifest["targets"][target_name]["files"])
        for destination in (agents_destination, claude_destination):
            self.assertTrue((destination / "demo" / "SKILL.md").exists())
            self.assertTrue((destination / "prompt-zoom-out" / "SKILL.md").exists())
            self.assertFalse((destination / "stale").exists())
            self.assertEqual((destination / "custom" / "SKILL.md").read_text(), "manual skill\n")

    def test_install_cleanup_removes_deprecated_skill_entries(self):
        source = self.root / "build" / "skills"
        destination = self.root / "home" / ".agents" / "skills"
        skills_dir = self.root / "skills"
        target = self.tree_target(source, destination)
        previous_manifest = {
            "version": self.build.MANIFEST_VERSION,
            "targets": {target.name: {"files": {"old-skill/SKILL.md": "previous-hash"}}},
        }
        write_file(source / "demo" / "SKILL.md", "repo version\n")
        write_file(destination / "old-skill" / "SKILL.md", "previous install\n")
        write_file(destination / "custom" / "SKILL.md", "manual skill\n")
        write_file(skills_dir / "deprecated" / "old-skill" / "SKILL.md", "deprecated\n")

        with mock.patch.object(self.build, "SKILLS_DIR", skills_dir):
            removed = self.build.remove_deprecated_install_entries(
                [target], self.build.deprecated_skill_names(), previous_manifest
            )

        self.assertEqual(removed, 1)
        self.assertFalse((destination / "old-skill").exists())
        self.assertEqual((destination / "custom" / "SKILL.md").read_text(), "manual skill\n")

    def test_install_cleanup_preserves_unmanaged_files_inside_managed_deprecated_skill(self):
        source = self.root / "build" / "skills"
        destination = self.root / "home" / ".agents" / "skills"
        skills_dir = self.root / "skills"
        target = self.tree_target(source, destination)
        previous_manifest = {
            "version": self.build.MANIFEST_VERSION,
            "targets": {target.name: {"files": {"old-skill/SKILL.md": "previous-hash"}}},
        }
        write_file(destination / "old-skill" / "SKILL.md", "previous install\n")
        write_file(destination / "old-skill" / "local-note.md", "manual note\n")
        write_file(skills_dir / "deprecated" / "old-skill" / "SKILL.md", "deprecated\n")

        with mock.patch.object(self.build, "SKILLS_DIR", skills_dir):
            removed = self.build.remove_deprecated_install_entries(
                [target], self.build.deprecated_skill_names(), previous_manifest
            )

        self.assertEqual(removed, 1)
        self.assertFalse((destination / "old-skill" / "SKILL.md").exists())
        self.assertEqual((destination / "old-skill" / "local-note.md").read_text(), "manual note\n")

    def test_install_cleanup_preserves_unmanaged_deprecated_name(self):
        source = self.root / "build" / "skills"
        destination = self.root / "home" / ".agents" / "skills"
        skills_dir = self.root / "skills"
        write_file(destination / "old-skill" / "SKILL.md", "manual skill\n")
        write_file(skills_dir / "deprecated" / "old-skill" / "SKILL.md", "deprecated\n")

        with mock.patch.object(self.build, "SKILLS_DIR", skills_dir):
            removed = self.build.remove_deprecated_install_entries(
                [self.tree_target(source, destination)], self.build.deprecated_skill_names(), self.build.empty_manifest()
            )

        self.assertEqual(removed, 0)
        self.assertEqual((destination / "old-skill" / "SKILL.md").read_text(), "manual skill\n")

    def test_force_replaces_symlink_leaf_without_following_it(self):
        source = self.root / "build" / "skills"
        destination = self.root / "home" / ".agents" / "skills"
        manifest_path = self.root / "state" / "install-manifest.json"
        outside = self.root / "outside.txt"
        write_file(source / "demo" / "SKILL.md", "repo version\n")
        write_file(outside, "outside original\n")
        (destination / "demo").mkdir(parents=True)
        (destination / "demo" / "SKILL.md").symlink_to(outside)

        self.build.safe_install_targets(
            [self.tree_target(source, destination)], manifest_path=manifest_path, force=True
        )

        installed = destination / "demo" / "SKILL.md"
        self.assertFalse(installed.is_symlink())
        self.assertEqual(installed.read_text(), "repo version\n")
        self.assertEqual(outside.read_text(), "outside original\n")


if __name__ == "__main__":
    unittest.main()
