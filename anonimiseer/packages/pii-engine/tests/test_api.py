"""End-to-end API-tests via FastAPI's TestClient.

De tests gebruiken de fallback-NLP (blank NL) zodat er geen model gedownload
hoeft te worden. spaCy-afhankelijke NER-entiteiten (PERSON/LOCATION) worden
daardoor niet gedetecteerd; dat is prima voor deze suite, we testen hier onze
eigen NL-recognizers (BSN, telefoon, postcode).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client() -> TestClient:
    from pii_engine.api import create_app

    return TestClient(create_app())


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["recognizers"] > 0


def test_analyze_bsn(client: TestClient) -> None:
    r = client.post(
        "/analyze",
        json={"text": "Mijn BSN is 123456782.", "entities": ["NL_BSN"]},
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["entity_type"] == "NL_BSN"
    assert items[0]["original"] == "123456782"


def test_anonymize_pseudonymize_roundtrip(client: TestClient) -> None:
    payload = {
        "text": "BSN 123456782 hoort bij telefoon 06-12345678.",
        "mode": "pseudonymize",
        "entities": ["NL_BSN", "NL_PHONE_NUMBER"],
    }
    r = client.post("/anonymize", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert "NL_BSN_1" in body["text"]
    assert "NL_PHONE_NUMBER_1" in body["text"]
    assert body["mapping"] is not None
    originals = {m["original"] for m in body["mapping"]}
    assert "123456782" in originals


def test_anonymize_redact(client: TestClient) -> None:
    r = client.post(
        "/anonymize",
        json={"text": "BSN 123456782.", "mode": "redact", "entities": ["NL_BSN"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "BSN [NL_BSN]."
    assert body["mapping"] is None
