"""Small file helpers the built-in imported from Kiro Crew's private modules.

An external app may only rely on the App SDK and the stdlib, so the four helpers
the built-in took from ``kiro_crew.owner_only_files`` and ``kiro_crew.atomic_write``
are re-stated here in the narrow form this app needs. Each one documents what it
keeps and what it drops relative to the original; PORTING.md lists the gap.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

_OWNER_ONLY_DIR = 0o700
_OWNER_ONLY_FILE = 0o600
_POSIX = os.name == "posix"


def mkdirs_owner_only(path: str | os.PathLike[str]) -> None:
    """``mkdir -p`` where every directory it creates is ``0700`` on POSIX.

    Existing directories are left as they are. On Windows no mode is passed, as
    in the original: a ``0o700`` mkdir there produces a protected DACL that cuts
    the directory off from the data home's inherited owner grant.
    """
    target = Path(path)
    if not _POSIX:
        target.mkdir(parents=True, exist_ok=True)
        return
    missing: list[Path] = []
    probe = target
    while not probe.exists():
        missing.append(probe)
        if probe.parent == probe:
            break
        probe = probe.parent
    for directory in reversed(missing):
        try:
            os.mkdir(directory, _OWNER_ONLY_DIR)
        except FileExistsError:
            if not directory.is_dir():
                raise


def prepare_owner_only_sqlite(db_path: str | os.PathLike[str]) -> None:
    """Create a missing database file empty and ``0600`` before ``connect``.

    SQLite gives its ``-wal`` / ``-shm`` sidecars the database's own mode, so a
    database that exists as an owner-only file when the connection opens keeps
    every sidecar owner-only too. An existing file has its group/other bits
    dropped. A symlink at the name is left alone. Never raises: a database
    whose mode cannot be set must still open. A no-op on Windows.

    Narrower than the original, which also refuses to act through a symlinked
    directory inside the data home and publishes the new file via a hard link.
    """
    if not _POSIX:
        return
    path = Path(db_path)
    try:
        if path.is_symlink():
            return
        if not path.exists():
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, _OWNER_ONLY_FILE)
            os.close(fd)
            return
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            os.chmod(path, mode & 0o700)
    except OSError:
        return


def atomic_write(path: Path, content: str, *, fsync: bool = False) -> None:
    """Write *content* to *path* through a unique temp file and a rename.

    A plain ``write_text`` truncates the old file before the new bytes land, so
    an interruption mid-save leaves an empty or partial file. The temp file is
    created beside the target (same filesystem, so ``os.replace`` is atomic)
    with ``mkstemp``'s ``0600`` mode, and removed on any failure.

    Drops the original's Windows sharing-violation retry around the rename.
    """
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            if fsync:
                handle.flush()
                os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_json_or(path: Path, default: Any, *, logger: logging.Logger, what: str) -> Any:
    """``json.loads`` a small file, or return *default*.

    Absent, malformed and undecodable files return *default* silently, as the
    original does. Any other ``OSError`` logs one warning naming *what* (never
    the path or the bytes) and returns *default*.

    Drops the original's Windows read retry and its once-per-path log bound.
    """
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return default
    except OSError as exc:
        logger.warning("could not read %s (%s); using the default", what, type(exc).__name__)
        return default
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        return default
