"""Isolated filesystem safety and recovery fixtures; no browser or real bundle is touched."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sync_legacy_bundle as sync


class BundleSyncTest(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name).resolve()
        self.source = self.root / "source/dist"
        self.parent = self.root / "legacy"
        self.target = self.parent / "dist"
        self.parent.mkdir()
        (self.parent / sync.MARKER).write_text(sync.MARKER_CONTENT)
        (self.parent / "README.md").write_text("bundle-only fixture")
        self.make_bundle(self.source, "new")
        self.make_bundle(self.target, "old")

    def make_bundle(self, path, version):
        path.mkdir(parents=True)
        (path / "assets").mkdir()
        (path / "assets/main.js").write_text(version)
        (path / "manifest.json").write_text(json.dumps({
            "manifest_version": 3, "name": "好麦",
            "background": {"service_worker": "assets/main.js"},
            "action": {"default_popup": "assets/main.js"},
            "options_ui": {"page": "assets/main.js"},
        }))

    def run_sync(self, target=None):
        return sync.sync_bundle(target or self.target, source=self.source)

    def assert_unchanged(self):
        self.assertEqual((self.target / "assets/main.js").read_text(), "old")
        self.assertFalse(list(self.parent.glob(".haomai-sync-*")))

    def test_replaces_verified_bundle_and_preserves_marker_readme(self):
        self.assertEqual(self.run_sync(), 2)
        self.assertEqual(sync.bundle_hashes(self.source), sync.bundle_hashes(self.target))
        self.assertEqual((self.parent / sync.MARKER).read_text(), sync.MARKER_CONTENT)
        self.assertEqual((self.parent / "README.md").read_text(), "bundle-only fixture")
        self.assertFalse(list(self.parent.glob(".haomai-sync-*")))

    def test_missing_or_wrong_marker_refused(self):
        (self.parent / sync.MARKER).write_text("not-authorized")
        with self.assertRaises(sync.SyncError):
            self.run_sync()
        self.assert_unchanged()

    def test_git_source_or_unexpected_parent_entries_refused(self):
        for name in (".git", "package.json", "another-directory"):
            with self.subTest(name=name):
                path = self.parent / name
                path.mkdir()
                with self.assertRaises(sync.SyncError):
                    self.run_sync()
                path.rmdir()
                self.assert_unchanged()

    def test_target_must_be_named_dist_and_disjoint(self):
        for target in (self.parent / "not-dist", self.source, self.source / "nested/dist", self.source.parent.parent):
            with self.subTest(target=target), self.assertRaises(sync.SyncError):
                self.run_sync(target)
        self.assert_unchanged()

    def test_symlink_ancestor_and_source_entry_refused(self):
        alias = self.root / "alias"
        alias.symlink_to(self.parent, target_is_directory=True)
        with self.assertRaises(sync.SyncError):
            self.run_sync(alias / "dist")
        (self.source / "assets/link.js").symlink_to(self.source / "assets/main.js")
        with self.assertRaises(sync.SyncError):
            self.run_sync()
        self.assert_unchanged()

    def test_existing_target_source_files_refused(self):
        (self.target / "package.json").write_text("{}")
        with self.assertRaises(sync.SyncError):
            self.run_sync()
        self.assert_unchanged()

    def test_target_directory_symlink_refused(self):
        saved = self.parent / "saved"
        self.target.rename(saved)
        self.target.symlink_to(saved, target_is_directory=True)
        with self.assertRaises(sync.SyncError):
            self.run_sync()
        self.assertEqual((saved / "assets/main.js").read_text(), "old")

    def test_hidden_private_source_input_refused(self):
        (self.source / "assets/.env").write_text("fixture-private")
        with self.assertRaises(sync.SyncError):
            self.run_sync()
        self.assert_unchanged()

    def test_copy_hash_mismatch_preserves_previous_bundle(self):
        original = sync.shutil.copytree
        def corrupt(source, target, *args, **kwargs):
            result = original(source, target, *args, **kwargs)
            if Path(source) == self.source:
                (Path(target) / "assets/main.js").write_text("corrupt")
            return result
        with patch.object(sync.shutil, "copytree", corrupt):
            with self.assertRaises(sync.SyncError):
                self.run_sync()
        self.assert_unchanged()

    def test_failed_switch_restores_previous_bundle(self):
        original = sync.os.replace
        def fail_switch(source, target):
            if Path(source).name == "next-dist":
                raise OSError("fixture switch failure")
            return original(source, target)
        with patch.object(sync.os, "replace", fail_switch):
            with self.assertRaises(OSError):
                self.run_sync()
        self.assert_unchanged()

    def test_failed_recovery_keeps_backup(self):
        original = sync.os.replace
        def fail_switch_and_restore(source, target):
            if Path(source).name in {"next-dist", "previous-dist"}:
                raise OSError("fixture failure")
            return original(source, target)
        with patch.object(sync.os, "replace", fail_switch_and_restore):
            with self.assertRaisesRegex(sync.SyncError, "preserved bundle backup"):
                self.run_sync()
        backups = list(self.parent.glob(".haomai-sync-*/previous-dist/assets/main.js"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), "old")


if __name__ == "__main__":
    unittest.main()
