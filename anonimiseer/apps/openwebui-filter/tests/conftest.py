"""Pytest-config: voeg het filter-bestand toe aan sys.path zonder package-install."""

from __future__ import annotations

import sys
from pathlib import Path

# Filter is een los Python-bestand (niet als package geinstalleerd), dus
# plaatsen we de parent-map op sys.path zodat `import nl_pii_filter` werkt.
FILTER_DIR = Path(__file__).resolve().parent.parent
if str(FILTER_DIR) not in sys.path:
    sys.path.insert(0, str(FILTER_DIR))
