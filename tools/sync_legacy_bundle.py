#!/usr/bin/env python3
"""Explicitly copy this repository's compiled dist to a marked legacy bundle directory."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MARKER = ".haomai-extension-bundle-only"
MARKER_CONTENT = "Migration compatibility build output only; source repository is haomai-chrome.\n"
ROOT_DIRECTORIES = {"assets", "icons", "public", "src"}
ROOT_FILES = {"manifest.json", "service-worker-loader.js"}
BUNDLE_EXTENSIONS = {".js", ".json", ".html", ".css", ".map", ".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2", ".ttf"}


class SyncError(ValueError):
    pass


def clean_path(value: Path) -> Path:
    """Normalize dots while refusing every symlink, including ancestor links."""
    value = value if value.is_absolute() else Path.cwd() / value
    result = Path(value.anchor)
    for part in value.parts[1:]:
        if part == "..":
            result = result.parent
        elif part != ".":
            result /= part
            if result.is_symlink():
                raise SyncError(f"Symbolic links are not allowed: {result}")
    return result


def regular_file(path: Path) -> None:
    if not stat.S_ISREG(path.lstat().st_mode):
        raise SyncError(f"Expected a regular file: {path}")


def read_regular(path: Path) -> bytes:
    regular_file(path)
    # Refuse a replaced leaf symlink between validation and opening.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise SyncError(f"Expected a regular file: {path}")
        return stream.read()


def validate_parent(parent: Path, transaction: Path | None = None) -> None:
    clean_path(parent)
    if not parent.is_dir():
        raise SyncError("Target parent must already exist as a marked bundle-only directory")
    marker = parent / MARKER
    if not marker.exists() or read_regular(marker).decode("utf-8") != MARKER_CONTENT:
        raise SyncError("Target parent has no recognized bundle-only marker")
    permitted = {MARKER, "README.md", "dist"}
    if transaction is not None:
        permitted.add(transaction.name)
    for child in parent.iterdir():
        if child.is_symlink() or child.name not in permitted:
            raise SyncError(f"Unexpected file, source directory or symlink in target parent: {child.name}")
        if child.name in {MARKER, "README.md"}:
            regular_file(child)


def bundle_hashes(directory: Path) -> dict[str, str]:
    clean_path(directory)
    if not directory.is_dir():
        raise SyncError(f"Compiled bundle directory is missing: {directory}")
    result = {}
    for child in directory.iterdir():
        if child.is_symlink():
            raise SyncError(f"Bundle contains a symlink: {child}")
        expected = ROOT_DIRECTORIES if child.is_dir() else ROOT_FILES
        if child.name not in expected:
            raise SyncError(f"Unexpected source or file in compiled bundle: {child.name}")
    for path in sorted(directory.rglob("*")):
        relative = path.relative_to(directory)
        if path.is_symlink() or any(part.startswith(".") for part in relative.parts):
            raise SyncError(f"Hidden entries and symlinks are not bundle inputs: {relative}")
        if path.is_dir():
            continue
        regular_file(path)
        if path.suffix.lower() not in BUNDLE_EXTENSIONS or path.name in {"package.json", "yarn.lock", "tsconfig.json"}:
            raise SyncError(f"Unexpected source or private file in bundle: {relative}")
        result[relative.as_posix()] = hashlib.sha256(read_regular(path)).hexdigest()
    if "manifest.json" not in result:
        raise SyncError("Bundle is missing manifest.json; run yarn build first")
    manifest = json.loads(read_regular(directory / "manifest.json"))
    if manifest.get("manifest_version") != 3 or manifest.get("name") != "好麦":
        raise SyncError("Bundle must be the built Manifest V3 好麦 extension")
    entries = [manifest.get("background", {}).get("service_worker"),
               manifest.get("action", {}).get("default_popup"),
               manifest.get("options_ui", {}).get("page")]
    entries.extend(item for script in manifest.get("content_scripts", []) for item in script.get("js", []))
    for entry in entries:
        if not isinstance(entry, str) or entry not in result:
            raise SyncError("Bundle manifest references a missing or invalid local entry")
    return result


def sync_bundle(target: Path, *, source: Path = ROOT / "dist") -> int:
    source, target = clean_path(source), clean_path(target)
    if source.name != "dist" or target.name != "dist":
        raise SyncError("Source and target must each be a directory named dist")
    if source == target or source.is_relative_to(target) or target.is_relative_to(source):
        raise SyncError("Source and target must not contain one another")
    validate_parent(target.parent)
    expected = bundle_hashes(source)
    if target.exists():
        bundle_hashes(target)
    transaction = Path(tempfile.mkdtemp(prefix=".haomai-sync-", dir=target.parent))
    staged, backup = transaction / "next-dist", transaction / "previous-dist"
    can_cleanup = True
    try:
        shutil.copytree(source, staged, symlinks=True)
        if bundle_hashes(staged) != expected or bundle_hashes(source) != expected:
            raise SyncError("Bundle changed during staging or copied hashes do not match; target was not changed")
        validate_parent(target.parent, transaction)
        try:
            if target.exists():
                bundle_hashes(target)
                os.replace(target, backup)
            os.replace(staged, target)
            if bundle_hashes(target) != expected:
                raise SyncError("Installed bundle failed hash verification")
        except BaseException:
            try:
                if backup.exists():
                    if target.exists():
                        os.replace(target, transaction / "failed-dist")
                    os.replace(backup, target)
                elif not staged.exists() and target.exists():
                    # Initial installation with no previous target: undo only
                    # the bundle just installed by this transaction.
                    os.replace(target, transaction / "failed-dist")
            except BaseException as recovery_error:
                can_cleanup = False
                raise SyncError(f"Recovery needs manual attention; preserved bundle backup at {backup}") from recovery_error
            raise
    finally:
        # Never remove pre-existing directories or a backup that failed recovery.
        if can_cleanup:
            shutil.rmtree(transaction)
    return len(expected)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, type=Path, help="Explicit marked legacy directory, e.g. ../wa-web-translate/dist")
    args = parser.parse_args()
    try:
        count = sync_bundle(args.target)
    except (OSError, ValueError, UnicodeError) as error:
        parser.exit(1, f"Bundle sync refused or restored: {error}\n")
    print(f"Synced {count} verified compiled files to {clean_path(args.target)}. Browser state was not changed.")


if __name__ == "__main__":
    main()
