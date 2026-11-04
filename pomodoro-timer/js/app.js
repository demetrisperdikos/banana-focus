/*
 * app.js — controller for Banana Focus (Pomodoro Timer)
 * -------------------------------------------------------
 * Wires the UI (index.html) to the two logic modules:
 *   window.PomodoroTimer  (timer.js)
 *   window.TaskManager    (taskManager.js)
 *   window.PomodoroAudio  (audio.js)
 *
 * Responsibilities: DOM updates, event binding, progress ring,
 * timer-state persistence, theming (focus/break), the 4-session
 * reward loop, and unlocking audio on the first user gesture.
 */
(function () {
  'use strict';

  var TIMER_KEY = 'pomodoro_timer';
  var SESSIONS_PER_REWARD = 4;
  var RING_RADIUS = 90;
  var RING_CIRC = 2 * Math.PI * RING_RADIUS;

  var $ = function (id) { return document.getElementById(id); };

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
  }

  /* ------------------------------------------------------------- */

  var els = {
    timer: $('timer'),
    badge: $('mode-badge'),
    ring: $('progress-ring'),
    startPause: $('start-pause-btn'),
    startIcon: $('start-icon'),
    pauseIcon: $('pause-icon'),
    reset: $('reset-btn'),
    skip: $('skip-btn'),
    mute: $('mute-btn'),
    muteIcon: $('mute-icon'),
    unmuteIcon: $('unmute-icon'),
    taskInput: $('task-input'),
    addTask: $('add-task-btn'),
    taskList: $('task-list'),
    clearCompleted: $('clear-completed-btn'),
    filterBtns: Array.prototype.slice.call(document.querySelectorAll('.filter-btn'))
  };

  /* ---- progress ring (SVG built once to match components.css) ---- */

  function buildRing() {
    if (!els.ring || els.ring.querySelector('svg')) { return; }
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('aria-hidden', 'true');

    var bg = document.createElementNS(NS, 'circle');
    bg.setAttribute('class', 'progress-ring__bg');
    bg.setAttribute('cx', '100');
    bg.setAttribute('cy', '100');
    bg.setAttribute('r', String(RING_RADIUS));

    var fill = document.createElementNS(NS, 'circle');
    fill.setAttribute('class', 'progress-ring__fill focus');
    fill.setAttribute('cx', '100');
    fill.setAttribute('cy', '100');
    fill.setAttribute('r', String(RING_RADIUS));
    fill.setAttribute('transform', 'rotate(-90 100 100)');
    fill.setAttribute('stroke-dasharray', String(RING_CIRC));
    fill.setAttribute('stroke-dashoffset', String(RING_CIRC));

    svg.appendChild(bg);
    svg.appendChild(fill);
    els.ring.appendChild(svg);
    els.ringFill = fill;
  }

  function setProgress(progress) {
    if (!els.ringFill) { return; }
    var p = Math.max(0, Math.min(1, Number(progress) || 0));
    els.ringFill.setAttribute('stroke-dashoffset', String(RING_CIRC * (1 - p)));
  }

  function setRingMode(mode) {
    if (!els.ringFill) { return; }
    els.ringFill.setAttribute('class', 'progress-ring__fill ' + (mode === 'break' ? 'break' : 'focus'));
  }

  /* ---- audio ---- */

  var audio = (typeof PomodoroAudio === 'function') ? new PomodoroAudio() : null;

  function unlockAudio() {
    if (audio && typeof audio.unlock === 'function') { audio.unlock(); }
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  }
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('touchstart', unlockAudio);

  /* ---- theming ---- */

  function applyMode(mode) {
    var isBreak = mode === 'break';
    document.body.classList.toggle('mode-break', isBreak);
    document.body.classList.toggle('mode-focus', !isBreak);
    if (els.badge) {
      els.badge.textContent = isBreak ? 'Break' : 'Focus';
      els.badge.classList.toggle('break', isBreak);
      els.badge.classList.toggle('focus', !isBreak);
    }
    setRingMode(mode);
  }

  /* ---- timer ---- */

  var timer = new PomodoroTimer({
    durations: { focus: 25 * 60, break: 5 * 60 },
    onTick: function (state) {
      if (els.timer) { els.timer.textContent = state.display; }
      setProgress(state.progress);
      els.startIcon.style.display = state.isRunning ? 'none' : '';
      els.pauseIcon.style.display = state.isRunning ? '' : 'none';
      els.startPause.setAttribute('aria-label', state.isRunning ? 'Pause timer' : 'Start timer');
      els.startPause.setAttribute('aria-pressed', state.isRunning ? 'true' : 'false');
      saveTimerState();
    },
    onModeChange: function (mode) {
      applyMode(mode);
    },
    onSessionEnd: function (info) {
      var skipped = info && info.skipped;
      // Natural end: chime, reward, and roll straight into the next mode.
      // Manual skip: switch mode but stay paused so the user is in control.
      if (!skipped && audio) { audio.playAlarm(); }
      if (info && info.mode === 'focus' && !skipped) {
        maybeCelebrate(info.completedFocusSessions);
      }
      if (!skipped) { timer.start(); }
    }
  });

  function saveTimerState() {
    safeSet(TIMER_KEY, JSON.stringify(timer.serialize()));
  }

  function restoreTimerState() {
    var raw = safeGet(TIMER_KEY);
    if (!raw) { return; }
    try {
      timer.restore(JSON.parse(raw));
    } catch (e) { /* corrupt: keep defaults */ }
  }

  /* ---- tasks ---- */

  var taskManager = new TaskManager({
    storage: (function () { try { return window.localStorage; } catch (e) { return null; } })(),
    onChange: function () { renderTasks(); renderCounts(); }
  });

  function renderTasks() {
    if (!els.taskList) { return; }
    while (els.taskList.firstChild) { els.taskList.removeChild(els.taskList.firstChild); }
    var visible = taskManager.getVisibleTasks();
    visible.forEach(function (task) {
      els.taskList.appendChild(TaskManager.renderTask(task, {
        onToggle: function (id) { taskManager.toggleTask(id); },
        onDelete: function (id) { taskManager.deleteTask(id); }
      }));
    });
  }

  function renderCounts() {
    // Reflect the active filter in the tabs.
    els.filterBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === taskManager.filter);
    });
  }

  function addTaskFromInput() {
    if (!els.taskInput) { return; }
    var added = taskManager.addTask(els.taskInput.value);
    if (added) {
      els.taskInput.value = '';
      if (audio) { audio.playClick(); }
    }
    els.taskInput.focus();
  }

  /* ---- reward loop (CSS-only confetti) ---- */

  function maybeCelebrate(completedFocusSessions) {
    if (!completedFocusSessions || completedFocusSessions % SESSIONS_PER_REWARD !== 0) { return; }
    var layer = document.createElement('div');
    layer.className = 'confetti-layer';
    layer.setAttribute('aria-hidden', 'true');
    var colors = ['#f7e94e', '#6bb53e', '#c7a800', '#d45d48', '#2e8b57'];
    for (var i = 0; i < 60; i++) {
      var bit = document.createElement('span');
      bit.className = 'confetti-bit';
      bit.style.left = (Math.random() * 100) + '%';
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = (Math.random() * 0.6) + 's';
      bit.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
      layer.appendChild(bit);
    }
    document.body.appendChild(layer);
    window.setTimeout(function () {
      if (layer.parentNode) { layer.parentNode.removeChild(layer); }
    }, 3200);
  }

  /* ---- events ---- */

  function bindEvents() {
    if (els.startPause) {
      els.startPause.addEventListener('click', function () {
        if (audio) { audio.playClick(); }
        timer.toggle();
      });
    }
    if (els.reset) {
      els.reset.addEventListener('click', function () {
        if (audio) { audio.playClick(); }
        timer.reset();
      });
    }
    if (els.skip) {
      els.skip.addEventListener('click', function () {
        if (audio) { audio.playClick(); }
        timer.skip();
      });
    }
    if (els.mute) {
      els.mute.addEventListener('click', function () {
        if (!audio) { return; }
        var muted = audio.toggleMute();
        els.unmuteIcon.style.display = muted ? 'none' : '';
        els.muteIcon.style.display = muted ? '' : 'none';
        els.mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
        els.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
      });
    }
    if (els.addTask) { els.addTask.addEventListener('click', addTaskFromInput); }
    if (els.taskInput) {
      els.taskInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); addTaskFromInput(); }
      });
    }
    els.filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        taskManager.setFilter(btn.getAttribute('data-filter'));
      });
    });
    if (els.clearCompleted) {
      els.clearCompleted.addEventListener('click', function () {
        taskManager.clearCompleted();
      });
    }
  }

  /* ---- boot ---- */

  function init() {
    buildRing();
    bindEvents();
    taskManager.loadTasks();
    restoreTimerState();
    applyMode(timer.mode);
    var st = timer.getState();
    if (els.timer) { els.timer.textContent = st.display; }
    setProgress(st.progress);
    els.startIcon.style.display = 'none';   // restored paused -> show play
    els.pauseIcon.style.display = 'none';
    els.startIcon.style.display = '';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.BananaFocus = { timer: timer, taskManager: taskManager, audio: audio };
})();
