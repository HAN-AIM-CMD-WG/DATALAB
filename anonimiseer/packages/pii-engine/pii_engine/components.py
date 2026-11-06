"""Optional components the user downloads in the Model Manager.

A component is a Python package the installer does not ship, because of its
licence. The engine downloads one pinned wheel for this platform from PyPI,
checks its SHA-256, unpacks it into a folder of its own and imports it from
there. Nothing is unpacked unless the hash matches.
"""

from __future__ import annotations

import hashlib
import importlib
import importlib.util
import os
import platform
import shutil
import sys
import tempfile
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from types import ModuleType

Progress = Callable[[float, str], None]


class ComponentError(RuntimeError):
    """A component could not be installed; the message is meant for the user."""


class ComponentMissing(ComponentError):  # noqa: N818 — reads as a state, like UnsupportedFormat
    """A component is needed but not installed; the message says where to get it."""


@dataclass(frozen=True)
class Wheel:
    url: str
    sha256: str


@dataclass(frozen=True)
class Component:
    name: str
    module: str
    version: str
    missing_message: str
    wheels: dict[str, Wheel]
    """Per platform key (see :func:`platform_key`)."""


_PYPI = "https://files.pythonhosted.org/packages"

# To move to a new version, take the wheel URLs and sha256 digests from
# https://pypi.org/pypi/pymupdf/<version>/json and pin the same version in the
# ``pdf`` and ``dev`` extras of pyproject.toml.
PYMUPDF = Component(
    name="pymupdf",
    module="fitz",
    version="1.27.2.2",
    missing_message=(
        "PDF-ondersteuning is niet geïnstalleerd. Installeer het onderdeel"
        " 'PDF-ondersteuning (PyMuPDF)' in Modellen beheren."
    ),
    wheels={
        "darwin-arm64": Wheel(
            f"{_PYPI}/6d/0e/9f526bc1d49d8082eff0d1547a69d541a0c5a052e71da625559efaba46a6/"
            "pymupdf-1.27.2.2-cp310-abi3-macosx_11_0_arm64.whl",
            "8e2e4299ef1ac0c9dff9be096cbd22783699673abecfa7c3f73173ae06421d73",
        ),
        "darwin-x86_64": Wheel(
            f"{_PYPI}/90/88/d01992a50165e22dec057a1129826846c547feb4ba07f42720ac030ce438/"
            "pymupdf-1.27.2.2-cp310-abi3-macosx_10_9_x86_64.whl",
            "800f43e60a6f01f644343c2213b8613db02eaf4f4ba235b417b3351fa99e01c0",
        ),
        "win32-x86_64": Wheel(
            f"{_PYPI}/a8/b6/2a9a8556000199bbf80a5915dcd15d550d1e5288894316445c54726aaf53/"
            "pymupdf-1.27.2.2-cp310-abi3-win_amd64.whl",
            "09bb53f9486ccb5297030cbc2dbdae845ba1c3c5126e96eb2d16c4f118de0b5b",
        ),
        "linux-x86_64": Wheel(
            f"{_PYPI}/22/8e/85e9d9f11dbf34036eb1df283805ef6b885f2005a56d6533bb58ab0b8a11/"
            "pymupdf-1.27.2.2-cp310-abi3-manylinux_2_28_x86_64.whl",
            "892698c9768457eb0991c102c96a856c0a7062539371df5e6bee0816f3ef498e",
        ),
        "linux-arm64": Wheel(
            f"{_PYPI}/42/be/984f0d6343935b5dd30afaed6be04fc753146bf55709e63ef28bf9ef7497/"
            "pymupdf-1.27.2.2-cp310-abi3-manylinux_2_28_aarch64.whl",
            "c5e3d54922db1c7da844f1208ac1db05704770988752311f81dd36694ae0a07b",
        ),
    },
)

COMPONENTS: dict[str, Component] = {PYMUPDF.name: PYMUPDF}

_MARKER = ".sha256"
_CHUNK = 1 << 16


def components_dir() -> Path:
    explicit = os.environ.get("ANONIMISEER_COMPONENTS_DIR")
    return Path(explicit) if explicit else Path.home() / ".anonimiseer" / "components"


def platform_key() -> str:
    machine = platform.machine().lower()
    arch = {"amd64": "x86_64", "aarch64": "arm64"}.get(machine, machine)
    return f"{sys.platform}-{arch}"


def install_dir(component: Component) -> Path:
    return components_dir() / f"{component.name}-{component.version}"


def installed(component: Component) -> bool:
    return (install_dir(component) / _MARKER).is_file()


def activate(component: Component) -> None:
    """Make an installed component importable; a no-op when it is not installed."""
    folder = str(install_dir(component))
    if installed(component) and folder not in sys.path:
        sys.path.append(folder)
        importlib.invalidate_caches()


def available(component: Component) -> bool:
    """Importable, from the component folder or, in development, from the environment."""
    activate(component)
    return importlib.util.find_spec(component.module) is not None


def require(component: Component) -> ModuleType:
    activate(component)
    try:
        return importlib.import_module(component.module)
    except ImportError as exc:
        raise ComponentMissing(component.missing_message) from exc


def _chunks(url: str) -> tuple[int, Iterator[bytes]]:
    import httpx

    def stream() -> Iterator[bytes]:
        with httpx.stream("GET", url, follow_redirects=True, timeout=60) as r:
            r.raise_for_status()
            yield from r.iter_bytes(_CHUNK)

    head = httpx.head(url, follow_redirects=True, timeout=60)
    return int(head.headers.get("content-length") or 0), stream()


def _download(wheel: Wheel, dest: Path, progress: Progress) -> None:
    total, chunks = _chunks(wheel.url)
    digest = hashlib.sha256()
    done = 0
    with dest.open("wb") as out:
        for chunk in chunks:
            digest.update(chunk)
            out.write(chunk)
            done += len(chunk)
            if total:
                progress(0.05 + 0.85 * done / total, f"Downloaden… {done // 1_000_000} MB")
    if digest.hexdigest() != wheel.sha256:
        raise ComponentError(
            "Het gedownloade bestand komt niet overeen met het verwachte controlegetal"
            " en is niet geïnstalleerd."
        )


def _unpack(archive: Path, dest: Path) -> None:
    with zipfile.ZipFile(archive) as zf:
        for name in zf.namelist():
            parts = PurePosixPath(name.replace("\\", "/")).parts
            if not parts or name.startswith(("/", "\\")) or ".." in parts or ":" in parts[0]:
                raise ComponentError(f"Onveilig pad in het pakket: {name!r}; niet geïnstalleerd.")
        zf.extractall(dest)


def install(component: Component, progress: Progress) -> Path:
    wheel = component.wheels.get(platform_key())
    if wheel is None:
        raise ComponentError(f"Dit onderdeel is niet beschikbaar voor {platform_key()}.")
    target = install_dir(component)
    if installed(component):
        return target
    root = components_dir()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(dir=root) as tmp:
        archive = Path(tmp) / "wheel.zip"
        progress(0.05, "Downloaden van PyPI…")
        _download(wheel, archive, progress)
        progress(0.92, "Uitpakken…")
        unpacked = Path(tmp) / "unpacked"
        _unpack(archive, unpacked)
        (unpacked / _MARKER).write_text(wheel.sha256, encoding="utf-8")
        if target.exists():
            shutil.rmtree(target)
        os.replace(unpacked, target)
    activate(component)
    return target


__all__ = [
    "COMPONENTS",
    "PYMUPDF",
    "Component",
    "ComponentError",
    "ComponentMissing",
    "Wheel",
    "available",
    "install",
    "installed",
    "platform_key",
    "require",
]
