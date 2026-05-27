import importlib.util
import json
import sys
import tempfile
import unittest
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

        with mock.patch.object(self.build, "SKILLS_DIR", skills_dir), mock.patch.object(
            self.build, "BUILD_DIR", build_dir
        ):
            self.build.build_skills()

        self.assertTrue((build_dir / "skills" / "diagnose" / "SKILL.md").exists())
        self.assertEqual(
            (build_dir / "skills" / "diagnose" / "references" / "notes.md").read_text(),
            "details\n",
        )
        self.assertFalse((build_dir / "skills" / "old-skill").exists())

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

    def test_install_cleanup_removes_deprecated_skill_entries(self):
        source = self.root / "build" / "skills"
        destination = self.root / "home" / ".agents" / "skills"
        skills_dir = self.root / "skills"
        write_file(source / "demo" / "SKILL.md", "repo version\n")
        write_file(destination / "old-skill" / "SKILL.md", "previous install\n")
        write_file(destination / "custom" / "SKILL.md", "manual skill\n")
        write_file(skills_dir / "deprecated" / "old-skill" / "SKILL.md", "deprecated\n")

        with mock.patch.object(self.build, "SKILLS_DIR", skills_dir):
            removed = self.build.remove_deprecated_install_entries(
                [self.tree_target(source, destination)], self.build.deprecated_skill_names()
            )

        self.assertEqual(removed, 1)
        self.assertFalse((destination / "old-skill").exists())
        self.assertEqual((destination / "custom" / "SKILL.md").read_text(), "manual skill\n")

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
