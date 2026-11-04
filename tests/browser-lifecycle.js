#!/usr/bin/env node
/*
 * browser-lifecycle.js — deterministic real-browser test of the full
 * Pomodoro cycle and reward loop. Each link of the cycle is forced
 * explicitly (set mode + short timeLeft + start, then sample) so the
 * test never races the auto-rolling timer.
 *
 * Usage: node tests/browser-lifecycle.js   (exit 0 = all good)
 */
const path = require('path');
const fs = require('fs');

const puppeteer = require(path.join(__dirname, '..', 'qa', 'node_modules', 'puppeteer-core'));
const INDEX = 'file://' + path.join(__dirname, '..', 'pomodoro-timer', 'index.html');
const CHROMIUM = ['/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok  - ' + name); }
  else { failed++; console.log('  FAIL- ' + name + (extra ? '  ' + extra : '')); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files', '--mute-audio']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto(INDEX, { waitUntil: 'load' });
  await page.waitForSelector('#timer');

  // Arm the spies and give the app short sessions. We drive each end.
  await page.evaluate(() => {
    const app = window.BananaFocus;
    app.timer.durations.focus = 1;
    app.timer.durations.break = 1;
    app.timer.completedFocusSessions = 0;
    window.__alarms = 0;
    if (app.audio) { app.audio.playAlarm = () => { window.__alarms++; }; }
  });

  // ---- Link 1: a focus session ends into an auto-running break ----
  await page.evaluate(() => {
    const t = window.BananaFocus.timer;
    t.switchMode('focus'); t.timeLeft = 1; t.start();
  });
  await wait(1600);
  let s = await page.evaluate(() => {
    const t = window.BananaFocus.timer;
    const running = t.isRunning;
    t.pause();
    return {
      mode: t.mode, running: running,
      badge: document.getElementById('mode-badge').textContent.trim(),
      alarms: window.__alarms, sessions: t.completedFocusSessions,
      bodyBreak: document.body.classList.contains('mode-break'),
      ringBreak: document.querySelector('.progress-ring__fill').getAttribute('class')
    };
  });
  check('focus ends into break mode', s.mode === 'break', JSON.stringify(s));
  check('break keeps running after a natural end', s.running === true, JSON.stringify(s));
  check('mode badge flips to Break', s.badge === 'Break', s.badge);
  check('body gets the break theme class', s.bodyBreak === true, String(s.bodyBreak));
  check('progress ring switches to break styling', /break/.test(s.ringBreak), s.ringBreak);
  check('alarm sounds once at session end', s.alarms === 1, String(s.alarms));
  check('completed focus session counted', s.sessions === 1, String(s.sessions));

  // ---- Link 2: a break ends back into focus ----
  await page.evaluate(() => {
    const t = window.BananaFocus.timer;
    t.switchMode('break'); t.timeLeft = 1; t.start();
  });
  await wait(1600);
  s = await page.evaluate(() => {
    const t = window.BananaFocus.timer; t.pause();
    return { mode: t.mode, running: t.isRunning, badge: document.getElementById('mode-badge').textContent.trim(), alarms: window.__alarms };
  });
  check('break ends back into focus mode', s.mode === 'focus', JSON.stringify(s));
  check('badge flips back to Focus', s.badge === 'Focus', s.badge);
  check('alarm fires again at break end', s.alarms === 2, String(s.alarms));

  // ---- Progress ring advances during a running focus session ----
  const ring = await page.evaluate(async () => {
    const t = window.BananaFocus.timer;
    t.switchMode('focus'); t.durations.focus = 4; t.timeLeft = 4; t.start();
    await new Promise((r) => setTimeout(r, 2100));
    const off = Number(document.querySelector('.progress-ring__fill').getAttribute('stroke-dashoffset'));
    t.pause();
    return { off, full: 2 * Math.PI * 90 };
  });
  check('progress ring advances with the timer', ring.off > 0 && ring.off < ring.full, JSON.stringify(ring));

  // ---- Manual skip: moves mode but stays paused, no alarm ----
  await page.evaluate(() => { const t = window.BananaFocus.timer; t.pause(); t.switchMode('focus'); t.timeLeft = t.durations.focus; });
  await page.click('#skip-btn');
  s = await page.evaluate(() => ({
    mode: window.BananaFocus.timer.mode,
    running: window.BananaFocus.timer.isRunning,
    alarms: window.__alarms, badge: document.getElementById('mode-badge').textContent.trim()
  }));
  check('skip moves focus -> break', s.mode === 'break', JSON.stringify(s));
  check('skip leaves the timer paused', s.running === false, JSON.stringify(s));
  check('skip plays no alarm', s.alarms === 2, String(s.alarms));
  check('skip updates the badge', s.badge === 'Break', s.badge);

  // Restore the production durations before checking reset targets.
  await page.evaluate(() => {
    const t = window.BananaFocus.timer;
    t.durations.focus = 25 * 60;
    t.durations.break = 5 * 60;
  });

  // ---- Reset inside a break returns to 05:00 ----
  await page.click('#reset-btn');
  const brk = await page.$eval('#timer', (e) => e.textContent.trim());
  check('reset while in break shows 05:00', brk === '05:00', brk);
  await page.evaluate(() => { const t = window.BananaFocus.timer; t.switchMode('focus'); t.timeLeft = t.durations.focus; });
  await page.click('#reset-btn');
  const foc = await page.$eval('#timer', (e) => e.textContent.trim());
  check('reset while in focus shows 25:00', foc === '25:00', foc);

  // ---- Reward loop: the 4th completed focus session drops confetti ----
  const reward = await page.evaluate(async () => {
    const t = window.BananaFocus.timer;
    t.completedFocusSessions = 0;
    t.durations.focus = 1;
    for (let i = 0; i < 4; i++) {
      t.switchMode('focus'); t.timeLeft = 1; t.start();
      await new Promise((r) => setTimeout(r, 1500));
      t.pause();
    }
    return { sessions: t.completedFocusSessions, confetti: document.querySelectorAll('.confetti-layer').length };
  });
  check('four focus sessions completed', reward.sessions === 4, JSON.stringify(reward));
  check('reward confetti appears on the 4th', reward.confetti >= 1, JSON.stringify(reward));

  check('no console/page errors during the whole cycle', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
