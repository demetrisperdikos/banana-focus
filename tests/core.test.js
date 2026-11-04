/* Maya Patel — self-test for timer.js + taskManager.js (Node, no browser) */
var assert = require('assert');
var path = require('path');

var timerPath = path.join(__dirname, '..', 'pomodoro-timer', 'js', 'timer.js');
var taskPath = path.join(__dirname, '..', 'pomodoro-timer', 'js', 'taskManager.js');
var PomodoroTimer = require(timerPath);
var TaskManager = require(taskPath);

var passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  - ' + name); }
  catch (err) { console.log('FAIL  - ' + name + '\n        ' + err.message); process.exitCode = 1; }
}

/* ---------- fake clock: lets us "wait" 25 minutes instantly ---------- */
function makeClock() {
  var now = 0;
  var timers = [];
  var id = 0;
  return {
    now: function () { return now; },
    setInterval: function (fn) { var t = { id: ++id, fn: fn }; timers.push(t); return t.id; },
    clearInterval: function (theId) { timers = timers.filter(function (t) { return t.id !== theId; }); },
    advance: function (seconds) {
      var steps = seconds;
      for (var i = 0; i < steps; i++) {
        now += 1000;
        timers.slice().forEach(function (t) { t.fn(); });
      }
    },
    liveTimers: function () { return timers.length; }
  };
}

function makeStorage() {
  var data = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    _dump: function () { return data; }
  };
}

console.log('timer.js');

test('starts at 25:00 focus', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  assert.strictEqual(t.timeLeft, 1500);
  assert.strictEqual(t.getState().display, '25:00');
  assert.strictEqual(t.mode, 'focus');
});

test('counts down while running', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t.start();
  clock.advance(60);
  assert.strictEqual(t.getState().display, '24:00');
});

test('pause freezes the clock and clears the interval', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t.start();
  clock.advance(10);
  t.pause();
  assert.strictEqual(t.timeLeft, 1490);
  clock.advance(120);
  assert.strictEqual(t.timeLeft, 1490, 'time must not move while paused');
  assert.strictEqual(clock.liveTimers(), 0, 'interval must be cleared on pause');
});

test('resume continues from where it paused', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t.start(); clock.advance(10); t.pause(); t.start();
  clock.advance(30);
  assert.strictEqual(t.timeLeft, 1460);
});

test('toggle flips start/pause', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t.toggle(); assert.strictEqual(t.isRunning, true);
  t.toggle(); assert.strictEqual(t.isRunning, false);
});

test('reset returns to the full current duration', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t.start(); clock.advance(300); t.reset();
  assert.strictEqual(t.timeLeft, 1500);
  assert.strictEqual(t.isRunning, false);
  assert.strictEqual(clock.liveTimers(), 0);
});

test('auto-switches focus -> break at 00:00 and fires sound hook once', function () {
  var clock = makeClock();
  var ends = [];
  var t = new PomodoroTimer({
    setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now,
    onSessionEnd: function (e) { ends.push(e); }
  });
  t.start();
  clock.advance(1500);
  assert.strictEqual(ends.length, 1);
  assert.strictEqual(ends[0].mode, 'focus');
  assert.strictEqual(ends[0].next, 'break');
  assert.strictEqual(ends[0].skipped, false);
  assert.strictEqual(t.mode, 'break');
  assert.strictEqual(t.timeLeft, 300);
  assert.strictEqual(ends[0].completedFocusSessions, 1);
  assert.strictEqual(clock.liveTimers(), 0, 'must not keep ticking after the session ends');
});

test('break -> focus also auto-switches', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t.start(); clock.advance(1500); // focus done, now break
  t.start(); clock.advance(300);
  assert.strictEqual(t.mode, 'focus');
  assert.strictEqual(t.timeLeft, 1500);
  assert.strictEqual(t.completedFocusSessions, 1, 'breaks do not count as focus sessions');
});

test('skip ends the session early, next mode already reset', function () {
  var clock = makeClock();
  var ends = [];
  var t = new PomodoroTimer({
    setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now,
    onSessionEnd: function (e) { ends.push(e); }
  });
  t.start(); clock.advance(600); t.skip();
  assert.strictEqual(ends.length, 1);
  assert.strictEqual(ends[0].skipped, true);
  assert.strictEqual(t.mode, 'break');
  assert.strictEqual(t.timeLeft, 300);
  assert.strictEqual(t.completedFocusSessions, 0, 'a skipped focus session does not count');
  assert.strictEqual(clock.liveTimers(), 0);
});

test('switchMode goes fresh and paused', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t.start(); clock.advance(100); t.switchMode('break');
  assert.strictEqual(t.mode, 'break');
  assert.strictEqual(t.timeLeft, 300);
  assert.strictEqual(t.isRunning, false);
  assert.strictEqual(clock.liveTimers(), 0);
});

test('progress runs 0 -> ~1', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  assert.strictEqual(t.getState().progress, 0);
  t.start(); clock.advance(750);
  assert.ok(Math.abs(t.getState().progress - 0.5) < 0.01, 'expected ~0.5, got ' + t.getState().progress);
});

test('start() twice does not create two intervals', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t.start(); t.start(); t.start();
  assert.strictEqual(clock.liveTimers(), 1);
});

test('many start/pause cycles leave no live interval', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  for (var i = 0; i < 50; i++) { t.start(); clock.advance(3); t.pause(); }
  assert.strictEqual(clock.liveTimers(), 0);
  assert.strictEqual(t.timeLeft, 1500 - 150);
});

test('serialize/restore round-trips and restores paused', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t.start(); clock.advance(90);
  var saved = JSON.parse(JSON.stringify(t.serialize()));

  var t2 = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t2.restore(saved);
  assert.strictEqual(t2.timeLeft, 1410);
  assert.strictEqual(t2.mode, 'focus');
  assert.strictEqual(t2.isRunning, false, 'must come back paused');
});

test('restore ignores junk and clamps bad values', function () {
  var t = new PomodoroTimer({ setInterval: makeClock().setInterval, clearInterval: makeClock().clearInterval, now: makeClock().now });
  t.restore(null);
  assert.strictEqual(t.timeLeft, 1500);
  t.restore({ mode: 'nonsense', timeLeft: 99999 });
  assert.strictEqual(t.mode, 'focus');
  assert.strictEqual(t.timeLeft, 1500, 'over-large value clamps to the duration');
  t.restore({ mode: 'break', timeLeft: -5 });
  assert.strictEqual(t.timeLeft, 300);
});

test('formatTime pads correctly', function () {
  assert.strictEqual(PomodoroTimer.formatTime(1500), '25:00');
  assert.strictEqual(PomodoroTimer.formatTime(300), '05:00');
  assert.strictEqual(PomodoroTimer.formatTime(59), '00:59');
  assert.strictEqual(PomodoroTimer.formatTime(0), '00:00');
  assert.strictEqual(PomodoroTimer.formatTime(-10), '00:00');
});

test('supports custom durations (short timers for testing)', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({
    durations: { focus: 3, break: 2 },
    setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now
  });
  assert.strictEqual(t.timeLeft, 3);
  t.start(); clock.advance(3);
  assert.strictEqual(t.mode, 'break');
  assert.strictEqual(t.timeLeft, 2);
});

test('destroy stops everything', function () {
  var clock = makeClock();
  var t = new PomodoroTimer({ setInterval: clock.setInterval, clearInterval: clock.clearInterval, now: clock.now });
  t.start(); t.destroy();
  assert.strictEqual(clock.liveTimers(), 0);
  assert.strictEqual(t.isRunning, false);
});

console.log('\ntaskManager.js');

test('adds tasks and trims text', function () {
  var tm = new TaskManager({ storage: makeStorage() });
  var task = tm.addTask('   Write   the report  ');
  assert.strictEqual(task.text, 'Write the report');
  assert.strictEqual(task.completed, false);
  assert.strictEqual(tm.getCounts().total, 1);
});

test('empty / whitespace text is rejected', function () {
  var tm = new TaskManager({ storage: makeStorage() });
  assert.strictEqual(tm.addTask(''), null);
  assert.strictEqual(tm.addTask('    '), null);
  assert.strictEqual(tm.addTask(null), null);
  assert.strictEqual(tm.getCounts().total, 0);
});

test('long text is capped at 200 chars', function () {
  var tm = new TaskManager({ storage: makeStorage() });
  var task = tm.addTask(new Array(500).join('a'));
  assert.strictEqual(task.text.length, 200);
});

test('ids stay unique even after deletes', function () {
  var tm = new TaskManager({ storage: makeStorage() });
  var a = tm.addTask('one');
  tm.deleteTask(a.id);
  var b = tm.addTask('two');
  assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(tm.getCounts().total, 1);
});

test('ids are not reused across a reload', function () {
  var storage = makeStorage();
  var tm = new TaskManager({ storage: storage });
  tm.addTask('a');
  var last = tm.addTask('b');
  tm.deleteTask(last.id);

  var tm2 = new TaskManager({ storage: storage });
  tm2.loadTasks();
  var fresh = tm2.addTask('c');
  assert.ok(fresh.id > last.id, 'reloaded manager must issue ids above the old high-water mark');
});

test('every id in a long mixed run is unique', function () {
  var tm = new TaskManager({ storage: makeStorage() });
  var seen = {};
  for (var i = 0; i < 40; i++) {
    var t = tm.addTask('task ' + i);
    assert.ok(!seen[t.id], 'id ' + t.id + ' was reused');
    seen[t.id] = true;
    if (i % 3 === 0) { tm.deleteTask(t.id); }
    if (i % 5 === 0) { tm.toggleTask(t.id); }
  }
});

test('toggle, filter and clearCompleted work together', function () {
  var tm = new TaskManager({ storage: makeStorage() });
  var a = tm.addTask('a');
  var b = tm.addTask('b');
  tm.addTask('c');
  tm.toggleTask(a.id);
  tm.toggleTask(b.id);
  assert.deepStrictEqual(tm.getCounts(), { total: 3, completed: 2, active: 1 });

  tm.setFilter('active');
  assert.strictEqual(tm.getVisibleTasks().length, 1);
  tm.setFilter('completed');
  assert.strictEqual(tm.getVisibleTasks().length, 2);
  tm.setFilter('all');
  assert.strictEqual(tm.getVisibleTasks().length, 3);

  assert.strictEqual(tm.clearCompleted(), 2);
  assert.strictEqual(tm.getCounts().total, 1);
  tm.setFilter('completed');
  assert.strictEqual(tm.getVisibleTasks().length, 0);
});

test('bad filter name falls back to all', function () {
  var tm = new TaskManager({ storage: makeStorage() });
  tm.addTask('a');
  tm.setFilter('banana');
  assert.strictEqual(tm.filter, 'all');
  assert.strictEqual(tm.getVisibleTasks().length, 1);
});

test('unchecking a completed task works', function () {
  var tm = new TaskManager({ storage: makeStorage() });
  var a = tm.addTask('a');
  tm.toggleTask(a.id);
  assert.strictEqual(tm.getCounts().completed, 1);
  tm.toggleTask(a.id);
  assert.strictEqual(tm.getCounts().completed, 0);
});

test('tasks persist to storage and reload', function () {
  var storage = makeStorage();
  var tm = new TaskManager({ storage: storage });
  var a = tm.addTask('persist me');
  tm.toggleTask(a.id);

  var tm2 = new TaskManager({ storage: storage });
  tm2.loadTasks();
  assert.strictEqual(tm2.getCounts().total, 1);
  assert.strictEqual(tm2.tasks[0].text, 'persist me');
  assert.strictEqual(tm2.tasks[0].completed, true);
});

test('corrupt stored JSON does not crash - starts clean', function () {
  var storage = makeStorage();
  storage.setItem('pomodoro_tasks', '{not json at all');
  var tm = new TaskManager({ storage: storage });
  tm.loadTasks();
  assert.strictEqual(tm.getCounts().total, 0);
});

test('junk entries are dropped and ids repaired on load', function () {
  var storage = makeStorage();
  storage.setItem('pomodoro_tasks', JSON.stringify([
    { id: 5, text: 'keep', completed: false },
    { text: '   ' },
    null,
    { id: 'x', text: 'fix id', completed: 'yes' }
  ]));
  var tm = new TaskManager({ storage: storage });
  tm.loadTasks();
  assert.strictEqual(tm.getCounts().total, 2);
  assert.deepStrictEqual(tm.tasks[0], { id: 5, text: 'keep', completed: false });
  assert.strictEqual(tm.tasks[1].text, 'fix id');
  assert.strictEqual(tm.tasks[1].completed, false, 'non-boolean completed becomes false');
  assert.ok(tm.tasks[1].id > 0);
});

test('works with no storage at all (in-memory only)', function () {
  var tm = new TaskManager({ storage: null });
  tm.addTask('still works');
  assert.strictEqual(tm.getCounts().total, 1);
  tm.loadTasks();
  assert.strictEqual(tm.getCounts().total, 0, 'nothing to reload, but no crash');
});

test('storage that throws never breaks the app', function () {
  var boom = {
    getItem: function () { throw new Error('blocked'); },
    setItem: function () { throw new Error('quota'); }
  };
  var tm = new TaskManager({ storage: boom });
  tm.loadTasks();
  tm.addTask('a');
  assert.strictEqual(tm.getCounts().total, 1);
});

test('onChange fires with tasks, counts and filter', function () {
  var calls = [];
  var tm = new TaskManager({ storage: makeStorage(), onChange: function (tasks, counts, filter) { calls.push({ n: tasks.length, counts: counts, filter: filter }); } });
  tm.addTask('a');
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].counts, { total: 1, completed: 0, active: 1 });
  assert.strictEqual(calls[0].filter, 'all');
});

console.log('\nXSS safety (renderTask with a real DOM shim)');

// Minimal document shim: enough to run renderTask and prove textContent is used.
function makeDoc() {
  function El(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this._text = '';
  }
  El.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
  El.prototype.appendChild = function (c) { this.children.push(c); return c; };
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  Object.defineProperty(El.prototype, 'textContent', {
    get: function () { return this._text; },
    set: function (v) { this._text = String(v); }
  });
  return { createElement: function (tag) { return new El(tag); } };
}

test('hostile task text is rendered as text, not markup', function () {
  var doc = makeDoc();
  var hostile = '<img src=x onerror="alert(1)"><script>bad()</script>';
  var tm = new TaskManager({ storage: makeStorage() });
  var task = tm.addTask(hostile);

  var el = TaskManager.renderTask(task, { onToggle: function () {}, onDelete: function () {} }, doc);
  var span = el.children[1];

  assert.strictEqual(span.textContent, task.text, 'text kept verbatim as text');
  assert.strictEqual(el.tagName, 'li');
  assert.strictEqual(el.children.length, 3, 'checkbox + text + delete');
  assert.strictEqual(el.children[0].tagName, 'input');
  assert.strictEqual(el.children[2].tagName, 'button');
  // there is no innerHTML path anywhere: children are real nodes, the tag is never parsed
  assert.strictEqual(typeof span.innerHTML, 'undefined');
});

test('renderTask wires up toggle and delete callbacks', function () {
  var doc = makeDoc();
  var tm = new TaskManager({ storage: makeStorage() });
  var task = tm.addTask('click me');
  var toggled = [];
  var deleted = [];
  var el = TaskManager.renderTask(task, {
    onToggle: function (id) { toggled.push(id); },
    onDelete: function (id) { deleted.push(id); }
  }, doc);

  el.children[0].listeners.change[0]();
  el.children[2].listeners.click[0]();
  assert.deepStrictEqual(toggled, [task.id]);
  assert.deepStrictEqual(deleted, [task.id]);
});

test('completed task renders checked and marked', function () {
  var doc = makeDoc();
  var tm = new TaskManager({ storage: makeStorage() });
  var task = tm.addTask('done thing');
  tm.toggleTask(task.id);
  var el = TaskManager.renderTask(tm.tasks[0], {}, doc);
  assert.strictEqual(el.children[0].checked, true);
  assert.ok(el.className.indexOf('completed') !== -1);
});

console.log('\n' + passed + ' checks passed');
