#!/usr/bin/env node
/*
 * browser-e2e.js — real end-to-end test of the wired Pomodoro app in
 * headless Chromium. Loads index.html over file://, drives the UI with
 * synthetic clicks/keyboard, and asserts on live DOM + localStorage.
 *
 * Usage: node tests/browser-e2e.js
 * Exit 0 = all assertions passed.
 */
const path = require('path');
const fs = require('fs');

const puppeteer = require(path.join(__dirname, '..', 'qa', 'node_modules', 'puppeteer-core'));

const INDEX = 'file://' + path.join(__dirname, '..', 'pomodoro-timer', 'index.html');
const CHROMIUM = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  .find((p) => fs.existsSync(p));

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok  - ' + name); }
  else { failed++; console.log('  FAIL- ' + name + (extra ? '  ' + extra : '')); }
}

(async () => {
  if (!CHROMIUM) { console.log('no chromium found'); process.exit(1); }
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files',
           '--autoplay-policy=no-user-gesture-required', '--mute-audio']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(INDEX, { waitUntil: 'load' });
  await page.waitForSelector('#timer');

  // Modules exposed?
  const mods = await page.evaluate(() => ({
    timer: typeof window.PomodoroTimer,
    tm: typeof window.TaskManager,
    audio: typeof window.PomodoroAudio,
    app: typeof window.BananaFocus
  }));
  check('all three modules + app controller are loaded',
    mods.timer === 'function' && mods.tm === 'function' && mods.audio === 'function' && mods.app === 'object',
    JSON.stringify(mods));

  // Initial display
  let disp = await page.$eval('#timer', (e) => e.textContent.trim());
  check('timer starts at 25:00', disp === '25:00', disp);
  let badge = await page.$eval('#mode-badge', (e) => e.textContent.trim());
  check('mode badge shows Focus', badge === 'Focus', badge);

  // Start -> counts down
  await page.click('#start-pause-btn');
  await new Promise((r) => setTimeout(r, 1300));
  disp = await page.$eval('#timer', (e) => e.textContent.trim());
  check('timer counts down after Start', disp === '24:59' || disp === '24:58', disp);
  let pauseShown = await page.$eval('#pause-icon', (e) => getComputedStyle(e).display !== 'none');
  check('pause icon shown while running', pauseShown);

  // Pause -> holds
  await page.click('#start-pause-btn');
  const held = await page.$eval('#timer', (e) => e.textContent.trim());
  await new Promise((r) => setTimeout(r, 1200));
  const held2 = await page.$eval('#timer', (e) => e.textContent.trim());
  check('pause freezes the timer', held === held2, held + ' -> ' + held2);

  // Reset
  await page.click('#reset-btn');
  disp = await page.$eval('#timer', (e) => e.textContent.trim());
  check('reset returns to 25:00', disp === '25:00', disp);

  // Tasks: add via Enter
  await page.click('#task-input');
  await page.type('#task-input', 'Write report');
  await page.keyboard.press('Enter');
  await page.type('#task-input', 'Email team');
  await page.click('#add-task-btn');
  let items = await page.$$eval('#task-list li', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
  check('two tasks added', items.length === 2, JSON.stringify(items));
  check('task text rendered', items.join('|').indexOf('Write report') !== -1, JSON.stringify(items));

  // Toggle complete via checkbox
  await page.click('#task-list li:first-child input[type="checkbox"]');
  const doneCount = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('pomodoro_tasks') || '[]');
    return t.filter((x) => x.completed).length;
  });
  check('checkbox marks task complete in storage', doneCount === 1, String(doneCount));

  // Filter: Active should hide completed
  await page.click('.filter-btn[data-filter="active"]');
  items = await page.$$eval('#task-list li', (ls) => ls.length);
  check('Active filter shows only 1', items === 1, String(items));
  await page.click('.filter-btn[data-filter="completed"]');
  items = await page.$$eval('#task-list li', (ls) => ls.length);
  check('Completed filter shows only 1', items === 1, String(items));
  await page.click('.filter-btn[data-filter="all"]');

  // Delete the second task
  await page.click('#task-list li:nth-child(2) button');
  items = await page.$$eval('#task-list li', (ls) => ls.length);
  check('delete removes a task', items === 1, String(items));

  // Clear completed
  await page.click('#clear-completed-btn');
  items = await page.$$eval('#task-list li', (ls) => ls.length);
  check('clear completed empties the list', items === 0, String(items));

  // XSS: hostile text must never execute or inject markup
  await page.click('#task-input');
  await page.type('#task-input', '<img src=x onerror=window.__xss=1>');
  await page.keyboard.press('Enter');
  const xss = await page.evaluate(() => ({
    flag: window.__xss || 0,
    imgs: document.querySelectorAll('#task-list img').length
  }));
  check('hostile task text injects no elements', xss.imgs === 0, JSON.stringify(xss));
  check('hostile task text executes nothing', !xss.flag, JSON.stringify(xss));

  // Refresh keeps tasks
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#task-list');
  items = await page.$$eval('#task-list li', (ls) => ls.length);
  check('tasks survive a reload', items === 1, String(items));

  // Timer state survives reload (kept from earlier focus session)
  const savedTimer = await page.evaluate(() => localStorage.getItem('pomodoro_timer'));
  check('timer state persisted to localStorage', !!savedTimer, String(savedTimer));

  // Mute toggle
  await page.click('#mute-btn');
  const muted = await page.$eval('#mute-btn', (e) => e.getAttribute('aria-pressed'));
  check('mute button toggles aria-pressed', muted === 'true', String(muted));

  check('no console/page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
