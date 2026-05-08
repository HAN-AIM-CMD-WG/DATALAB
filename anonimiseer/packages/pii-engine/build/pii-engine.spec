# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller-spec voor de pii-engine sidecar.

Doel:
    - one-folder bundle die door Electron wordt meegeleverd in extraResources
    - self-contained: Presidio + spaCy nl_core_news_lg + SoNaR-BERT + Nederlandse recognizers
      + documents/ + models/ zitten erin, geen internet nodig bij eerste start

Build lokaal:
    cd packages/pii-engine
    python -m pip install -e ".[bundle,sonar]"     # sonar optioneel, skippable op CI voor lichte build
    pyinstaller build/pii-engine.spec --noconfirm

Output:
    dist/pii-engine/          (folder met binary + dependencies)
      pii-engine              (executable, Unix)
      pii-engine.exe          (executable, Windows)
      _internal/              (libs, data, python stdlib)

Hidden imports + collect_* zijn nodig omdat Presidio/spaCy veel dynamisch
laden (yaml-configs, recognizer-classes via strings). PyInstaller's
statische analyse mist die anders.
"""
from __future__ import annotations

from pathlib import Path

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_submodules,
    copy_metadata,
)

SPEC_DIR = Path(SPECPATH).resolve()
PACKAGE_ROOT = SPEC_DIR.parent

# Verzamel alle sub-imports van libs die via entry-points of string-refs
# dynamisch geladen worden.
hiddenimports: list[str] = []
hiddenimports += collect_submodules("presidio_analyzer")
hiddenimports += collect_submodules("presidio_anonymizer")
hiddenimports += collect_submodules("pii_engine")

# spaCy heeft veel lazy sub-pipelines; collect_submodules pakt hun factories.
hiddenimports += collect_submodules("spacy")
hiddenimports += collect_submodules("thinc")
hiddenimports += collect_submodules("srsly")
hiddenimports += collect_submodules("blis")
hiddenimports += collect_submodules("preshed")
hiddenimports += collect_submodules("cymem")
hiddenimports += collect_submodules("murmurhash")
hiddenimports += collect_submodules("catalogue")
hiddenimports += collect_submodules("wasabi")
hiddenimports += collect_submodules("nl_core_news_lg")

# PyMuPDF levert de `fitz`-module via shim.
hiddenimports += ["fitz"]

# Pydantic-settings laadt sources via entry-point, anders valt `.env` om.
hiddenimports += collect_submodules("pydantic_settings")

# SoNaR-BERT via transformers + torch. Bewust meegebundeld voor out-of-the-box
# maximale Nederlandse NER-recall. Ze worden pas lazy geladen als de gebruiker
# daadwerkelijk SoNaR activeert (standaard aan), dus engine-startup blijft snel.
hiddenimports += collect_submodules("transformers")
hiddenimports += collect_submodules("tokenizers")
hiddenimports += collect_submodules("safetensors")
hiddenimports += collect_submodules("torch")
hiddenimports += collect_submodules("huggingface_hub")

# Verzamel data-files: yaml/json/html die Presidio en spaCy-modellen nodig hebben.
datas: list[tuple[str, str]] = []
datas += collect_data_files("presidio_analyzer")
datas += collect_data_files("presidio_anonymizer")
datas += collect_data_files("spacy")
datas += collect_data_files("nl_core_news_lg", include_py_files=True)

# Onze eigen static-files (playground.html) + recognizer-config.
datas += collect_data_files("pii_engine")

# Metadata (version-files) zodat spaCy's `spacy.util.load_model_from_package`
# de geinstalleerde modellen kan detecteren via importlib.metadata.
datas += copy_metadata("spacy")
datas += copy_metadata("nl_core_news_lg")
datas += copy_metadata("presidio-analyzer")
datas += copy_metadata("presidio-anonymizer")
# Transformers en torch lezen versie via importlib.metadata; zonder metadata
# faalt pipeline-init met een "package not installed"-error.
datas += copy_metadata("transformers")
datas += copy_metadata("tokenizers")
datas += copy_metadata("safetensors")
datas += copy_metadata("torch")
datas += copy_metadata("huggingface_hub")

# Transformers heeft tientallen yaml/json/tokenizer-configs in zijn package die
# dynamisch per modelklasse worden geladen.
datas += collect_data_files("transformers")
datas += collect_data_files("tokenizers")
# Torch brengt eigen CPU-/Metal-plugins en ATen-configs mee als data-files.
datas += collect_data_files("torch", include_py_files=False)

# Uvicorn heeft zijn eigen protocol-implementaties als entry-points.
hiddenimports += collect_submodules("uvicorn")

block_cipher = None


a = Analysis(
    [str(PACKAGE_ROOT / "pii_engine" / "__main__.py")],
    pathex=[str(PACKAGE_ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
            excludes=[
                # Houd het bundle-formaat klein: geen tests, geen notebook-deps.
                "pytest",
                "IPython",
                "jupyter",
                "notebook",
                # Tensorflow/jax nooit nodig — transformers kan ermee werken maar
                # wij draaien alleen de torch-backend; dit scheelt honderden MB.
                "tensorflow",
                "jax",
                "jaxlib",
                "flax",
            ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    # noarchive=True: pak alle .py-bestanden los uit de PYZ-archive naar het
    # bestandssysteem. Presidio en soortgelijke libs doen
    # `Path(__file__).parent / "../conf/default_recognizers.yaml"`; dat werkt
    # alleen als de module een echte directory op disk is, niet een PYZ-entry.
    # Iets grotere bundle maar beduidend robuuster — standaard voor libs met
    # data-files naast code.
    noarchive=True,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="pii-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX comprimeert, maar macOS Gatekeeper en Windows SmartScreen
                 # hebben er moeite mee. Voor een ongesigneerde pilot-build laten
                 # we het uit.
    console=True,  # Engine is een CLI-server. Electron start hem als child
                   # proces en leest stdout/stderr voor debug.
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="pii-engine",
)
