#!/usr/bin/env bash
# Crash test for a packaged build: start the app, kill it with SIGKILL and
# check that the engine goes down with it and a restart succeeds.
#
#   bash e2e/crashtest.sh release/mac-arm64/Anonimiseer.app/Contents/MacOS/Anonimiseer
set -u
APP_BIN="${1:?path to the packaged app binary}"
TMP="$(dirname "$0")/.tmp"
UD="$TMP/userdata-crashtest"
mkdir -p "$TMP"

wait_healthy() {  # $1 = log file
  for _ in $(seq 1 120); do
    grep -q "engine is gezond" "$1" 2>/dev/null && return 0
    grep -qE "stopte direct|al in gebruik|niet de engine van deze app" "$1" 2>/dev/null && return 1
    sleep 1
  done
  return 1
}

port_free() { ! lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; }

port_free || { echo "FAIL: port 8765 is already in use before the test"; exit 1; }

"$APP_BIN" --user-data-dir="$UD" > "$TMP/crash-1.log" 2>&1 &
APP1=$!
wait_healthy "$TMP/crash-1.log" || { echo "FAIL: first start"; kill "$APP1" 2>/dev/null; exit 1; }
echo "PASS  first start, handshake ok"

kill -9 "$APP1"
for _ in $(seq 1 20); do port_free && break; sleep 0.5; done
if port_free; then
  echo "PASS  engine stopped after the app was killed"
else
  echo "FAIL: engine kept running as an orphan"
  pkill -f "Resources/pii-engine/pii-engine"
  exit 1
fi

"$APP_BIN" --user-data-dir="$UD" > "$TMP/crash-2.log" 2>&1 &
APP2=$!
if wait_healthy "$TMP/crash-2.log"; then RESULT=0; echo "PASS  restart after the crash"; else RESULT=1; echo "FAIL: restart"; fi
kill -TERM "$APP2" 2>/dev/null
for _ in $(seq 1 20); do port_free && break; sleep 0.5; done
port_free || pkill -f "Resources/pii-engine/pii-engine"
exit $RESULT
