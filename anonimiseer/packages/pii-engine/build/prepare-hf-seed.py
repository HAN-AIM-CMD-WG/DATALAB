"""Download the models the installer ships into ``build/hf-seed/hub/``.

electron-builder copies that folder to ``<App>/resources/hf-seed``; on first
start ``engineProcess.ts`` copies it into ``~/.anonimiseer/huggingface/hub/``,
where the engine loads models from. Only models whose licence allows
redistribution belong here: SoNaR-BERT has no licence and is a download in the
Model Manager instead.

Each model is pinned to a commit, so every build ships the version that was
measured. ``refs/main`` is written by hand: the engine loads ``main`` from the
local cache only, and a download by commit does not record that ref.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

SEED_DIR = Path(__file__).resolve().parent / "hf-seed" / "hub"

# (repo, commit, files the engine loads)
MODELS_TO_SEED = [
    (
        "bardsai/eu-pii-anonimization-multilang-v3",  # Apache-2.0
        "091984b5fbce4c161abc4776ed0f4e3206e1b374",
        ["config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json"],
    ),
]


def _materialise(repo_dir: Path) -> None:
    """Replace the snapshot's symlinks into ``blobs/`` with the files themselves.

    Windows packs these symlinks as invalid directories, which breaks the
    installer; a cache with real files in the snapshot loads the same way.
    """
    for link in (repo_dir / "snapshots").rglob("*"):
        if link.is_symlink():
            target = link.resolve()
            link.unlink()
            os.replace(target, link)
    shutil.rmtree(repo_dir / "blobs", ignore_errors=True)


def main() -> int:
    # The xet transfer keeps its own cache in ~/.cache/huggingface, which is not
    # writable on every machine; a plain HTTPS download needs no cache.
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    from huggingface_hub import snapshot_download

    if SEED_DIR.exists():
        shutil.rmtree(SEED_DIR)
    SEED_DIR.mkdir(parents=True)
    for repo, commit, files in MODELS_TO_SEED:
        print(f"[seed] {repo}@{commit[:12]}")
        snapshot_download(repo, revision=commit, cache_dir=SEED_DIR, allow_patterns=files)
        repo_dir = SEED_DIR / f"models--{repo.replace('/', '--')}"
        _materialise(repo_dir)
        (repo_dir / "refs").mkdir(parents=True, exist_ok=True)
        (repo_dir / "refs" / "main").write_text(commit, encoding="utf-8")
    for leftover in (".locks", "datasets--"):
        for path in SEED_DIR.glob(f"{leftover}*"):
            shutil.rmtree(path, ignore_errors=True)
    total = sum(f.stat().st_size for f in SEED_DIR.rglob("*") if f.is_file() and not f.is_symlink())
    print(f"[seed] {total / 1024 / 1024:.0f} MB in {SEED_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
