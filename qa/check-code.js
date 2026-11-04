// Static safety checks for the Pomodoro Focus Timer source.
// Usage: node check-code.js [path/to/pomodoro-timer]
// Default path: ../../pomodoro-timer relative to this file.
// Exit code 0 = no failures (warnings allowed), 1 = failures found.

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'pomodoro-timer'));
let failures = 0;
let warnings = 0;

function fail(msg) { failures++; console.log(`FAIL  ${msg}`); }
function warn(msg) { warnings++; console.log(`WARN  ${msg}`); }
function pass(msg) { console.log(`PASS  ${msg}`); }

if (!fs.existsSync(root)) {
  fail(`project folder not found: ${root}`);
  console.log(`\n0 checks run: project not built yet`);
  process.exit(1);
}

// Collect files
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = walk(root);
const rel = (f) => path.relative(root, f);
const read = (f) => fs.readFileSync(f, 'utf8');
const textFiles = files.filter((f) => /\.(html|css|js)$/.test(f));
const jsFiles = files.filter((f) => f.endsWith('.js'));
const htmlFiles = files.filter((f) => f.endsWith('.html'));

// 1. Required structure from the plan
const required = [
  'index.html', 'css/style.css', 'css/components.css',
  'js/app.js', 'js/timer.js', 'js/taskManager.js', 'js/audio.js',
  'assets/sounds/alarm.mp3', 'assets/sounds/click.mp3',
];
for (const r of required) {
  fs.existsSync(path.join(root, r)) ? pass(`file present: ${r}`) : fail(`missing file: ${r}`);
}

// 2. XSS: unsafe DOM sinks
const sinks = /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write(ln)?\s*\(/;
let sinkHits = 0;
for (const f of jsFiles) {
  read(f).split('\n').forEach((line, i) => {
    if (sinks.test(line)) {
      sinkHits++;
      fail(`unsafe HTML sink in ${rel(f)}:${i + 1}: ${line.trim()}`);
    }
  });
}
if (sinkHits === 0) pass('no innerHTML / outerHTML / insertAdjacentHTML / document.write in JS');

// taskManager must render task text with textContent
const tmPath = path.join(root, 'js', 'taskManager.js');
if (fs.existsSync(tmPath)) {
  const tm = read(tmPath);
  /textContent/.test(tm) ? pass('taskManager.js uses textContent') : fail('taskManager.js never uses textContent for task text');
}

// 3. Code execution from strings
const evalRe = /\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/;
let evalHits = 0;
for (const f of jsFiles) {
  read(f).split('\n').forEach((line, i) => {
    if (evalRe.test(line)) { evalHits++; fail(`string/eval execution in ${rel(f)}:${i + 1}: ${line.trim()}`); }
  });
}
if (evalHits === 0) pass('no eval / new Function / string timers');

// 4. External resources (plan: no CDN, everything bundled)
const extRe = /(src|href)\s*=\s*['"](https?:)?\/\//i;
const extUrlRe = /https?:\/\/(?!www\.w3\.org\/2000\/svg)[^\s'")]+/i;
let extHits = 0;
for (const f of textFiles) {
  read(f).split('\n').forEach((line, i) => {
    if (extRe.test(line)) { extHits++; fail(`external resource in ${rel(f)}:${i + 1}: ${line.trim()}`); }
    else if (/\.(css|js)$/.test(f) && extUrlRe.test(line)) { extHits++; warn(`URL literal in ${rel(f)}:${i + 1}: ${line.trim()}`); }
  });
  if (/@import\s+url\(\s*['"]?https?:/i.test(read(f))) { extHits++; fail(`@import of external CSS in ${rel(f)}`); }
}
if (extHits === 0) pass('no external CDN or remote resources');

// 5. Timer leak safety: every setInterval must have a clearInterval
const timerPath = path.join(root, 'js', 'timer.js');
if (fs.existsSync(timerPath)) {
  const t = read(timerPath);
  const sets = (t.match(/setInterval\s*\(/g) || []).length;
  const clears = (t.match(/clearInterval\s*\(/g) || []).length;
  if (sets === 0) fail('timer.js never calls setInterval');
  else if (clears === 0) fail('timer.js calls setInterval but never clearInterval (leak on pause/reset)');
  else pass(`timer.js: ${sets} setInterval, ${clears} clearInterval`);
  /clearInterval\s*\(\s*\w*[Ii]d/.test(t) || warn('clearInterval not called with a stored id variable; check it is the same id that was set');
}

// 6. Audio: autoplay guard and no unhandled play() promise
const audioPath = path.join(root, 'js', 'audio.js');
if (fs.existsSync(audioPath)) {
  const a = read(audioPath);
  if (/\.play\s*\(/.test(a)) {
    /\.play\(\)\s*\.catch|catch\s*\(|try\s*\{/.test(a)
      ? pass('audio.js handles play() rejection (autoplay policy)')
      : warn('audio.js calls play() without catch; autoplay rejection would be unhandled');
  } else warn('audio.js has no play() call');
}

// 7. Storage key and error handling
const tmSrc = fs.existsSync(tmPath) ? read(tmPath) : '';
if (tmSrc) {
  /pomodoro_tasks/.test(tmSrc) ? pass('storage key pomodoro_tasks used') : fail('storage key pomodoro_tasks not found in taskManager.js');
  /JSON\.parse/.test(tmSrc) && /try\s*\{/.test(tmSrc)
    ? pass('JSON.parse of stored data is wrapped in try')
    : warn('loading localStorage without try/catch: corrupt data would break the app');
}

// 8. HTML hygiene
for (const f of htmlFiles) {
  const h = read(f);
  /<meta[^>]+name=['"]viewport['"]/i.test(h) ? pass(`${rel(f)}: viewport meta present`) : fail(`${rel(f)}: missing viewport meta tag`);
  /<html[^>]+lang=/i.test(h) ? pass(`${rel(f)}: lang attribute set`) : fail(`${rel(f)}: <html> has no lang attribute`);
  /\son[a-z]+\s*=\s*['"]/i.test(h) ? fail(`${rel(f)}: inline event handler attribute found (use addEventListener)`) : pass(`${rel(f)}: no inline event handlers`);
  const buttons = h.match(/<button\b[^>]*>/gi) || [];
  const unnamed = buttons.filter((b) => !/aria-label\s*=/.test(b) && !/title\s*=/.test(b));
  unnamed.length === 0 ? pass(`${rel(f)}: buttons carry aria-label or title (${buttons.length} checked)`)
    : warn(`${rel(f)}: ${unnamed.length} button(s) may lack aria-label (icon-only buttons need one)`);
}

// 9. Leftover debug output
for (const f of jsFiles) {
  const n = (read(f).match(/console\.(log|debug)\s*\(/g) || []).length;
  if (n) warn(`${rel(f)}: ${n} console.log/debug call(s) left in`);
}

console.log(`\nStatic checks: ${failures} failure(s), ${warnings} warning(s)`);
process.exit(failures ? 1 : 0);
