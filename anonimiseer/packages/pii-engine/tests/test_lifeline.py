"""De engine stopt zodra de app die hem startte verdwijnt.

Regressietest: na een crash of geforceerde stop van de desktop-app bleef de
engine als wees op zijn poort staan, waarna de app niet meer kon starten.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port: int = s.getsockname()[1]
        return port


def _start_engine(*, exit_with_parent: bool) -> subprocess.Popen[bytes]:
    env = {
        **os.environ,
        "PII_ENGINE_PORT": str(_free_port()),
        "PII_ENGINE_EXIT_WITH_PARENT": "true" if exit_with_parent else "false",
        "PII_ENGINE_ENABLE_SONAR": "false",
    }
    return subprocess.Popen(
        [sys.executable, "-m", "pii_engine"],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )


def test_engine_stops_when_stdin_closes() -> None:
    proc = _start_engine(exit_with_parent=True)
    try:
        time.sleep(1.5)
        assert proc.poll() is None, "engine stopte al voordat de pipe sloot"
        assert proc.stdin is not None
        proc.stdin.close()
        assert proc.wait(timeout=10) == 0
    finally:
        if proc.poll() is None:
            proc.kill()


def test_closed_stdin_is_ignored_without_the_setting() -> None:
    proc = _start_engine(exit_with_parent=False)
    try:
        assert proc.stdin is not None
        proc.stdin.close()
        time.sleep(1.5)
        assert proc.poll() is None, "zonder de instelling hoort een gesloten stdin niets te doen"
    finally:
        proc.kill()
        proc.wait(timeout=10)
