"""CLI-entry: ``python -m pii_engine`` of ``pii-engine``.

Start de FastAPI-app met uvicorn op de host/poort uit ``Settings``. Voor
ontwikkelwerk kun je ook direct ``uvicorn pii_engine.api:app --reload`` runnen.
"""

from __future__ import annotations

import logging
import os
import sys
import threading

import uvicorn

from pii_engine.config import get_settings

logger = logging.getLogger(__name__)


def _exit_when_stdin_closes() -> None:
    """Stop het proces zodra de pipe op stdin sluit.

    Een pipe sluit pas als het proces aan de andere kant weg is, ook bij een
    crash of een geforceerde stop waarbij dat proces zelf niets meer kan
    opruimen. Daarom is dit betrouwbaarder dan wachten op een stopsignaal.
    """

    def watch() -> None:
        try:
            while sys.stdin.buffer.read(1024):
                pass
        except (OSError, ValueError):
            pass
        logger.info("stdin gesloten: de app is weg, engine stopt.")
        os._exit(0)

    threading.Thread(target=watch, name="parent-lifeline", daemon=True).start()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )
    settings = get_settings()
    if settings.exit_with_parent:
        _exit_when_stdin_closes()
    uvicorn.run(
        "pii_engine.api:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    main()
