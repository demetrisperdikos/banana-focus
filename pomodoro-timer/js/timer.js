/*
 * timer.js — Pomodoro timer core logic (owner: Maya Patel)
 * ------------------------------------------------------------------
 * Pure logic module: no DOM lookups, no globals it depends on.
 * The app shell (app.js) wires callbacks to the UI.
 *
 * Loaded as a classic script in the browser  -> window.PomodoroTimer
 * Loadable in Node for tests                -> module.exports
 *
 * API
 *   var t = new PomodoroTimer({ durations:{focus:1500, break:300}, onTick, onModeChange, onSessionEnd });
 *   t.start(); t.pause(); t.reset(); t.skip(); t.switchMode('break');
 *   t.getState(); t.serialize(); t.restore(data); t.destroy();
 *   PomodoroTimer.formatTime(seconds) -> 'MM:SS'
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PomodoroTimer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    focus: 25 * 60, // 25 minutes
    break: 5 * 60   // 5 minutes
  };

  function noop() {}

  function formatTime(totalSeconds) {
    var s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return (m < 10 ? '0' + m : String(m)) + ':' + (sec < 10 ? '0' + sec : String(sec));
  }

  /**
   * @param {Object} [options]
   *   durations {Object}        seconds per mode, default 25min focus / 5min break
   *   mode {'focus'|'break'}    starting mode
   *   tickMs {Number}           polling interval, default 1000
   *   onTick {Function}         (state) => void   on every visible change
   *   onModeChange {Function}   (mode, state) => void
   *   onSessionEnd {Function}   ({mode, next, skipped, completedFocusSessions}) => void
   *   setInterval/clearInterval/now  injectable for tests (defaults to the platform)
   */
  function PomodoroTimer(options) {
    options = options || {};

    this.durations = {
      focus: DEFAULTS.focus,
      break: DEFAULTS.break
    };
    var custom = options.durations || {};
    for (var k in custom) {
      if (Object.prototype.hasOwnProperty.call(custom, k) && custom[k] > 0) {
        this.durations[k] = Math.floor(custom[k]);
      }
    }

    this.mode = options.mode === 'break' ? 'break' : 'focus';
    this.timeLeft = this.durationFor(this.mode);
    this.isRunning = false;
    this.intervalId = null;
    this.completedFocusSessions = 0;

    this.tickMs = options.tickMs > 0 ? options.tickMs : 1000;
    this._endTime = 0;

    // Injectable platform hooks keep this module unit-testable without a browser.
    // Wrap the host timers so calling them as methods never rebinds `this`
    // (native setInterval throws "Illegal invocation" if `this` is not window).
    this._setInterval = options.setInterval || (typeof setInterval !== 'undefined'
      ? function (fn, ms) { return setInterval(fn, ms); } : null);
    this._clearInterval = options.clearInterval || (typeof clearInterval !== 'undefined'
      ? function (id) { return clearInterval(id); } : null);
    this._now = options.now || (typeof Date !== 'undefined' ? function () { return Date.now(); } : function () { return 0; });

    this.onTick = options.onTick || noop;
    this.onModeChange = options.onModeChange || noop;
    this.onSessionEnd = options.onSessionEnd || noop;

    var self = this;
    this._tick = function () { self._onInterval(); };
  }

  PomodoroTimer.formatTime = formatTime;

  PomodoroTimer.prototype.durationFor = function (mode) {
    return this.durations[mode] || this.durations.focus;
  };

  /** Snapshot for the UI. progress goes 0 -> 1 as the session elapses. */
  PomodoroTimer.prototype.getState = function () {
    var duration = this.durationFor(this.mode);
    var progress = duration > 0 ? (duration - this.timeLeft) / duration : 0;
    if (progress < 0) { progress = 0; }
    if (progress > 1) { progress = 1; }
    return {
      mode: this.mode,
      timeLeft: this.timeLeft,
      duration: duration,
      isRunning: this.isRunning,
      display: formatTime(this.timeLeft),
      progress: progress,
      completedFocusSessions: this.completedFocusSessions
    };
  };

  PomodoroTimer.prototype._emitTick = function () {
    this.onTick(this.getState());
  };

  PomodoroTimer.prototype.start = function () {
    if (this.isRunning) { return this.getState(); }
    if (this.timeLeft <= 0) { this.timeLeft = this.durationFor(this.mode); }
    this.isRunning = true;
    this._endTime = this._now() + this.timeLeft * 1000;
    this._startInterval();
    this._emitTick();
    return this.getState();
  };

  PomodoroTimer.prototype._startInterval = function () {
    if (!this._setInterval) { return; }
    this._clearTimer();
    this.intervalId = this._setInterval(this._tick, this.tickMs);
  };

  PomodoroTimer.prototype._clearTimer = function () {
    if (this.intervalId !== null && this._clearInterval) {
      this._clearInterval(this.intervalId);
    }
    this.intervalId = null;
  };

  PomodoroTimer.prototype.pause = function () {
    if (!this.isRunning) { return this.getState(); }
    this.timeLeft = this._remaining();
    this.isRunning = false;
    this._clearTimer();
    this._emitTick();
    return this.getState();
  };

  PomodoroTimer.prototype.toggle = function () {
    return this.isRunning ? this.pause() : this.start();
  };

  PomodoroTimer.prototype._remaining = function () {
    var ms = this._endTime - this._now();
    var s = Math.ceil(ms / 1000);
    if (s < 0) { s = 0; }
    if (s > this.durationFor(this.mode)) { s = this.durationFor(this.mode); }
    return s;
  };

  /** Back to the full duration of the current mode. */
  PomodoroTimer.prototype.reset = function () {
    this.isRunning = false;
    this._clearTimer();
    this.timeLeft = this.durationFor(this.mode);
    this._emitTick();
    return this.getState();
  };

  /** End the current session early and move to the next mode. */
  PomodoroTimer.prototype.skip = function () {
    return this._finish(true);
  };

  /** Switch mode and start that mode fresh (opts.preserveTime keeps the clock). */
  PomodoroTimer.prototype.switchMode = function (mode, opts) {
    opts = opts || {};
    var next = mode === 'break' ? 'break' : 'focus';
    this.isRunning = false;
    this._clearTimer();
    this.mode = next;
    this.timeLeft = opts.preserveTime ? this.timeLeft : this.durationFor(next);
    this.onModeChange(this.mode, this.getState());
    this._emitTick();
    return this.getState();
  };

  PomodoroTimer.prototype._onInterval = function () {
    if (!this.isRunning) { return; }
    var remaining = this._remaining();
    if (remaining !== this.timeLeft) {
      this.timeLeft = remaining;
      this._emitTick();
    }
    if (remaining <= 0) {
      this._finish(false);
    }
  };

  PomodoroTimer.prototype._finish = function (skipped) {
    var finishedMode = this.mode;
    var next = finishedMode === 'focus' ? 'break' : 'focus';

    this.isRunning = false;
    this._clearTimer();

    // A skipped focus session is not a completed one.
    if (finishedMode === 'focus' && !skipped) {
      this.completedFocusSessions += 1;
    }

    this.mode = next;
    this.timeLeft = this.durationFor(next);

    this.onSessionEnd({
      mode: finishedMode,
      next: next,
      skipped: !!skipped,
      completedFocusSessions: this.completedFocusSessions
    });
    this.onModeChange(this.mode, this.getState());
    this._emitTick();
    return this.getState();
  };

  /** Compact state the app shell can put in localStorage. */
  PomodoroTimer.prototype.serialize = function () {
    return {
      mode: this.mode,
      timeLeft: this.timeLeft,
      completedFocusSessions: this.completedFocusSessions
    };
  };

  /** Restore a saved state. Always restored paused (never auto-starts). */
  PomodoroTimer.prototype.restore = function (data) {
    if (!data || typeof data !== 'object') { return this.getState(); }
    this.isRunning = false;
    this._clearTimer();
    this.mode = data.mode === 'break' ? 'break' : 'focus';
    var duration = this.durationFor(this.mode);
    var t = Number(data.timeLeft);
    if (!isFinite(t) || t <= 0 || t > duration) { t = duration; }
    this.timeLeft = Math.floor(t);
    var done = Number(data.completedFocusSessions);
    this.completedFocusSessions = isFinite(done) && done >= 0 ? Math.floor(done) : 0;
    this.onModeChange(this.mode, this.getState());
    this._emitTick();
    return this.getState();
  };

  /** Stop the interval for good (prevents leaks if the app is torn down). */
  PomodoroTimer.prototype.destroy = function () {
    this.isRunning = false;
    this._clearTimer();
  };

  return PomodoroTimer;
});
