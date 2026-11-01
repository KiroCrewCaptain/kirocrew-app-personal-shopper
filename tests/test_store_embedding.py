"""The store asks the host's embed SDK, and nothing else, whether it can embed.

Readiness belongs to the host: its ``available()`` counts a model it unloaded
after an idle window but can load on demand (Kiro Crew's
``test/test_embed_sdk.py`` pins that). What the store owns is the other half: it
never embeds when ``available()`` says no, it treats a missing SDK as "keyword
search only", and a None vector from the SDK stores no vector.
"""

from __future__ import annotations

import struct

import pytest

from backend import store


class _Sdk:
    def __init__(self, *, available: bool, vector: list[float] | None = None) -> None:
        self._available = available
        self._vector = [0.5, 0.25] if vector is None and available else vector
        self.calls: list[str] = []

    def available(self) -> bool:
        return self._available

    def embed_sync(self, text: str) -> list[float] | None:
        self.calls.append(text)
        return self._vector


@pytest.mark.parametrize(("available", "embeds"), [(True, True), (False, False)])
def test_embeds_only_when_the_host_says_it_can(tmp_path, available, embeds) -> None:
    sdk = _Sdk(available=available)
    s = store.PreferenceStore(store.db_path_in(tmp_path), embedder=sdk)
    try:
        blob = s._embed("blue running shoes")
    finally:
        s.close()
    assert (blob is not None) is embeds
    assert sdk.calls == (["blue running shoes"] if embeds else [])
    if embeds:
        assert blob == struct.pack("2f", 0.5, 0.25)


def test_no_sdk_means_no_vector(tmp_path) -> None:
    s = store.PreferenceStore(store.db_path_in(tmp_path))
    try:
        assert s._embed("anything") is None
        s.add("allergic to latex")
        results = s.search("latex")
    finally:
        s.close()
    assert [r.semantic for r in results] == [False]


def test_a_failed_embed_stores_no_vector(tmp_path) -> None:
    """The host SDK returns None for an embed that raised; that is "no vector"."""

    class _Failing(_Sdk):
        def embed_sync(self, text: str) -> list[float] | None:
            self.calls.append(text)
            return None

    s = store.PreferenceStore(store.db_path_in(tmp_path), embedder=_Failing(available=True))
    try:
        assert s._embed("anything") is None
    finally:
        s.close()
