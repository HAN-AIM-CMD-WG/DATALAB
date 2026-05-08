"""Bereid een HuggingFace seed-cache voor met SoNaR-BERT (safetensors-only).

De gebundelde app wordt met deze cache meegeleverd zodat SoNaR-BERT NER
out-of-the-box werkt zonder dat de gebruiker iets hoeft te downloaden.

Strategie: kopieer de lokale ``~/.anonimiseer/huggingface/hub/models--.../``-
cache-structuur naar ``build/hf-seed/hub/``, maar sla de dubbele
``pytorch_model.bin``-blob over (alleen ``model.safetensors`` is nodig;
transformers geeft daar automatisch de voorkeur aan). Dat scheelt ~416 MB.

Vereist: SoNaR-BERT moet eerder al een keer gedownload zijn naar
``~/.anonimiseer/huggingface/hub/``. Check dat eerst via
``curl /models`` of de Model Manager in de dev-app.

Uitvoer: ``packages/pii-engine/build/hf-seed/hub/models--.../``.
Wordt door electron-builder als extraResource gekopieerd naar
``<App>/resources/hf-seed`` en door ``engineProcess.ts`` bij eerste start
naar ``~/.anonimiseer/huggingface/hub/`` geseed op de eindgebruiker.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

SEED_DIR = Path(__file__).resolve().parent / "hf-seed" / "hub"

MODELS_TO_SEED = [
    # SoNaR-BERT is genoeg: het is een fine-tuned BERTje met NER-head.
    # BERTje (GroNLP/bert-base-dutch-cased) zonder head heeft in de app
    # geen onafhankelijke functie, dus die slaan we over om ~440 MB te
    # besparen.
    "wietsedv/bert-base-dutch-cased-finetuned-sonar-ner",
]

# Bestanden die we ABSOLUUT niet willen meebundelen — dubbele weights in
# oude formats en README-md.
SKIP_FILE_SUFFIXES = [".bin", ".msgpack", ".h5", ".ot", ".tflite", ".md"]


def _source_cache_root() -> Path:
    override = os.environ.get("ANONIMISEER_HF_CACHE")
    if override:
        return Path(override) / "hub"
    return Path.home() / ".anonimiseer" / "huggingface" / "hub"


def _repo_to_folder(repo_id: str) -> str:
    return "models--" + repo_id.replace("/", "--")


def _copy_filtered(src: Path, dst: Path) -> tuple[int, int]:
    """Kopieer src→dst en behoud HF cache-structuur (blobs + snapshot-symlinks).

    - Symlinks kopiëren we als symlink (niet volgen); anders zou elke snapshot-
      link het blob nogmaals dupliceren.
    - Blobs met een ongewenste suffix (zie ``SKIP_FILE_SUFFIXES``) slaan we
      over; we bepalen dat door te kijken waar een snapshot-symlink naar wijst.
      Als de enige snapshot-link voor een blob naar ``pytorch_model.bin`` wijst
      slaan we het blob over. Snapshot-symlinks naar die blob negeren we ook.

    Retourneert (gekopieerde_bytes, overgeslagen_bytes).
    """

    copied = 0
    skipped = 0

    # Stap 1: scan snapshots/ en bepaal welke blobs we mogen meenemen en
    # onder welke naam elk blob logisch hoort.
    snapshots_root = src / "snapshots"
    allowed_blobs: set[str] = set()
    if snapshots_root.exists():
        for link in snapshots_root.rglob("*"):
            if not link.is_symlink():
                continue
            if any(link.name.endswith(sfx) for sfx in SKIP_FILE_SUFFIXES):
                continue
            target = os.readlink(link)
            blob_hash = os.path.basename(target)
            allowed_blobs.add(blob_hash)

    # Stap 2: kopieer blobs/ (alleen toegestane hashes).
    blobs_src = src / "blobs"
    if blobs_src.exists():
        blobs_dst = dst / "blobs"
        blobs_dst.mkdir(parents=True, exist_ok=True)
        for blob in blobs_src.iterdir():
            if not blob.is_file():
                continue
            size = blob.stat().st_size
            if blob.name not in allowed_blobs:
                skipped += size
                continue
            shutil.copy2(blob, blobs_dst / blob.name)
            copied += size

    # Stap 3: kopieer snapshots/ en refs/ met behoud van symlinks.
    for sub in ("snapshots", "refs"):
        sub_src = src / sub
        if not sub_src.exists():
            continue
        for entry in sub_src.rglob("*"):
            rel = entry.relative_to(src)
            target = dst / rel
            if entry.is_symlink():
                if any(entry.name.endswith(sfx) for sfx in SKIP_FILE_SUFFIXES):
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                # Behoud relatieve symlink, wijst naar ../../blobs/<hash>.
                link_target = os.readlink(entry)
                # Als target verwijst naar een geskipt blob, sla symlink over.
                if target.exists() or target.is_symlink():
                    target.unlink()
                os.symlink(link_target, target)
            elif entry.is_file():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(entry, target)
                try:
                    copied += target.stat().st_size
                except OSError:
                    pass
            # dirs worden vanzelf gemaakt door mkdir

    return copied, skipped


def main() -> int:
    source_root = _source_cache_root()
    if not source_root.exists():
        print(
            f"[seed] FOUT: bron-cache {source_root} bestaat niet. "
            "Start de dev-engine en installeer SoNaR-BERT eerst via de Model "
            "Manager; dat vult ~/.anonimiseer/huggingface/hub/.",
            file=sys.stderr,
        )
        return 1

    if SEED_DIR.exists():
        print(f"[seed] Ruim bestaande {SEED_DIR} op")
        shutil.rmtree(SEED_DIR)
    SEED_DIR.mkdir(parents=True, exist_ok=True)

    for repo in MODELS_TO_SEED:
        folder = _repo_to_folder(repo)
        src = source_root / folder
        dst = SEED_DIR / folder
        if not src.exists():
            print(
                f"[seed] FOUT: {src} bestaat niet. Download {repo} eerst in "
                f"de dev-cache ({source_root}).",
                file=sys.stderr,
            )
            return 2
        print(f"[seed] {repo}: {src} → {dst}")
        copied, skipped = _copy_filtered(src, dst)
        print(
            f"[seed]   gekopieerd: {copied / 1024 / 1024:.1f} MB, "
            f"overgeslagen: {skipped / 1024 / 1024:.1f} MB"
        )

    total = sum(f.stat().st_size for f in SEED_DIR.rglob("*") if f.is_file())
    print(f"[seed] Klaar. Seed-cache totaal: {total / 1024 / 1024:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
