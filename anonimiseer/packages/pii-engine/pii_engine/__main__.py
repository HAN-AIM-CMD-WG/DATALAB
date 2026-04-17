"""CLI-entry: ``python -m pii_engine`` of ``pii-engine``.

Start de FastAPI-app met uvicorn op de host/poort uit ``Settings``. Voor
ontwikkelwerk kun je ook direct ``uvicorn pii_engine.api:app --reload`` runnen.
"""

from __future__ import annotations

import logging

import uvicorn

from pii_engine.config import get_settings


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )
    settings = get_settings()
    uvicorn.run(
        "pii_engine.api:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    main()
