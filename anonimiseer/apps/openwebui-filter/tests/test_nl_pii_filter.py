"""Unit-tests voor de Open WebUI Filter.

We mocken de pii-engine via ``httpx.MockTransport`` zodat we geen echte service
nodig hebben en de tests deterministisch zijn. De mock simuleert de
``/anonymize``-response-vorm van de echte engine.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import httpx
import pytest

import nl_pii_filter  # noqa: E402  (sys.path-magic in conftest)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_engine():
    """Context manager die ``nl_pii_filter.httpx.Client`` vervangt door een
    factory die een echte ``httpx.Client`` met ``MockTransport`` teruggeeft.

    De handler leest `canned` en `fail` dynamisch van het ``_Ctx`` object, zodat
    testen tussen ``__enter__`` en de eerste HTTP-call nog configuratie kunnen
    toevoegen.
    """

    _original_client = httpx.Client

    class _Ctx:
        def __init__(self) -> None:
            self.canned: dict[str, dict[str, Any]] = {}
            self.fail = False
            self._patcher: Any = None

        def set(self, text: str, response: dict[str, Any]) -> None:
            self.canned[text] = response

        def set_fail(self) -> None:
            self.fail = True

        def __enter__(self):
            ctx = self

            def handler(request: httpx.Request) -> httpx.Response:
                if ctx.fail:
                    return httpx.Response(500, json={"detail": "engine kapot"})
                import json

                data = json.loads(request.read())
                text = data.get("text", "")
                if text in ctx.canned:
                    return httpx.Response(200, json=ctx.canned[text])
                return httpx.Response(
                    200, json={"text": text, "items": [], "mapping": []}
                )

            transport = httpx.MockTransport(handler)

            def factory(*args: Any, **kwargs: Any) -> httpx.Client:
                kwargs.pop("transport", None)
                return _original_client(*args, transport=transport, **kwargs)

            self._patcher = patch("nl_pii_filter.httpx.Client", new=factory)
            self._patcher.start()
            return self

        def __exit__(self, *exc) -> None:
            if self._patcher:
                self._patcher.stop()

    return _Ctx()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestInletAnonymization:
    def test_user_message_is_anonymized(self, mock_engine) -> None:
        with mock_engine as m:
            m.set(
                "Mijn BSN is 123456782.",
                {
                    "text": "Mijn BSN is NL_BSN_1.",
                    "items": [
                        {
                            "entity_type": "NL_BSN",
                            "original": "123456782",
                            "pseudonym": "NL_BSN_1",
                            "start": 12,
                            "end": 21,
                            "score": 1.0,
                        }
                    ],
                    "mapping": [
                        {
                            "entity_type": "NL_BSN",
                            "original": "123456782",
                            "pseudonym": "NL_BSN_1",
                        }
                    ],
                },
            )
            flt = nl_pii_filter.Filter()
            flt.valves.show_disclaimer_banner = False
            body = {
                "chat_id": "chat-1",
                "messages": [{"role": "user", "content": "Mijn BSN is 123456782."}],
            }
            out = flt.inlet(body)
            assert out["messages"][0]["content"] == "Mijn BSN is NL_BSN_1."

    def test_system_messages_untouched(self, mock_engine) -> None:
        with mock_engine as m:
            m.set("Hallo wereld", {"text": "Hallo wereld", "items": [], "mapping": []})
            flt = nl_pii_filter.Filter()
            flt.valves.show_disclaimer_banner = False
            body = {
                "chat_id": "c",
                "messages": [
                    {"role": "system", "content": "Original system"},
                    {"role": "user", "content": "Hallo wereld"},
                ],
            }
            out = flt.inlet(body)
            assert out["messages"][0]["content"] == "Original system"


class TestDisclaimer:
    def test_disclaimer_added_on_first_call(self, mock_engine) -> None:
        with mock_engine:
            flt = nl_pii_filter.Filter()
            body = {
                "chat_id": "c",
                "messages": [{"role": "user", "content": "Hi"}],
            }
            out = flt.inlet(body)
            assert out["messages"][0]["role"] == "system"
            assert "[Anonimiseer]" in out["messages"][0]["content"]

    def test_disclaimer_not_duplicated_across_turns(self, mock_engine) -> None:
        with mock_engine:
            flt = nl_pii_filter.Filter()
            body = {
                "chat_id": "c",
                "messages": [
                    {"role": "system", "content": "[Anonimiseer] previous turn"},
                    {"role": "user", "content": "follow-up"},
                ],
            }
            out = flt.inlet(body)
            systems = [m for m in out["messages"] if m.get("role") == "system"]
            assert len(systems) == 1

    def test_disclaimer_disabled_via_valve(self, mock_engine) -> None:
        with mock_engine:
            flt = nl_pii_filter.Filter()
            flt.valves.show_disclaimer_banner = False
            body = {"chat_id": "c", "messages": [{"role": "user", "content": "Hi"}]}
            out = flt.inlet(body)
            assert all(m.get("role") != "system" for m in out["messages"])


class TestPerChatConsistency:
    def test_same_chat_reuses_mapping(self, mock_engine) -> None:
        """De filter moet de mapping voor één chat delen tussen turns."""

        with mock_engine as m:
            m.set(
                "Jan belt.",
                {
                    "text": "PERSON_1 belt.",
                    "items": [],
                    "mapping": [
                        {
                            "entity_type": "PERSON",
                            "original": "Jan",
                            "pseudonym": "PERSON_1",
                        }
                    ],
                },
            )
            flt = nl_pii_filter.Filter()
            flt.valves.show_disclaimer_banner = False
            body = {
                "chat_id": "same-chat",
                "messages": [{"role": "user", "content": "Jan belt."}],
            }
            flt.inlet(body)
            # Mapping voor deze chat moet nu PERSON_1 -> Jan bevatten.
            stored = flt._mappings.get("same-chat")  # type: ignore[attr-defined]
            assert stored.get("PERSON_1") == "Jan"


class TestFailClosed:
    def test_blocks_message_on_engine_failure(self, mock_engine) -> None:
        with mock_engine as m:
            m.set_fail()
            flt = nl_pii_filter.Filter()
            flt.valves.show_disclaimer_banner = False
            flt.valves.fail_closed = True
            body = {
                "chat_id": "c",
                "messages": [{"role": "user", "content": "Gevoelige data"}],
            }
            out = flt.inlet(body)
            content = out["messages"][0]["content"]
            assert "[Anonimiseer]" in content
            assert "NIET naar de AI" in content

    def test_fail_open_passes_through(self, mock_engine) -> None:
        with mock_engine as m:
            m.set_fail()
            flt = nl_pii_filter.Filter()
            flt.valves.show_disclaimer_banner = False
            flt.valves.fail_closed = False
            body = {
                "chat_id": "c",
                "messages": [{"role": "user", "content": "Gevoelige data"}],
            }
            out = flt.inlet(body)
            assert out["messages"][0]["content"] == "Gevoelige data"


class TestOutletDeanonymize:
    def test_default_outlet_leaves_pseudonyms_intact(self, mock_engine) -> None:
        with mock_engine:
            flt = nl_pii_filter.Filter()
            # Prefill mapping.
            flt._mappings.get("c")["PERSON_1"] = "Jan"  # type: ignore[attr-defined]
            body = {
                "chat_id": "c",
                "messages": [
                    {"role": "assistant", "content": "PERSON_1 is aanwezig."},
                ],
            }
            out = flt.outlet(body)
            assert out["messages"][0]["content"] == "PERSON_1 is aanwezig."

    def test_deanonymize_when_enabled(self, mock_engine) -> None:
        with mock_engine:
            flt = nl_pii_filter.Filter()
            flt.valves.deanonymize_in_outlet = True
            mapping = flt._mappings.get("c")  # type: ignore[attr-defined]
            mapping["PERSON_1"] = "Jan"
            mapping["PERSON_10"] = "Anna"
            body = {
                "chat_id": "c",
                "messages": [
                    {
                        "role": "assistant",
                        "content": "PERSON_10 en PERSON_1 praten.",
                    }
                ],
            }
            out = flt.outlet(body)
            # Langere token eerst vervangen (PERSON_10), dus correct resultaat.
            assert out["messages"][0]["content"] == "Anna en Jan praten."
