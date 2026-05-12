"""
title: Nederlandse PII-filter (Anonimiseer)
author: DataLab
version: 0.1.0
license: MIT
description: >-
  Detecteert Nederlandse PII (BSN met Elfproef, NL-telefoon, postcode,
  studentnummer, persoonsnamen, e-mail, IBAN, URL, ...) in chatberichten en
  vervangt deze door stabiele pseudoniemen voordat het bericht naar een
  externe LLM (bv. OpenRouter) gaat. Houdt de mapping per chat bij zodat
  'Jan' over meerdere turns heen consistent blijft. Fail-closed: als de
  pii-engine onbereikbaar is, wordt de prompt geblokkeerd met een uitleg.
requirements: httpx>=0.27
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger("nl_pii_filter")

# De disclaimer-tekst die als system-prompt wordt geinjecteerd bij de eerste
# turn van elke chat. Overtuigt de gebruiker dat ze verantwoordelijk blijven
# voor de gemaakte anonimisering en dat deze laag geen garantie biedt.
DEFAULT_DISCLAIMER = (
    "Let op: de berichten in deze chat worden automatisch geanonimiseerd "
    "voordat ze naar de externe AI-provider gaan. Persoonsgegevens worden "
    "vervangen door pseudoniemen (bv. PERSON_1, NL_BSN_1). Dit is een "
    "hulpmiddel, geen garantie: controleer altijd zelf of er geen "
    "gevoelige informatie in je vragen staat. Jij blijft verantwoordelijk "
    "voor wat je deelt."
)

# Standaard entiteiten die we uit prompts willen strippen. Je kunt dit
# uitbreiden of beperken via de valve `entities`.
DEFAULT_ENTITIES = [
    "NL_BSN",
    "NL_PHONE_NUMBER",
    "NL_POSTCODE",
    "NL_STUDENT_ID",
    "PERSON",
    "LOCATION",
    "EMAIL_ADDRESS",
    "IBAN_CODE",
    "CREDIT_CARD",
    "IP_ADDRESS",
    "URL",
]


class _ChatMappingCache:
    """Houdt pseudoniem-mapping per chat-id bij (LRU, thread-safe).

    Open WebUI draait filters in-process; meerdere gebruikers zitten dus in
    hetzelfde proces. Met een LRU beperken we memory-groei en garanderen we
    dat een lang-onderhoud-loze chat uiteindelijk wordt opgeruimd. Voor
    multi-worker deployments is per-chat consistentie niet gegarandeerd; dat
    vermelden we expliciet in de README.
    """

    def __init__(self, maxsize: int = 256) -> None:
        self._maxsize = maxsize
        self._store: OrderedDict[str, dict[str, str]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, chat_id: str) -> dict[str, str]:
        with self._lock:
            if chat_id in self._store:
                self._store.move_to_end(chat_id)
                return self._store[chat_id]
            mapping: dict[str, str] = {}
            self._store[chat_id] = mapping
            if len(self._store) > self._maxsize:
                self._store.popitem(last=False)
            return mapping

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


class Filter:
    """Open WebUI Filter die Nederlandse PII wegstript voor externe LLM-calls."""

    class Valves(BaseModel):
        priority: int = Field(
            default=0,
            description="Volgorde t.o.v. andere filters (lager = eerder).",
        )
        pii_engine_url: str = Field(
            default="http://pii-engine:8765",
            description="Basis-URL van de lokale pii-engine microservice.",
        )
        mode: Literal["pseudonymize", "redact"] = Field(
            default="pseudonymize",
            description=(
                "pseudonymize: vervang door stabiele tokens (PERSON_1, ...). "
                "redact: vervang door generieke labels ([PERSON], ...)."
            ),
        )
        entities: list[str] = Field(
            default_factory=lambda: DEFAULT_ENTITIES.copy(),
            description="Welke entiteitstypes worden gefilterd.",
        )
        score_threshold: float = Field(
            default=0.35,
            ge=0.0,
            le=1.0,
            description="Minimale detectie-confidence (0.0 tot 1.0).",
        )
        request_timeout_s: float = Field(
            default=15.0,
            ge=1.0,
            le=120.0,
            description="HTTP-timeout naar de pii-engine.",
        )
        show_disclaimer_banner: bool = Field(
            default=True,
            description=(
                "Injecteer bij de eerste turn van elke chat een system-bericht "
                "met uitleg en verantwoordelijkheidsclausule."
            ),
        )
        disclaimer_text: str = Field(
            default=DEFAULT_DISCLAIMER,
            description="Tekst van het system-bericht.",
        )
        deanonymize_in_outlet: bool = Field(
            default=False,
            description=(
                "GEVAARLIJK: als True, worden pseudoniemen in de LLM-response "
                "terugvertaald naar originele waarden voor weergave in de UI. "
                "Standaard uit omdat dit de winst van anonimisering grotendeels "
                "teniet doet (originele waarden komen via logs/DB alsnog naar "
                "buiten). Alleen inschakelen in gecontroleerde pilots."
            ),
        )
        fail_closed: bool = Field(
            default=True,
            description=(
                "Bij fouten van de pii-engine: True = bericht blokkeren met "
                "foutmelding (veilig); False = bericht ongefilterd doorsturen "
                "(onveilig, alleen voor dev/test)."
            ),
        )

    def __init__(self) -> None:
        self.valves = self.Valves()
        self.toggle = True
        # Zichtbare naam + klein schild-iconje in de Open WebUI-filterlijst.
        self.icon = (
            "data:image/svg+xml;base64,"
            "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIg"
            "aGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBzdHJva2U9"
            "IiM0Zjc0ZDEiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0iTTEyIDJMMyA2djZjMCA1"
            "LjUgMy44IDEwLjUgOSAxMiA1LjItMS41IDktNi41IDktMTJWNmwtOS00eiIvPjwvc3Zn"
            "Pg=="
        )
        self._mappings = _ChatMappingCache()

    # ---------------------------------------------------------------
    # Helpers
    # ---------------------------------------------------------------

    def _chat_id(self, body: dict[str, Any]) -> str:
        """Best-effort extractie van een stabiele chat-identifier.

        Open WebUI bevat meestal ``chat_id`` of ``id`` in de body. Als geen
        chat-id gevonden, gebruiken we een placeholder; mapping wordt dan per
        request vers aangemaakt (acceptabel fallback-gedrag).
        """

        chat_id = body.get("chat_id") or body.get("id")
        if isinstance(chat_id, str) and chat_id:
            return chat_id
        metadata = body.get("metadata")
        if isinstance(metadata, dict):
            meta_chat = metadata.get("chat_id") or metadata.get("id")
            if isinstance(meta_chat, str) and meta_chat:
                return meta_chat
        return "__stateless__"

    def _call_engine(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """POST naar de pii-engine. Raise bij non-2xx zodat fail-closed werkt."""

        url = self.valves.pii_engine_url.rstrip("/") + path
        with httpx.Client(timeout=self.valves.request_timeout_s) as client:
            resp = client.post(url, json=payload)
        resp.raise_for_status()
        result = resp.json()
        if not isinstance(result, dict):
            raise ValueError(f"pii-engine gaf onverwachte respons terug: {result!r}")
        return result

    def _anonymize_text(
        self,
        text: str,
        chat_mapping: dict[str, str],
    ) -> tuple[str, list[dict[str, Any]]]:
        """Verstuur een enkele tekstblob naar /anonymize en merge de mapping."""

        payload = {
            "text": text,
            "mode": self.valves.mode,
            "entities": self.valves.entities,
            "score_threshold": self.valves.score_threshold,
            "preserve_mapping": True,
        }
        data = self._call_engine("/anonymize", payload)
        new_text = data.get("text", text)
        for entry in data.get("mapping") or []:
            original = entry.get("original")
            pseudonym = entry.get("pseudonym")
            if isinstance(original, str) and isinstance(pseudonym, str):
                chat_mapping[pseudonym] = original
        items = data.get("items") or []
        return new_text, items

    def _maybe_inject_disclaimer(self, body: dict[str, Any]) -> None:
        """Plaats eenmalig een system-bericht met uitleg bovenaan de chat."""

        if not self.valves.show_disclaimer_banner:
            return
        messages = body.setdefault("messages", [])
        already_has = any(
            isinstance(m, dict)
            and m.get("role") == "system"
            and isinstance(m.get("content"), str)
            and "[Anonimiseer]" in m["content"]
            for m in messages
        )
        if already_has:
            return
        messages.insert(
            0,
            {
                "role": "system",
                "content": f"[Anonimiseer] {self.valves.disclaimer_text}",
            },
        )

    def _block_message(self, reason: str) -> str:
        return (
            "[Anonimiseer] Dit bericht is NIET naar de AI gestuurd omdat "
            f"de PII-filter niet kon valideren dat het veilig was: {reason}. "
            "Neem contact op met de beheerder als dit onterecht lijkt."
        )

    # ---------------------------------------------------------------
    # Open WebUI hooks
    # ---------------------------------------------------------------

    def inlet(self, body: dict[str, Any], __user__: dict | None = None) -> dict[str, Any]:
        """Anonimiseer alle user-berichten voordat ze naar de LLM gaan."""

        self._maybe_inject_disclaimer(body)
        chat_id = self._chat_id(body)
        mapping = self._mappings.get(chat_id)

        messages = body.get("messages") or []
        for idx, msg in enumerate(messages):
            if not isinstance(msg, dict):
                continue
            if msg.get("role") != "user":
                continue
            content = msg.get("content")
            if not isinstance(content, str) or not content.strip():
                continue
            try:
                new_content, _items = self._anonymize_text(content, mapping)
            except (httpx.HTTPError, ValueError) as exc:
                logger.exception("pii-engine onbereikbaar voor chat %s", chat_id)
                if self.valves.fail_closed:
                    messages[idx] = {
                        "role": "user",
                        "content": self._block_message(str(exc)),
                    }
                    continue
                # fail-open: laat bericht ongefilterd staan (dev/test-modus).
                continue
            msg["content"] = new_content

        body["messages"] = messages
        return body

    def outlet(self, body: dict[str, Any], __user__: dict | None = None) -> dict[str, Any]:
        """Optioneel: vertaal pseudoniemen terug naar originelen in de reply.

        Standaard staat deze modus uit. Zie `deanonymize_in_outlet` voor de
        rationale.
        """

        if not self.valves.deanonymize_in_outlet:
            return body
        chat_id = self._chat_id(body)
        mapping = self._mappings.get(chat_id)
        if not mapping:
            return body

        for msg in body.get("messages") or []:
            if not isinstance(msg, dict) or msg.get("role") != "assistant":
                continue
            content = msg.get("content")
            if not isinstance(content, str):
                continue
            # Eenvoudige token-vervanging. Lange tokens eerst zodat
            # PERSON_10 niet per ongeluk matcht op PERSON_1.
            for pseudonym in sorted(mapping, key=len, reverse=True):
                content = content.replace(pseudonym, mapping[pseudonym])
            msg["content"] = content
        return body
