"""Windows support: the store's sqlite handles are released on shutdown.

The module-level store singleton holds a WAL-mode sqlite connection, and closing
it is what makes the app resettable. On Windows an open handle blocks deleting
the files it points at, so an unclosed connection leaves the app's data
directory unremovable -- and the app therefore unresettable and uninstallable --
once it has served a single request.

The built-in closed it from the gateway Application's ``on_cleanup``. As an
external app it does so from the manifest's ``backend.hooks.on_shutdown``, which
the gateway also runs on disable and uninstall.
"""

import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend import routes as routes_mod

from .harness import make_ctx

_APP_ROOT = Path(__file__).resolve().parents[1]


class TestStoreHandlesAreReleasedOnShutdown(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._tmp = tempfile.mkdtemp()
        # Registered first so it runs last: the connection must be closed before
        # the directory holding its database is removed.
        self.addCleanup(shutil.rmtree, self._tmp, True)
        self.ctx = make_ctx(Path(self._tmp))
        self.addAsyncCleanup(routes_mod.on_shutdown, self.ctx)

    def test_the_manifest_wires_the_shutdown_hook(self) -> None:
        """Without this the hook can be written and never wired up."""
        manifest = json.loads((_APP_ROOT / "app.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["backend"]["hooks"]["on_shutdown"], "backend.routes:on_shutdown")
        self.assertEqual(manifest["platform"]["os"], ["macos", "linux", "windows"])

    async def test_shutdown_closes_the_connection_and_clears_the_singleton(self) -> None:
        store = await routes_mod._get_store(self.ctx)
        await routes_mod.on_shutdown(self.ctx)
        self.assertIsNone(
            routes_mod._store,
            "a request arriving mid-shutdown must rebuild, not reuse a closed store",
        )
        with self.assertRaises(sqlite3.ProgrammingError):
            store.list_all()

    async def test_a_request_after_shutdown_gets_a_fresh_store(self) -> None:
        first = await routes_mod._get_store(self.ctx)
        await routes_mod.on_shutdown(self.ctx)
        second = await routes_mod._get_store(self.ctx)
        self.assertIsNot(first, second)
        self.assertEqual(second.list_all(), [])

    async def test_the_data_directory_can_be_removed_after_shutdown(self) -> None:
        """The reason the hook exists, stated as the outcome it buys.

        ``shutil.rmtree`` without ``ignore_errors`` raises ``PermissionError`` on
        Windows while any handle on the database or its WAL siblings is still
        open, so this asserts the handles are genuinely gone rather than merely
        that a ``close`` was called. On POSIX it passes either way -- the
        platform that can regress is the one the assertion is for.
        """
        store = await routes_mod._get_store(self.ctx)
        store.add("a preference that forces the WAL siblings into existence")
        await routes_mod.on_shutdown(self.ctx)
        shutil.rmtree(self._tmp)
        self.assertFalse(Path(self._tmp).exists())


if __name__ == "__main__":
    unittest.main()
