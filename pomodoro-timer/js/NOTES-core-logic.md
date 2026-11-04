# Core Logic - timer.js + taskManager.js

Owner: Maya Patel (Junior Developer), 2026-11-03
Part of: Plan Pomodoro focus timer

## What I built (my part only)
- js/timer.js - countdown, start/pause/reset/skip, 25/5 auto-switching, session counting, serialize/restore.
- js/taskManager.js - task CRUD, localStorage persistence, All/Active/Completed filters, XSS-safe rendering.
- tests/core.test.js - 36 self-checks, all passing: cd projects/job-22 && node tests/core.test.js

I did not touch index.html, css/, js/app.js or js/audio.js - those belong to Daniel and Elena.

---

## FOR DANIEL - wiring (app shell / integration)

### 1. Script order in index.html
Both modules are classic scripts with no dependencies; load them BEFORE app.js:

    <script src="js/timer.js"></script>
    <script src="js/taskManager.js"></script>
    <script src="js/audio.js"></script>
    <script src="js/app.js"></script>

They attach as window.PomodoroTimer and window.TaskManager. No modules, no build step.

### 2. Timer
    var timer = new PomodoroTimer({
      onTick: function (state) {
        document.getElementById('timer').textContent = state.display;   // '25:00'
        document.getElementById('mode-badge').textContent = state.mode === 'focus' ? 'Focus' : 'Break';
        document.documentElement.classList.toggle('mode-break', state.mode === 'break');
        document.getElementById('progress-ring').style.setProperty('--progress', state.progress);
        document.getElementById('start-icon').style.display = state.isRunning ? 'none' : '';
        document.getElementById('pause-icon').style.display = state.isRunning ? '' : 'none';
      },
      onSessionEnd: function (e) {
        if (typeof audio !== 'undefined') { audio.playAlarm(); }   // end-of-session chime
        if (e.completedFocusSessions > 0 && e.completedFocusSessions % 4 === 0) { /* confetti */ }
      }
    });

    timer.toggle();   // start-pause button
    timer.reset();    // reset button
    timer.skip();     // skip button

UI ids my callbacks expect (all already in index.html):
#timer, #mode-badge, #progress-ring, #start-icon, #pause-icon.

state from onTick / getState(): mode, timeLeft, duration, isRunning, display, progress, completedFocusSessions.

### 3. Persisting the timer
- save: localStorage.setItem('pomodoro_timer', JSON.stringify(timer.serialize()))
- load on boot, before wiring UI: timer.restore(saved)
restore() always comes back paused and clamps junk values, so a bad save cannot break the page.

### 4. Task list
- new TaskManager({ onChange: fn }) then tasks.loadTasks()  -> reads localStorage key 'pomodoro_tasks'
- render each item with TaskManager.renderTask(task, { onToggle, onDelete }, doc).
  It builds the li with createElement + textContent ONLY, so task text can never be executed as
  HTML (this is the plan's XSS rule; there is a test for it).
- emitted nodes: input[type=checkbox], span.task-text, button.task-delete; li classes: task-item, completed.
  Elena's components.css can style those class names.
- filters: tasks.setFilter(btn.dataset.filter) on the .filter-btn[data-filter] buttons (all/active/completed)
- footer: tasks.clearCompleted() on #clear-completed-btn
- add: tasks.addTask(value) from #add-task-btn click and the input's Enter keydown

### 5. Edge cases already handled (no guard needed in app.js)
- double-clicking Start never creates two intervals;
- pause / reset / session-end all clear the interval (no leaks after many cycles);
- a SKIPPED focus session does not count toward the 4-session reward;
- corrupt / missing / blocked localStorage degrades to working in memory;
- junk or hostile entries in a saved task array are filtered/clamped on load;
- ids are unique forever, even across deletes and reloads.

---

## FOR ZARA (QA) - the hooks to test
- Timer: start() pause() toggle() reset() skip() switchMode() serialize() restore() destroy(), getState(), PomodoroTimer.formatTime()
- Tasks: addTask() toggleTask() deleteTask() clearCompleted() setFilter() getVisibleTasks() getCounts() loadTasks() saveTasks()
- Fast testing: new PomodoroTimer({ durations: { focus: 3, break: 2 } }) gives a 3-second focus session.
- My own suite: cd projects/job-22 && node tests/core.test.js (36 checks, all green).
