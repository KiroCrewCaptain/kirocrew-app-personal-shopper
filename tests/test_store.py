"""Tests for the preference store.

The load-bearing tests here are ``test_keyword_fallback_never_dedups`` and
``test_text_change_without_a_model_clears_the_stale_vector``. Both pin behaviour
that silently DESTROYS or MISDIRECTS a user's stored preference when the
embedding model is not serving — which is the store's normal state on a fresh
install, before the model has been downloaded. A regression in either one is
invisible in the UI: the entry count still looks right.
"""

import json
import shutil
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

from backend import store as store_mod
from backend.store import PreferenceStore

APP_ROOT = Path(__file__).resolve().parents[1]


class _FakeEmbedder:
    """The host's embed SDK (``ctx.embed``), reduced to a fixed text -> vector map.

    A text with no entry embeds to None, as the host's does when its model fails.
    A store built with no embedder at all is a boot where the model has not
    landed: every embed returns None and search runs on keywords.
    """

    def __init__(self, vectors: dict[str, list[float]] | None = None, ready: bool = True):
        self._vectors = vectors or {}
        self._ready = ready

    def available(self) -> bool:
        return self._ready

    def embed_sync(self, text: str) -> list[float] | None:
        return self._vectors.get(text)


class PreferenceStoreTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.mkdtemp()
        self.db = Path(self._tmp) / "preferences.db"
        # Registered FIRST so it runs LAST: unittest runs tearDown before the
        # addCleanup stack, and the stack itself is LIFO, so removing the tree
        # here (rather than in tearDown) guarantees every store.close() added by
        # _store() has already run. Deleting the directory while a sqlite handle
        # is still open fails on Windows and leaves temp directories behind.
        self.addCleanup(shutil.rmtree, self._tmp, ignore_errors=True)

    def _store(self, embedder: _FakeEmbedder | None = None) -> PreferenceStore:
        s = PreferenceStore(db_path=self.db, embedder=embedder)
        self.addCleanup(s.close)
        return s


class TestKeywordFallbackSafety(PreferenceStoreTestCase):
    def test_tag_filter_applies_before_result_limit(self) -> None:
        """Other groups' stronger matches cannot hide the requested group's hits."""
        store = self._store()
        for _ in range(7):
            store.add("latex", tags=["other"])
        first = store.add("avoid latex gloves for cleaning", tags=["health"])
        second = store.add("avoid latex in all clothing and household products", tags=["clothing"])

        # Prove the excluded rows fill the over-fetch window, without ties
        # between the excluded and requested groups determining the result.
        unfiltered = store.search("latex", top_k=9)
        self.assertTrue(all(r.tags == ["other"] for r in unfiltered[:7]))
        self.assertEqual([r.id for r in unfiltered[7:]], [first, second])

        for limit in (1, 2):
            with self.subTest(top_k=limit):
                results = store.search("latex", top_k=limit, tag_filter=["health", "clothing"])
                self.assertEqual([r.id for r in results], [first, second][:limit])
                self.assertTrue(all(not r.semantic for r in results))
        self.assertEqual(store.search("latex", tag_filter=["missing"]), [])
        self.assertEqual(store.search("latex", top_k=2, tag_filter=[]), unfiltered[:2])

    def test_keyword_fallback_never_dedups(self) -> None:
        """Two preferences that merely SHARE A WORD must both survive.

        Deduplication asks "is this the same claim?", which only an embedding can
        answer. A keyword score answers "do these share words?" — thresholding it
        merges "shoe size US 10" into "prefers running shoes" and the user's size
        is gone.
        """
        store = self._store()
        first = store.add("prefers running shoes")
        second = store.add("shoe size US 10")

        self.assertNotEqual(first, second, "the two preferences were merged")
        texts = sorted(p["text"] for p in store.list_all())
        self.assertEqual(texts, ["prefers running shoes", "shoe size US 10"])

    def test_keyword_results_are_flagged_non_semantic(self) -> None:
        """A keyword hit must not masquerade as a similarity score."""
        store = self._store()
        store.add("allergic to latex")

        results = store.search("latex")
        self.assertTrue(results, "keyword fallback returned nothing")
        self.assertFalse(
            results[0].semantic,
            "a keyword score was reported as a semantic similarity",
        )

    def test_dedup_rejects_a_non_semantic_hit_even_at_score_one(self) -> None:
        """The guard is the FLAG, not the number.

        bm25 on a tiny corpus can rank a single-term match arbitrarily close to
        zero, which maps to a score of ~1.0. If dedup thresholded the score it
        would merge on that; it must refuse purely because the hit is not
        semantic.
        """
        store = self._store()
        store.add("prefers running shoes")

        perfect_keyword_hit = [
            store_mod.SearchResult(
                id="whatever",
                text="prefers running shoes",
                tags=[],
                score=1.0,
                semantic=False,
            )
        ]
        with mock.patch.object(store, "search", return_value=perfect_keyword_hit):
            self.assertIsNone(
                store._find_similar("shoe size US 10"),
                "dedup accepted a keyword hit scoring 1.0",
            )

    def test_fts_query_with_operator_characters_does_not_error(self) -> None:
        """Raw user text containing FTS5 syntax must still search."""
        store = self._store()
        store.add("avoids wool sweaters")

        # An unbalanced quote and a bare operator are a query-syntax error to
        # FTS5 if passed through unescaped.
        for probe in ['wool "', "wool OR", "wool*", '"']:
            with self.subTest(probe=probe):
                store.search(probe)  # must not raise


class TestSemanticDedup(PreferenceStoreTestCase):
    def test_high_cosine_merges_into_the_existing_entry(self) -> None:
        vectors = {
            "shoe size US 10": [1.0, 0.0, 0.0],
            "shoe size is US 10": [0.999, 0.01, 0.0],
        }
        store = self._store(_FakeEmbedder(vectors))
        first = store.add("shoe size US 10")
        second = store.add("shoe size is US 10")

        self.assertEqual(first, second, "a restatement created a second entry")
        self.assertEqual(len(store.list_all()), 1)

    def test_low_cosine_keeps_both(self) -> None:
        vectors = {
            "shoe size US 10": [1.0, 0.0, 0.0],
            "allergic to latex": [0.0, 1.0, 0.0],
        }
        store = self._store(_FakeEmbedder(vectors))
        store.add("shoe size US 10")
        store.add("allergic to latex")

        self.assertEqual(len(store.list_all()), 2)


class TestVectorStaleness(PreferenceStoreTestCase):
    def test_text_change_without_a_model_clears_the_stale_vector(self) -> None:
        """A vector describing replaced text must not survive the edit.

        Keeping it means the entry keeps matching queries about wording the user
        has deleted — a silent recall corruption that no UI surface reveals.
        """
        vectors = {"budget under $100": [1.0, 0.0, 0.0]}
        store = self._store(_FakeEmbedder(vectors))
        entry_id = store.add("budget under $100")

        # The model goes away, then the user edits the text.
        store.embedder = None
        store.update(entry_id, text="budget under $400")

        # sqlite's context manager commits/rolls back but does NOT close the
        # handle.  Close explicitly so Windows can remove the WAL directory.
        with closing(sqlite3.connect(str(self.db))) as conn:
            text, blob = conn.execute(
                "SELECT text, embedding FROM preferences WHERE id = ?", (entry_id,)
            ).fetchone()
        self.assertEqual(text, "budget under $400")
        self.assertIsNone(blob, "the vector for the OLD text was kept")

    def test_reembed_all_refills_cleared_vectors(self) -> None:
        store = self._store()
        store.add("prefers minimalist style")

        store.embedder = _FakeEmbedder({"prefers minimalist style": [0.0, 1.0]})
        self.assertEqual(store.reembed_all(), 1)

        with closing(sqlite3.connect(str(self.db))) as conn:
            (blob,) = conn.execute("SELECT embedding FROM preferences").fetchone()
        self.assertIsNotNone(blob)

    def test_dimension_mismatch_scores_zero_rather_than_truncating(self) -> None:
        """Vectors from two different models are incomparable, not 'similar'.

        Truncating to the shorter length would invent a similarity from a prefix.
        """
        self.assertEqual(store_mod._cosine([1.0, 0.0], [1.0, 0.0, 0.0]), 0.0)


class TestFtsIndexSync(PreferenceStoreTestCase):
    def test_update_replaces_the_indexed_text(self) -> None:
        """After an edit the OLD wording must not be findable."""
        store = self._store()
        entry_id = store.add("prefers wool coats")
        store.update(entry_id, text="prefers down jackets")

        self.assertEqual([r.text for r in store.search("wool")], [])
        self.assertEqual([r.text for r in store.search("down")], ["prefers down jackets"])

    def test_delete_removes_from_the_index(self) -> None:
        store = self._store()
        entry_id = store.add("avoids leather")
        store.delete(entry_id)

        self.assertEqual(store.search("leather"), [])
        self.assertEqual(store.list_all(), [])


class TestTagsAreOrganisationOnly(PreferenceStoreTestCase):
    def test_deleting_a_group_keeps_its_preferences(self) -> None:
        """A group is the user's filing, not the knowledge itself."""
        store = self._store()
        # The id is opaque (a slug collapses "Work Shoes" and "work-shoes"
        # onto one key), so the group's own id is the only handle.
        group_id = store.add_group("Body")
        entry_id = store.add("shoe size US 10", tags=[group_id])

        store.delete_group(group_id)

        remaining = store.list_all()
        self.assertEqual(len(remaining), 1, "deleting a folder deleted the fact")
        self.assertEqual(remaining[0]["id"], entry_id)
        self.assertEqual(remaining[0]["tags"], [], "the stale tag was left behind")
        self.assertEqual(store.list_groups(), [])

    def test_search_ignores_tags_by_default(self) -> None:
        """An untagged preference must still be retrievable."""
        store = self._store()
        store.add("allergic to latex")  # no tags at all

        self.assertEqual([r.text for r in store.search("latex")], ["allergic to latex"])


class TestTheStoreLivesInTheAppDataDir(unittest.TestCase):
    def test_db_path_is_inside_the_given_data_dir(self) -> None:
        """Same file name under ``ctx.data_dir`` as the built-in used.

        The gateway hands an external app ``<home>/apps/personal-shopper/data``,
        which is the directory the built-in resolved, so keeping the file name
        is what lets an existing user's preferences survive the move.
        """
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(store_mod.db_path_in(Path(tmp)), Path(tmp) / "preferences.db")

    def test_a_missing_data_dir_is_created_on_first_use(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            nested = Path(tmp) / "apps" / "personal-shopper" / "data"
            store = PreferenceStore(store_mod.db_path_in(nested))
            try:
                self.assertTrue(store.db_path.is_file())
            finally:
                store.close()


class TestConcurrentWrites(PreferenceStoreTestCase):
    def test_parallel_adds_all_land(self) -> None:
        """Route handlers run on several worker threads over one connection.

        Without serialisation the interleaved multi-statement FTS sync races and
        sqlite raises 'database is locked'.
        """
        store = self._store()
        errors: list[BaseException] = []

        def add(i: int) -> None:
            try:
                store.add(f"distinct preference number {i}")
            except BaseException as exc:  # noqa: BLE001 - recorded and re-raised
                errors.append(exc)

        threads = [threading.Thread(target=add, args=(i,)) for i in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [], f"concurrent writes failed: {errors}")
        self.assertEqual(len(store.list_all()), 12)


class TestHistory(PreferenceStoreTestCase):
    def test_history_round_trips_with_feedback(self) -> None:
        store = self._store()
        hid = store.add_history(
            "half marathon with bad knees",
            advice="high-cushion shoe, not a barefoot model",
            products=[{"name": "Pegasus 41", "price": 129}],
        )
        store.update_feedback(hid, "Pegasus 41", "purchased")

        (session,) = store.list_history()
        self.assertEqual(session["problem"], "half marathon with bad knees")
        self.assertEqual(session["products"][0]["name"], "Pegasus 41")
        self.assertEqual(session["feedback"], {"Pegasus 41": "purchased"})

    def test_advice_only_session_has_no_products(self) -> None:
        """A session that solved the problem WITHOUT a purchase is a valid one."""
        store = self._store()
        store.add_history("neck ache at my desk", advice="raise the monitor")

        (session,) = store.list_history()
        self.assertEqual(session["products"], [])
        self.assertTrue(session["advice"])


def _manifest() -> dict:
    return json.loads((APP_ROOT / "app.json").read_text(encoding="utf-8"))


class TestManifestWiring(unittest.TestCase):
    """The app is invisible unless its manifest points at files that exist."""

    def test_hooks_name_callables_that_exist(self) -> None:
        """``backend.hooks`` is what makes the gateway load the routes at all.

        The built-in used the top-level ``backend.routes`` field, which only the
        built-in boot loop reads. An external app must use ``backend.hooks``.
        """
        import importlib

        hooks = _manifest()["backend"]["hooks"]
        self.assertEqual(set(hooks), {"routes", "on_shutdown"})
        self.assertNotIn("routes", _manifest()["backend"])
        for spec in hooks.values():
            dotted, _, attr = spec.partition(":")
            self.assertTrue((APP_ROOT / (dotted.replace(".", "/") + ".py")).is_file(), spec)
            self.assertTrue(callable(getattr(importlib.import_module(dotted), attr)), spec)

    def test_manifest_declares_its_agent_and_skill(self) -> None:
        """Without these fields the advisor agent and the skill never install."""
        manifest = _manifest()
        self.assertEqual(manifest["agents"], ["agents/advisor.json"])
        self.assertEqual(manifest["skills"], ["skills/personal-shopper"])
        for rel in manifest["agents"]:
            self.assertTrue((APP_ROOT / rel).is_file(), f"missing agent file {rel}")
        for rel in manifest["skills"]:
            self.assertTrue((APP_ROOT / rel / "SKILL.md").is_file(), f"missing SKILL.md in {rel}")

    def test_declared_art_exists_and_is_raster(self) -> None:
        """A registry app's art is repo-relative and must be a raster file.

        The catalog's publish step ingests icon, hero and screenshots from the
        repository and refuses SVG for a non-builtin source, so an SVG here would
        publish a placeholder card.
        """
        manifest = _manifest()
        paths = [manifest["iconPath"], manifest["heroImage"], manifest["heroImageDark"]]
        paths += manifest["screenshots"]
        for rel in paths:
            with self.subTest(path=rel):
                self.assertFalse(rel.startswith("/"), "a registry app's art is repo-relative")
                path = APP_ROOT / rel
                self.assertTrue(path.is_file(), f"{rel} is missing")
                self.assertEqual(path.read_bytes()[:8], b"\x89PNG\r\n\x1a\n", f"{rel} is not a PNG")

    def test_name_and_version_match_the_builtin(self) -> None:
        """Adoption maps the built-in record onto this app by name and version."""
        manifest = _manifest()
        self.assertEqual((manifest["name"], manifest["version"]), ("personal-shopper", "0.1.0"))

    def test_nothing_triggers_an_install_time_build(self) -> None:
        """A root build file makes a registry install run pip or npm.

        Hook code runs in the gateway's interpreter and this app needs nothing
        beyond the stdlib and aiohttp, which the gateway already has. A root
        ``requirements.txt`` / ``pyproject.toml`` would also be refused outright
        on the desktop build, so none may exist.
        """
        for name in ("requirements.txt", "pyproject.toml", "setup.py", "package.json"):
            self.assertFalse((APP_ROOT / name).exists(), name)


class TestGroupAssignmentSurvives(PreferenceStoreTestCase):
    """A group is a tag holding the group's id, so tag handling IS group handling."""

    def test_dedup_does_not_strip_an_entry_out_of_its_group(self) -> None:
        """Re-adding an equivalent preference must not un-file the original.

        ``add`` merges into a semantically equivalent entry. Passing the incoming
        tags straight through replaced the stored ones, so adding "shoe size US 10"
        again WITHOUT picking a group silently removed the existing entry from the
        group it was filed under. The entry survives, so the count looks right --
        it just disappears from its section, which reads as data loss.
        """
        vectors = {"shoe size US 10": [1.0, 0.0], "shoe size US10": [1.0, 0.0]}
        store = self._store(_FakeEmbedder(vectors))
        group_id = store.add_group("Body")
        entry_id = store.add("shoe size US 10", tags=[group_id])

        # Same claim, no group picked.
        again = store.add("shoe size US10", tags=[])

        self.assertEqual(again, entry_id, "expected a dedup merge")
        stored = {e["id"]: e for e in store.list_all()}
        self.assertIn(group_id, stored[entry_id]["tags"], "dedup erased the group assignment")

    def test_dedup_unions_rather_than_discarding_new_tags(self) -> None:
        vectors = {"budget is $100": [0.0, 1.0], "budget about $100": [0.0, 1.0]}
        store = self._store(_FakeEmbedder(vectors))
        first = store.add_group("Money")
        second = store.add_group("Gifts")
        entry_id = store.add("budget is $100", tags=[first])

        store.add("budget about $100", tags=[second])

        stored = {e["id"]: e for e in store.list_all()}
        self.assertEqual(sorted(stored[entry_id]["tags"]), sorted([first, second]))


class TestGroupIdsAreOpaque(PreferenceStoreTestCase):
    def test_two_names_that_slug_alike_stay_distinct(self) -> None:
        """``Work Shoes`` and ``work-shoes`` both slug to ``work-shoes``.

        With a slug id and ``INSERT OR REPLACE`` the second add destroyed the
        first group's metadata AND reassigned every preference tagged with that
        id into the second group.
        """
        store = self._store()
        a = store.add_group("Work Shoes")
        b = store.add_group("work-shoes")

        self.assertNotEqual(a, b, "distinct names collapsed onto one id")
        self.assertEqual(len(store.list_groups()), 2)

    def test_adding_the_same_name_twice_returns_the_same_group(self) -> None:
        """Opaque ids must not cost the idempotency the slug provided."""
        store = self._store()
        first = store.add_group("Body")
        second = store.add_group("  body  ")

        self.assertEqual(first, second)
        self.assertEqual(len(store.list_groups()), 1)

    def test_a_group_id_is_not_derived_from_its_name(self) -> None:
        store = self._store()
        group_id = store.add_group("Work Shoes")
        self.assertNotEqual(group_id, "work-shoes")


if __name__ == "__main__":
    unittest.main()
