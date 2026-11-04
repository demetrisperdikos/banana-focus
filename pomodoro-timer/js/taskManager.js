/*
 * taskManager.js — task list CRUD + localStorage persistence (owner: Maya Patel)
 * --------------------------------------------------------------------------
 * No DOM dependency in the data layer; the render helper builds nodes with
 * createElement + textContent only (never innerHTML), so task text can never
 * be executed as HTML.
 *
 * Loaded as a classic script in the browser -> window.TaskManager
 * Loadable in Node for tests               -> module.exports
 *
 * API
 *   var tm = new TaskManager({ storage: localStorage, onChange: render });
 *   tm.loadTasks();
 *   tm.addTask('Write report'); tm.toggleTask(id); tm.deleteTask(id);
 *   tm.clearCompleted(); tm.setFilter('active'); tm.getVisibleTasks(); tm.getCounts();
 *   TaskManager.renderTask(task, handlers, doc) -> <li> element
 *
 * Ids are monotonic within a session and on every load we resume from the
 * highest id seen, so a deleted id is never handed out again.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TaskManager = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'pomodoro_tasks';
  var NEXT_ID_KEY = 'pomodoro_tasks_nextId';
  var MAX_TEXT_LENGTH = 200;
  var FILTERS = ['all', 'active', 'completed'];

  function noop() {}

  function cleanText(text) {
    if (text === null || text === undefined) { return ''; }
    var s = String(text).replace(/\s+/g, ' ').trim();
    if (s.length > MAX_TEXT_LENGTH) { s = s.slice(0, MAX_TEXT_LENGTH).trim(); }
    return s;
  }

  function TaskManager(options) {
    options = options || {};
    this.storageKey = options.storageKey || STORAGE_KEY;
    this.nextIdKey = options.nextIdKey || NEXT_ID_KEY;
    this.storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.filter = 'all';
    this.tasks = [];
    this._lastId = 0; // high-water mark: never reuse an id we have handed out
    this.onChange = options.onChange || noop;
  }

  /* ---------- persistence ---------- */

  TaskManager.prototype.loadTasks = function () {
    this.tasks = this._read();
    this._readWatermark();          // resume from the persisted high-water mark
    this._resetIdWatermark();       // and never go below the live list either
    this._writeWatermark();
    this._notify();
    return this.tasks;
  };
  TaskManager.prototype.load = TaskManager.prototype.loadTasks;

  TaskManager.prototype.saveTasks = function (tasks) {
    if (Array.isArray(tasks)) { this.tasks = tasks; }
    this._write(this.tasks);
    return this.tasks;
  };
  TaskManager.prototype.save = TaskManager.prototype.saveTasks;

  TaskManager.prototype._read = function () {
    if (!this.storage) { return []; }
    var raw;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch (err) {
      return []; // private mode / storage disabled
    }
    if (!raw) { return []; }
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return []; // corrupt data: start clean instead of crashing
    }
    if (!Array.isArray(parsed)) { return []; }
    return parsed.map(function (item, index) {
      item = item || {};
      var id = Number(item.id);
      return {
        id: isFinite(id) && id > 0 ? id : index + 1,
        text: cleanText(item.text),
        completed: item.completed === true
      };
    }).filter(function (task) {
      return task.text.length > 0;
    });
  };

  TaskManager.prototype._write = function (tasks) {
    if (!this.storage) { return; }
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(tasks));
    } catch (err) {
      /* storage full or blocked: keep working in memory */
    }
  };

  TaskManager.prototype._notify = function () {
    this.onChange(this.tasks.slice(), this.getCounts(), this.filter);
  };

  /* ---------- ids ---------- */

  /** Raise the watermark to the highest id currently in the list. */
  TaskManager.prototype._resetIdWatermark = function () {
    var max = 0;
    for (var i = 0; i < this.tasks.length; i++) {
      var id = Number(this.tasks[i].id);
      if (isFinite(id) && id > max) { max = id; }
    }
    if (max > this._lastId) { this._lastId = max; }
  };

  TaskManager.prototype._readWatermark = function () {
    if (!this.storage) { return; }
    var raw;
    try {
      raw = this.storage.getItem(this.nextIdKey);
    } catch (err) {
      return;
    }
    var n = Number(raw);
    if (isFinite(n) && n > this._lastId) { this._lastId = Math.floor(n); }
  };

  TaskManager.prototype._writeWatermark = function () {
    if (!this.storage) { return; }
    try {
      this.storage.setItem(this.nextIdKey, String(this._lastId));
    } catch (err) {
      /* storage blocked: ids stay correct for this session at least */
    }
  };

  /** Always a fresh, never-before-used id. */
  TaskManager.prototype._nextId = function () {
    this._lastId += 1;
    this._writeWatermark();
    return this._lastId;
  };

  /* ---------- CRUD ---------- */

  /** Returns the new task, or null when the text is empty. */
  TaskManager.prototype.addTask = function (text) {
    var clean = cleanText(text);
    if (!clean) { return null; }
    var task = {
      id: this._nextId(),
      text: clean,          // stored as plain text, never as HTML
      completed: false
    };
    this.tasks.push(task);
    this.saveTasks();
    this._notify();
    return task;
  };

  TaskManager.prototype.toggleTask = function (id) {
    id = Number(id);
    for (var i = 0; i < this.tasks.length; i++) {
      if (this.tasks[i].id === id) {
        this.tasks[i].completed = !this.tasks[i].completed;
        this.saveTasks();
        this._notify();
        return this.tasks[i];
      }
    }
    return null;
  };

  TaskManager.prototype.deleteTask = function (id) {
    id = Number(id);
    var before = this.tasks.length;
    this.tasks = this.tasks.filter(function (task) { return task.id !== id; });
    if (this.tasks.length === before) { return false; }
    this.saveTasks();
    this._notify();
    return true;
  };

  TaskManager.prototype.clearCompleted = function () {
    var before = this.tasks.length;
    this.tasks = this.tasks.filter(function (task) { return !task.completed; });
    var removed = before - this.tasks.length;
    if (removed > 0) {
      this.saveTasks();
      this._notify();
    }
    return removed;
  };

  /* ---------- filtering ---------- */

  TaskManager.prototype.setFilter = function (filter) {
    this.filter = FILTERS.indexOf(filter) !== -1 ? filter : 'all';
    this._notify();
    return this.filter;
  };

  TaskManager.prototype.getVisibleTasks = function () {
    if (this.filter === 'active') {
      return this.tasks.filter(function (task) { return !task.completed; });
    }
    if (this.filter === 'completed') {
      return this.tasks.filter(function (task) { return task.completed; });
    }
    return this.tasks.slice();
  };

  TaskManager.prototype.getCounts = function () {
    var completed = 0;
    for (var i = 0; i < this.tasks.length; i++) {
      if (this.tasks[i].completed) { completed++; }
    }
    return {
      total: this.tasks.length,
      completed: completed,
      active: this.tasks.length - completed
    };
  };

  /* ---------- safe rendering ---------- */

  /**
   * Build one <li> for a task using createElement/textContent only.
   * handlers: { onToggle(id), onDelete(id) }
   */
  TaskManager.renderTask = function (task, handlers, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) { throw new Error('renderTask needs a document'); }
    handlers = handlers || {};

    var li = doc.createElement('li');
    li.className = 'task-item' + (task.completed ? ' completed' : '');
    li.setAttribute('data-id', String(task.id));

    var checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = task.completed === true;
    checkbox.setAttribute('aria-label', 'Mark "' + task.text + '" as ' + (task.completed ? 'active' : 'completed'));
    checkbox.addEventListener('change', function () {
      if (typeof handlers.onToggle === 'function') { handlers.onToggle(task.id); }
    });

    var span = doc.createElement('span');
    span.className = 'task-text';
    span.textContent = task.text; // XSS-safe: text, not markup

    var del = doc.createElement('button');
    del.type = 'button';
    del.className = 'task-delete';
    del.setAttribute('aria-label', 'Delete task "' + task.text + '"');
    del.textContent = '\u00d7';
    del.addEventListener('click', function () {
      if (typeof handlers.onDelete === 'function') { handlers.onDelete(task.id); }
    });

    li.appendChild(checkbox);
    li.appendChild(span);
    li.appendChild(del);
    return li;
  };

  TaskManager.cleanText = cleanText;
  TaskManager.MAX_TEXT_LENGTH = MAX_TEXT_LENGTH;
  TaskManager.STORAGE_KEY = STORAGE_KEY;
  TaskManager.NEXT_ID_KEY = NEXT_ID_KEY;

  return TaskManager;
});
