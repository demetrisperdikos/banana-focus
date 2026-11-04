# Banana Focus - Pomodoro Focus Timer

A single-page, zero-dependency Pomodoro timer with a persistent task list.
Runs entirely in the browser; nothing to install, no account, no server.

## Features

- **25/5 cycles** - a 25-minute focus session rolls straight into a 5-minute
  break, then back to focus.
- **Start / Pause / Reset / Skip** controls, with a live countdown and a
  circular progress ring.
- **Sound** - a warm chime at the end of each session and a soft tick on button
  presses (both bundled locally as MP3, with WAV fallbacks). Audio unlocks on
  your first click, respecting browser autoplay rules. There is a mute toggle.
- **Task list** - add tasks (button or Enter), check them off, delete them,
  filter by All / Active / Completed, and clear completed in one tap.
- **Everything saved** - tasks and timer state live in localStorage, so a
  refresh keeps your list and your session.
- **Reward loop** - a small CSS-only confetti burst every 4 completed focus
  sessions.
- **Mobile-first** and accessible: large tap targets, ARIA labels,
  keyboard-navigable, honours prefers-reduced-motion and dark mode.

## Run it locally

No build step. Any static server works:

    cd pomodoro-timer
    python3 -m http.server 8000
    # open http://localhost:8000

## Layout

    pomodoro-timer/
      index.html          # structure
      css/
        style.css         # variables, reset, typography, responsive base
        components.css    # timer, buttons, task list, ring, confetti
      js/
        timer.js          # countdown, modes, serialize/restore
        taskManager.js    # task CRUD, filters, localStorage (XSS-safe rendering)
        audio.js          # sound management + autoplay unlock
        app.js            # controller: wires UI to the modules
      assets/sounds/      # alarm + click (mp3 + wav fallback)

## Safety notes

- Task text is rendered with createElement + textContent only - user input can
  never be injected as HTML (verified with hostile img/onerror and script
  payloads in a real browser).
- No external CDNs, no eval, no inline event handlers.
- setInterval ids are always cleared on pause/reset/complete (no leaks).

## Tests

From projects/job-22:

    ./check.sh   # full gate: static checks, unit + real-browser tests, serve + HTTP 200

- tests/core.test.js - 36 unit checks of the timer and task logic.
- tests/browser-e2e.js - 20 real-Chromium checks of the wired UI.
- tests/browser-lifecycle.js - 20 checks of the focus->break cycle, skip,
  reset, sound and the 4-session reward.
- tests/browser-media.js - 10 checks that the real audio assets decode and the
  layout holds at 320 / 390 / 1920 px.

## License

Internal willySillyAI build.
