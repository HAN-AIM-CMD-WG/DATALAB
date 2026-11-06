"""Optional components: pinned download, hash check, safe unpacking, lazy import."""

from __future__ import annotations

import hashlib
import io
import sys
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pii_engine import components
from pii_engine.components import Component, ComponentError, ComponentMissing, Wheel

MODULE = "anonimiseer_fake_component"


def _wheel(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buffer.getvalue()


def _component(data: bytes, sha256: str | None = None) -> Component:
    return Component(
        name="fake",
        module=MODULE,
        version="1.0",
        missing_message="Het nep-onderdeel ontbreekt.",
        wheels={
            components.platform_key(): Wheel(
                "https://example.invalid/fake.whl", sha256 or hashlib.sha256(data).hexdigest()
            )
        },
    )


@pytest.fixture
def served(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[dict[str, bytes]]:
    """Serve one wheel from memory and install into a temporary folder."""
    monkeypatch.setenv("ANONIMISEER_COMPONENTS_DIR", str(tmp_path / "components"))
    payload: dict[str, bytes] = {}
    monkeypatch.setattr(
        components, "_chunks", lambda url: (len(payload["data"]), iter([payload["data"]]))
    )
    path_before = list(sys.path)
    yield payload
    sys.path[:] = path_before
    sys.modules.pop(MODULE, None)


@pytest.mark.parametrize(
    ("system", "machine", "key"),
    [
        ("darwin", "arm64", "darwin-arm64"),
        ("darwin", "x86_64", "darwin-x86_64"),
        ("win32", "AMD64", "win32-x86_64"),
        ("linux", "aarch64", "linux-arm64"),
    ],
)
def test_platform_key(monkeypatch: pytest.MonkeyPatch, system: str, machine: str, key: str) -> None:
    monkeypatch.setattr(components.sys, "platform", system)
    monkeypatch.setattr(components.platform, "machine", lambda: machine)
    assert components.platform_key() == key


def test_pymupdf_is_pinned_for_every_platform_we_build() -> None:
    for key in ("darwin-arm64", "darwin-x86_64", "win32-x86_64", "linux-x86_64"):
        wheel = components.PYMUPDF.wheels[key]
        assert wheel.url.startswith("https://files.pythonhosted.org/")
        assert components.PYMUPDF.version in wheel.url
        assert len(wheel.sha256) == 64


def test_install_checks_the_hash_and_makes_the_module_importable(
    served: dict[str, bytes],
) -> None:
    served["data"] = _wheel({f"{MODULE}/__init__.py": "VALUE = 42\n"})
    component = _component(served["data"])
    with pytest.raises(ComponentMissing, match="nep-onderdeel ontbreekt"):
        components.require(component)

    steps: list[float] = []
    folder = components.install(component, lambda progress, _message: steps.append(progress))

    assert components.installed(component)
    assert folder == components.install_dir(component)
    assert components.require(component).VALUE == 42
    assert steps == sorted(steps)


def test_a_wrong_hash_installs_nothing(served: dict[str, bytes]) -> None:
    served["data"] = _wheel({f"{MODULE}/__init__.py": "VALUE = 1\n"})
    component = _component(served["data"], sha256="0" * 64)
    with pytest.raises(ComponentError, match="controlegetal"):
        components.install(component, lambda *_: None)
    assert not components.install_dir(component).exists()
    assert not components.available(component)


@pytest.mark.parametrize("name", ["../evil.py", "/etc/evil.py", "C:/evil.py", "a/../../evil.py"])
def test_a_path_outside_the_folder_installs_nothing(served: dict[str, bytes], name: str) -> None:
    served["data"] = _wheel({f"{MODULE}/__init__.py": "VALUE = 1\n", name: "x = 1\n"})
    component = _component(served["data"])
    with pytest.raises(ComponentError, match="Onveilig pad"):
        components.install(component, lambda *_: None)
    assert not components.install_dir(component).exists()


def test_no_wheel_for_this_platform(served: dict[str, bytes]) -> None:
    component = Component("fake", MODULE, "1.0", "ontbreekt", wheels={})
    with pytest.raises(ComponentError, match="niet beschikbaar"):
        components.install(component, lambda *_: None)


def test_pdf_without_the_component_gets_a_clear_message(monkeypatch: pytest.MonkeyPatch) -> None:
    from pii_engine.api import create_app
    from pii_engine.documents import pdf_support

    def missing(component: Component) -> None:
        raise ComponentMissing(component.missing_message)

    monkeypatch.setattr(pdf_support, "require", missing)
    client = TestClient(create_app(), base_url="http://127.0.0.1")
    r = client.post(
        "/document/extract", files={"file": ("brief.pdf", b"%PDF-1.4\n", "application/pdf")}
    )
    assert r.status_code == 424
    assert "Modellen beheren" in r.json()["detail"]


def test_sonar_is_a_download_with_a_notice() -> None:
    from pii_engine import models

    sonar = next(m for m in models._HF_MODELS if m.role == "ner")
    assert sonar.on_demand
    assert "geen licentie" in sonar.notice


def test_an_installed_model_rebuilds_the_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    """A model that was missing at start-up would otherwise stay failed."""
    import huggingface_hub

    from pii_engine import models, runtime

    refreshed: list[bool] = []
    monkeypatch.setattr(huggingface_hub, "snapshot_download", lambda **_: "/tmp/model")
    monkeypatch.setattr(runtime, "refresh_pipeline", lambda: refreshed.append(True))
    sonar = next(m for m in models._HF_MODELS if m.role == "ner")
    task = models._new_task(sonar)
    models._install_hf(sonar, task.id)
    assert models.get_task(task.id).state == "done"  # type: ignore[union-attr]
    assert refreshed == [True]


def test_the_model_manager_lists_pdf_support_with_its_licence_notice() -> None:
    from pii_engine.api import create_app

    client = TestClient(create_app(), base_url="http://127.0.0.1")
    models = {m["id"]: m for m in client.get("/models").json()["models"]}
    pdf = models["component:pymupdf"]
    assert pdf["kind"] == "component"
    assert pdf["role"] == "component"
    assert "AGPL-3.0" in pdf["license"]
    assert "AGPL-3.0" in pdf["notice"]
    assert client.get("/engine/active").json()["pdf_support"] is True
