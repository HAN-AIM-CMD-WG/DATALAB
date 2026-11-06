"""Write the third-party overview and the full licence texts that ship with the app.

Run it with the Python of the engine build environment, after ``npm ci`` in the
app, so both the bundled Python packages and the app's node_modules are there:

    packages/pii-engine/build/.venv/bin/python scripts/third_party_notices.py

Outputs:
    THIRD-PARTY-NOTICES.md                                  overview, in the repo
    apps/electron-anonimiseer/resources/third-party-licenses.txt
                                                            overview plus full texts,
                                                            shipped with the app
"""

from __future__ import annotations

import importlib.metadata as md
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "apps" / "electron-anonimiseer"
NOTICES = ROOT / "THIRD-PARTY-NOTICES.md"
FULL = APP / "resources" / "third-party-licenses.txt"

# Build tools and the engine itself; they are not part of what ships.
PY_SKIP = {
    "altgraph",
    "macholib",
    "pefile",
    "pii-engine",
    "pip",
    "pyinstaller",
    "pyinstaller-hooks-contrib",
    "pymupdf",
    "pywin32-ctypes",
    "setuptools",
    "wheel",
}
LICENCE_FILE = re.compile(r"^(licen[cs]e|copying|notice|authors)", re.IGNORECASE)

SHIPPED_MODELS = [
    ("spaCy nl_core_news_lg 3.8.0", "CC BY-SA 4.0", "https://spacy.io/models/nl"),
    (
        "bardsai/eu-pii-anonimization-multilang-v3 (091984b5)",
        "Apache-2.0",
        "https://huggingface.co/bardsai/eu-pii-anonimization-multilang-v3",
    ),
]
ON_REQUEST = [
    (
        "PyMuPDF 1.27.2.2 (PDF-ondersteuning)",
        "AGPL-3.0 of een commerciële licentie",
        "https://github.com/pymupdf/PyMuPDF/blob/main/COPYING",
    ),
    (
        "wietsedv/bert-base-dutch-cased-finetuned-sonar-ner (SoNaR-BERT)",
        "geen licentie vermeld",
        "https://huggingface.co/wietsedv/bert-base-dutch-cased-finetuned-sonar-ner",
    ),
    (
        "fastino/gliner2-privacy-filter-PII-multi (eigen begrippen)",
        "Apache-2.0",
        "https://huggingface.co/fastino/gliner2-privacy-filter-PII-multi",
    ),
]


@dataclass
class Package:
    name: str
    version: str
    licence: str
    texts: list[tuple[str, str]] = field(default_factory=list)


def _python_licence(meta: md.PackageMetadata) -> str:
    expression = (meta.get("License-Expression") or "").strip()
    if expression:
        return expression
    raw = (meta.get("License") or "").strip()
    if raw and "\n" not in raw and len(raw) <= 60 and raw.upper() != "UNKNOWN":
        return raw
    classifiers = [
        c.split("::")[-1].strip()
        for c in meta.get_all("Classifier") or []
        if c.startswith("License ::")
    ]
    return ", ".join(dict.fromkeys(classifiers)) or "onbekend"


def python_packages() -> list[Package]:
    seen: dict[str, Package] = {}
    for dist in md.distributions():
        name = dist.metadata["Name"]
        if not name or name.lower() in PY_SKIP or name.lower() in seen:
            continue
        package = Package(name, dist.version, _python_licence(dist.metadata))
        for file in dist.files or []:
            if LICENCE_FILE.match(Path(str(file)).name) or "licenses/" in str(file):
                path = Path(str(dist.locate_file(file)))
                if path.is_file():
                    package.texts.append((str(file), path.read_text(errors="replace")))
        seen[name.lower()] = package
    return sorted(seen.values(), key=lambda p: p.name.lower())


def _npm_texts(folder: Path) -> list[tuple[str, str]]:
    if not folder.is_dir():
        return []
    return [
        (f.name, f.read_text(errors="replace"))
        for f in sorted(folder.iterdir())
        if f.is_file() and LICENCE_FILE.match(f.name)
    ]


def npm_packages() -> list[Package]:
    lock = json.loads((APP / "package-lock.json").read_text(encoding="utf-8"))
    packages: list[Package] = []
    for path, entry in lock.get("packages", {}).items():
        if not path.startswith("node_modules/") or entry.get("dev") or entry.get("devOptional"):
            continue
        name = path.rsplit("node_modules/", 1)[1]
        packages.append(
            Package(
                name,
                entry.get("version", "?"),
                entry.get("license") or "onbekend",
                _npm_texts(APP / path),
            )
        )
    electron = APP / "node_modules" / "electron"
    version = json.loads((electron / "package.json").read_text())["version"]
    packages.append(Package("electron", version, "MIT", _npm_texts(electron)))
    return sorted(packages, key=lambda p: p.name.lower())


def _table(rows: list[tuple[str, str, str]], header: tuple[str, str, str]) -> list[str]:
    lines = [f"| {' | '.join(header)} |", "|---|---|---|"]
    lines += [f"| {a} | {b} | {c} |" for a, b, c in rows]
    return lines


def overview(python: list[Package], npm: list[Package]) -> list[str]:
    lines = [
        "# Onderdelen van derden",
        "",
        "Anonimiseer bestaat voor een groot deel uit werk van anderen. Hieronder staat wat er",
        "in de installer zit en wat de app pas op jouw verzoek downloadt, met de licentie.",
        "Gegenereerd door `scripts/third_party_notices.py`; de volledige licentieteksten",
        "zitten in de app, onder Hulp → Licenties.",
        "",
        "## Modellen in de installer",
        "",
        *_table(SHIPPED_MODELS, ("Model", "Licentie", "Bron")),
        "",
        "## Alleen op verzoek gedownload",
        "",
        "Deze zitten niet in de installer. De app vraagt eerst om bevestiging en toont de licentie.",
        "",
        *_table(ON_REQUEST, ("Onderdeel", "Licentie", "Bron")),
        "",
        "Lokale taalmodellen via Ollama kies je zelf; elk heeft een eigen licentie, die Ollama",
        "bij het model vermeldt.",
        "",
        f"## Python-pakketten in de engine ({len(python)})",
        "",
        *_table([(p.name, p.version, p.licence) for p in python], ("Pakket", "Versie", "Licentie")),
        "",
        f"## JavaScript-pakketten in de app ({len(npm)})",
        "",
        *_table([(p.name, p.version, p.licence) for p in npm], ("Pakket", "Versie", "Licentie")),
        "",
        "Electron levert Chromium mee; de licenties daarvan staan in `LICENSES.chromium.html`",
        "naast de app.",
        "",
    ]
    return lines


def full_texts(packages: list[Package]) -> list[str]:
    lines = ["", "=" * 78, "Volledige licentieteksten", "=" * 78]
    for p in packages:
        lines += ["", "-" * 78, f"{p.name} {p.version} — {p.licence}", "-" * 78]
        if not p.texts:
            lines.append("Geen licentiebestand meegeleverd; zie de licentie hierboven.")
        for name, text in p.texts:
            lines += [f"[{name}]", text.rstrip()]
    return lines


def main() -> None:
    python, npm = python_packages(), npm_packages()
    summary = overview(python, npm)
    NOTICES.write_text("\n".join(summary), encoding="utf-8")
    FULL.parent.mkdir(parents=True, exist_ok=True)
    FULL.write_text("\n".join(summary + full_texts(python + npm)) + "\n", encoding="utf-8")
    missing = [p.name for p in python + npm if p.licence == "onbekend"]
    print(f"{len(python)} Python-pakketten, {len(npm)} JavaScript-pakketten")
    print(f"{FULL.stat().st_size // 1024} kB in {FULL.relative_to(ROOT)}")
    if missing:
        print("LET OP, licentie onbekend:", ", ".join(missing))


if __name__ == "__main__":
    main()
