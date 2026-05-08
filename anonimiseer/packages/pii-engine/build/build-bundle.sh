#!/usr/bin/env bash
# Build de pii-engine als PyInstaller one-folder bundle.
#
# Gebruikt een verse venv onder ./build/.venv om host-Python schoon te houden.
# Output: packages/pii-engine/build/dist/pii-engine/ (folder met pii-engine binary).
#
# Gebruik:
#   ./build/build-bundle.sh          # normaal
#   CLEAN=1 ./build/build-bundle.sh  # venv opnieuw aanmaken
#
# Vereist: Python 3.11+, 1-2 GB vrije schijfruimte tijdens de build.

set -euo pipefail

cd "$(dirname "$0")/.."
ENGINE_ROOT="$(pwd)"
BUILD_DIR="${ENGINE_ROOT}/build"
VENV_DIR="${BUILD_DIR}/.venv"
DIST_DIR="${BUILD_DIR}/dist"
SPEC_FILE="${BUILD_DIR}/pii-engine.spec"

if [[ "${CLEAN:-0}" == "1" ]]; then
    echo "[build] CLEAN=1, verwijder ${VENV_DIR} en ${DIST_DIR}"
    rm -rf "${VENV_DIR}" "${DIST_DIR}" "${BUILD_DIR}/build"
fi

# Kies een stabiele Python-versie: Presidio en spaCy lopen soms achter op
# nieuwe Python-releases (geen wheels voor bv. 3.14). Voorkeur: 3.11 > 3.12 > 3.13.
# Via PYTHON-env kan de CI een vaste versie pinnen.
if [[ -n "${PYTHON:-}" ]]; then
    PYTHON_BIN="${PYTHON}"
elif command -v python3.11 >/dev/null 2>&1; then
    PYTHON_BIN="python3.11"
elif command -v python3.12 >/dev/null 2>&1; then
    PYTHON_BIN="python3.12"
else
    PYTHON_BIN="python3"
fi
echo "[build] Gebruik Python: $(${PYTHON_BIN} --version) (${PYTHON_BIN})"

if [[ ! -d "${VENV_DIR}" ]]; then
    echo "[build] Maak venv in ${VENV_DIR}"
    "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

# shellcheck source=/dev/null
source "${VENV_DIR}/bin/activate"

echo "[build] Upgrade pip + installeer pii-engine[bundle,sonar]"
python -m pip install --upgrade pip wheel setuptools
# editable-install zodat onze lokale wijzigingen meegenomen worden.
# [sonar] brengt torch + transformers mee zodat SoNaR-BERT NER out-of-the-box
# werkt in de gebundelde app.
python -m pip install -e ".[bundle,sonar]"

echo "[build] Verifieer dat de engine importeerbaar is"
python -c "from pii_engine.api import app; print('[build] app OK:', app.title)"

echo "[build] Run PyInstaller (spec: ${SPEC_FILE})"
cd "${BUILD_DIR}"
pyinstaller "${SPEC_FILE}" --noconfirm --clean

echo "[build] Smoke-test de gebundelde binary"
BIN="${DIST_DIR}/pii-engine/pii-engine"
if [[ ! -x "${BIN}" ]]; then
    echo "[build] FOUT: ${BIN} niet gevonden of niet executable" >&2
    exit 1
fi

# Start de engine, wacht op /health, kill hem weer.
"${BIN}" &
ENGINE_PID=$!
trap 'kill "${ENGINE_PID}" 2>/dev/null || true' EXIT

for _ in $(seq 1 90); do
    if curl -fsS http://127.0.0.1:8765/health >/dev/null 2>&1; then
        echo "[build] Bundle health-check OK"
        kill "${ENGINE_PID}" 2>/dev/null || true
        wait "${ENGINE_PID}" 2>/dev/null || true
        trap - EXIT
        echo "[build] KLAAR. Output: ${DIST_DIR}/pii-engine/"
        du -sh "${DIST_DIR}/pii-engine" 2>/dev/null || true
        exit 0
    fi
    sleep 1
done

echo "[build] FOUT: engine kwam niet op binnen 90 s" >&2
kill "${ENGINE_PID}" 2>/dev/null || true
exit 1
