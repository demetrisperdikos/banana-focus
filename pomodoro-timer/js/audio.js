/*
 * audio.js — Sound management for Banana Focus (Pomodoro Timer)
 * -----------------------------------------------------------------
 * Real, bundled assets only (no base64 blobs):
 *   assets/sounds/alarm.mp3  (fallback assets/sounds/alarm.wav)
 *   assets/sounds/click.mp3  (fallback assets/sounds/click.wav)
 *
 * Handles the browser autoplay policy: audio is unlocked on the first
 * real user gesture (click/keydown/touch), then plays freely after that.
 * Fails soft — if audio is unavailable the timer still works silently.
 *
 * Classic script -> window.PomodoroAudio
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PomodoroAudio = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CLICK_VOLUME = 0.4;
  var ALARM_VOLUME = 0.9;

  function PomodoroAudio(options) {
    options = options || {};
    this.isMuted = options.muted === true;
    this.unlocked = false;
    this.available = (typeof Audio !== 'undefined');
    this.basePath = options.basePath || 'assets/sounds/';
    this._alarm = null;
    this._click = null;
  }

  PomodoroAudio.prototype._make = function (name, ext, volume) {
    if (!this.available) { return null; }
    try {
      var a = new Audio(this.basePath + name + '.' + ext);
      a.preload = 'auto';
      a.volume = volume;
      return a;
    } catch (err) {
      return null;
    }
  };

  PomodoroAudio.prototype._ensure = function () {
    if (!this._alarm) { this._alarm = this._make('alarm', 'mp3', ALARM_VOLUME) || this._make('alarm', 'wav', ALARM_VOLUME); }
    if (!this._click) { this._click = this._make('click', 'mp3', CLICK_VOLUME) || this._make('click', 'wav', CLICK_VOLUME); }
  };

  /**
   * Call from the first user gesture. Starts a muted play/pause on each
   * clip so the browser marks them as user-activated.
   */
  PomodoroAudio.prototype.unlock = function () {
    this._ensure();
    var self = this;
    [this._alarm, this._click].forEach(function (el) {
      if (!el) { return; }
      var vol = el.volume;
      el.volume = 0;
      var p = el.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          el.pause();
          el.currentTime = 0;
          el.volume = vol;
        }).catch(function () {
          el.volume = vol; // still blocked; try again on the next gesture
        });
      } else {
        try { el.pause(); el.currentTime = 0; } catch (e) { /* ignore */ }
        el.volume = vol;
      }
    });
    this.unlocked = true;
    return this;
  };

  PomodoroAudio.prototype._play = function (el) {
    if (!el || this.isMuted) { return; }
    try {
      el.currentTime = 0;
      var p = el.play();
      if (p && typeof p.catch === 'function') { p.catch(function () { /* autoplay blocked: stay silent */ }); }
    } catch (err) {
      /* nothing we can do; keep the timer running */
    }
  };

  /** Pleasant chime when a focus/break session ends. */
  PomodoroAudio.prototype.playAlarm = function () {
    this._ensure();
    this._play(this._alarm);
  };

  /** Subtle tick for button presses. */
  PomodoroAudio.prototype.playClick = function () {
    this._ensure();
    this._play(this._click);
  };

  PomodoroAudio.prototype.setMuted = function (muted) {
    this.isMuted = muted === true;
    return this.isMuted;
  };

  PomodoroAudio.prototype.toggleMute = function () {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  };

  return PomodoroAudio;
});
