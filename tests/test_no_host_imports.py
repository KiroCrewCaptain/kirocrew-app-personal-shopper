"""The backend imports nothing from Kiro Crew.

The gateway's public surface for an app is the ``AppContext`` its hooks get and
the structural route records the registry accepts. A ``kiro_crew`` import pins
the app to one wheel's private module layout, and the first release that moves
that module breaks every installed copy at load time. ``backend/_host.py`` reads
the seams off the context instead; this keeps it that way.
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"


def _host_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found += [a.name for a in node.names if a.name.split(".")[0] == "kiro_crew"]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module.split(".")[0] == "kiro_crew":
                found.append(node.module)
        elif isinstance(node, ast.Call):
            # importlib.import_module("kiro_crew...") / __import__("kiro_crew...")
            name = getattr(node.func, "attr", None) or getattr(node.func, "id", None)
            if name in {"import_module", "__import__"} and node.args:
                arg = node.args[0]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    if arg.value.split(".")[0] == "kiro_crew":
                        found.append(arg.value)
    return found


class TestNoHostImports(unittest.TestCase):
    def test_no_backend_module_imports_kiro_crew(self) -> None:
        files = sorted(BACKEND.rglob("*.py"))
        self.assertTrue(files, "no backend modules found")
        for path in files:
            with self.subTest(module=path.relative_to(BACKEND.parent).as_posix()):
                self.assertEqual(_host_imports(path), [])

    def test_the_scan_sees_each_import_form(self) -> None:
        """The detector itself: every spelling it must catch is caught."""
        import tempfile

        source = (
            "import kiro_crew\n"
            "import kiro_crew.apps as a\n"
            "from kiro_crew.executors import run_in_embed_pool\n"
            "import importlib\n"
            "importlib.import_module('kiro_crew.embeddings')\n"
            "__import__('kiro_crew')\n"
            "from . import kiro_crew_like\n"
            "import kiro_crewish\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "probe.py"
            path.write_text(source, encoding="utf-8")
            self.assertEqual(
                _host_imports(path),
                [
                    "kiro_crew",
                    "kiro_crew.apps",
                    "kiro_crew.executors",
                    "kiro_crew.embeddings",
                    "kiro_crew",
                ],
            )


if __name__ == "__main__":
    unittest.main()
