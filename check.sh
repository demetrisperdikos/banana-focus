#!/usr/bin/env bash
#
# check.sh — Banana Focus (Pomodoro Focus Timer)
# -------------------------------------------------------------
# Installs what it needs, runs the whole test suite against the real app,
# boots the site, fetches its main page over HTTP and expects 200.
# Exits 0 only if every step worked.
#
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/pomodoro-timer"
PORT="${PORT:-8123}"
SERVER_PID=""
FAILED=0

say() { printf '%s\n' "$*"; }
step() { say ""; say "== $* =="; }

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------- install
step "Install / verify toolchain"
for bin in node python3 curl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    say "MISSING required tool: $bin"; FAILED=1
  else
    say "found $bin ($($bin --version 2>&1 | head -1))"
  fi
done

# Browser test deps (puppeteer-core) — install only if absent.
if [ ! -d "$HERE/qa/node_modules/puppeteer-core" ]; then
  say "installing qa deps (puppeteer-core)..."
  ( cd "$HERE/qa" && npm install --no-audit --no-fund puppeteer-core@23 >/dev/null 2>&1 ) \
    || { say "npm install failed"; FAILED=1; }
else
  say "qa deps already present"
fi

CHROME=""
for c in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome; do
  [ -x "$c" ] && CHROME="$c" && break
done
if [ -n "$CHROME" ]; then say "found browser: $CHROME"; else say "no chromium: browser tests will be skipped"; fi

# ---------------------------------------------------------------- tests
step "Static/code safety checks (qa/check-code.js)"
if [ -f "$HERE/qa/check-code.js" ]; then
  if node "$HERE/qa/check-code.js" "$APP"; then say "code check: PASS"; else say "code check: FAIL"; FAILED=1; fi
else
  say "no check-code.js (skipped)"
fi

step "Unit tests (tests/core.test.js)"
if [ -f "$HERE/tests/core.test.js" ]; then
  if ( cd "$HERE" && node tests/core.test.js ); then say "unit tests: PASS"; else say "unit tests: FAIL"; FAILED=1; fi
else
  say "no core.test.js (skipped)"
fi

if [ -n "$CHROME" ] && [ -f "$HERE/tests/browser-e2e.js" ]; then
  step "Real-browser end-to-end (tests/browser-e2e.js)"
  if ( cd "$HERE" && node tests/browser-e2e.js ); then say "e2e: PASS"; else say "e2e: FAIL"; FAILED=1; fi

  step "Real-browser lifecycle / reward loop (tests/browser-lifecycle.js)"
  if ( cd "$HERE" && node tests/browser-lifecycle.js ); then say "lifecycle: PASS"; else say "lifecycle: FAIL"; FAILED=1; fi

  step "Real-browser media + responsive (tests/browser-media.js)"
  if ( cd "$HERE" && node tests/browser-media.js ); then say "media/responsive: PASS"; else say "media/responsive: FAIL"; FAILED=1; fi
fi

# ---------------------------------------------------------------- serve
step "Serve the site and fetch the main page"
( cd "$APP" && python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/pomodoro-serve.log 2>&1 ) &
SERVER_PID=$!

OK=0
for i in $(seq 1 40); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/index.html" 2>/dev/null; then OK=1; break; fi
  sleep 0.25
done

if [ "$OK" -ne 1 ]; then
  say "server did not come up"; cat /tmp/pomodoro-serve.log 2>/dev/null; FAILED=1
else
  STATUS=$(curl -s -o /tmp/pomodoro-index.html -w '%{http_code}' "http://127.0.0.1:$PORT/index.html")
  say "GET /index.html -> HTTP $STATUS"
  if [ "$STATUS" = "200" ]; then
    if grep -q "id=\"timer\"" /tmp/pomodoro-index.html; then say "served page contains the timer"; else say "served page missing timer"; FAILED=1; fi
    if grep -q "app.js" /tmp/pomodoro-index.html; then say "served page loads app.js"; else say "served page does not load app.js"; FAILED=1; fi
    # Assets requested by the page must also be served.
    for asset in css/style.css js/app.js js/timer.js js/taskManager.js js/audio.js assets/sounds/alarm.mp3; do
      CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/$asset")
      if [ "$CODE" = "200" ]; then say "asset ok: $asset"; else say "asset MISSING ($CODE): $asset"; FAILED=1; fi
    done
  else
    say "expected 200 for index.html"; FAILED=1
  fi
fi

cleanup
SERVER_PID=""

say ""
if [ "$FAILED" -eq 0 ]; then
  say "ALL CHECKS PASSED"
  exit 0
fi
say "CHECKS FAILED"
exit 1
