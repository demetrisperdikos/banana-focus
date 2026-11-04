// Browser checks for the Pomodoro Focus Timer.
// Usage: node check-site.js <url>   (example: node check-site.js http://localhost:8080/)
// Uses the system Chromium (/usr/bin/chromium) or CHROMIUM_PATH.
// Exit code 0 = all checks passed, 1 = at least one failed, 2 = bad usage.

const { chromium } = require('playwright-core');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node check-site.js <url>');
  process.exit(2);
}

const CHROME = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

// fn throws to fail; may return a short detail string on pass
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === 'string' ? detail : '');
  } catch (e) {
    record(name, false, String(e.message).split('\n')[0]);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });

  const newPage = async (viewport = { width: 1280, height: 800 }) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.consoleErrors = [];
    page.pageErrors = [];
    page.externalRequests = [];
    page.on('console', (m) => { if (m.type() === 'error') page.consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => page.pageErrors.push(e.message));
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (!['about:', 'data:', 'blob:'].includes(u.protocol) && u.origin !== new URL(url).origin) {
        page.externalRequests.push(r.url());
      }
    });
    return page;
  };

  const timerText = (page) => page.locator('[data-testid="timer"], #timer, .timer-display, [role="timer"]').first().innerText();
  const startBtn = (page) => page.getByRole('button', { name: /start|pause/i }).first();
  const resetBtn = (page) => page.getByRole('button', { name: /reset/i }).first();
  const skipBtn = (page) => page.getByRole('button', { name: /skip/i }).first();
  const soundBtn = (page) => page.getByRole('button', { name: /sound|mute/i }).first();
  const taskInput = (page) => page.getByPlaceholder('Add a task...');
  const addBtn = (page) => page.getByRole('button', { name: /^add$/i }).first();
  const taskItems = (page) => page.getByRole('listitem');

  // ---------- Page load and UI ----------
  let page = await newPage();
  await check('Page loads without HTTP error', async () => {
    const res = await page.goto(url, { waitUntil: 'load', timeout: 15000 });
    assert(res && res.ok(), `status ${res && res.status()}`);
  });

  await check('Page title is set', async () => {
    const t = await page.title();
    assert(t.trim().length > 0, 'empty <title>');
    return `"${t}"`;
  });

  await check('Header shows "Pomodoro Focus"', async () => {
    await page.getByText('Pomodoro Focus', { exact: false }).first().waitFor({ timeout: 3000 });
  });

  await check('Mode badge shows "Focus" on load', async () => {
    await page.getByText(/^focus$/i).first().waitFor({ timeout: 3000 });
  });

  await check('Timer shows 25:00 on load', async () => {
    const t = (await timerText(page)).trim();
    assert(t === '25:00', `got "${t}"`);
  });

  await check('Timer display format is MM:SS', async () => {
    const t = (await timerText(page)).trim();
    assert(/^\d{2}:\d{2}$/.test(t), `got "${t}"`);
  });

  await check('Start/Pause, Reset, Skip, Sound buttons exist', async () => {
    for (const [n, b] of [['Start/Pause', startBtn(page)], ['Reset', resetBtn(page)], ['Skip', skipBtn(page)], ['Sound', soundBtn(page)]]) {
      await b.waitFor({ timeout: 3000 }).catch(() => { throw new Error(`${n} button missing`); });
    }
  });

  // ---------- Timer behaviour ----------
  await check('Start/Pause toggles the countdown', async () => {
    const before = (await timerText(page)).trim();
    await startBtn(page).click();
    await page.waitForTimeout(1500);
    const running = (await timerText(page)).trim();
    assert(running !== before, `display stayed at ${before} while running`);
    await startBtn(page).click();
    await page.waitForTimeout(300);
    const paused1 = (await timerText(page)).trim();
    await page.waitForTimeout(1500);
    const paused2 = (await timerText(page)).trim();
    assert(paused1 === paused2, `still counting while paused (${paused1} -> ${paused2})`);
  });

  await check('Reset returns to 25:00 in Focus mode', async () => {
    await startBtn(page).click();
    await page.waitForTimeout(1200);
    await resetBtn(page).click();
    const t = (await timerText(page)).trim();
    assert(t === '25:00', `got "${t}"`);
  });

  await check('Skip switches to Break and shows 05:00', async () => {
    await skipBtn(page).click();
    await page.getByText(/^break$/i).first().waitFor({ timeout: 3000 });
    const t = (await timerText(page)).trim();
    assert(t === '05:00', `got "${t}"`);
    await skipBtn(page).click(); // back to Focus for later checks
  });

  await check('Reset in Break returns to 05:00', async () => {
    await skipBtn(page).click();
    await startBtn(page).click();
    await page.waitForTimeout(1200);
    await resetBtn(page).click();
    const t = (await timerText(page)).trim();
    assert(t === '05:00', `got "${t}"`);
    await skipBtn(page).click();
  });

  await check('Sound toggle changes its state', async () => {
    const b = soundBtn(page);
    const before = (await b.getAttribute('aria-pressed')) + '|' + (await b.innerText());
    await b.click();
    const after = (await b.getAttribute('aria-pressed')) + '|' + (await b.innerText());
    assert(before !== after, 'sound toggle did not change state');
  });

  // ---------- Tasks ----------
  await check('Add task with Enter key', async () => {
    const before = await taskItems(page).count();
    await taskInput(page).fill('QA enter task');
    await taskInput(page).press('Enter');
    await page.getByText('QA enter task').waitFor({ timeout: 3000 });
    assert((await taskItems(page).count()) === before + 1, 'task count did not increase by 1');
  });

  await check('Add task with Add button', async () => {
    await taskInput(page).fill('QA button task');
    await addBtn(page).click();
    await page.getByText('QA button task').waitFor({ timeout: 3000 });
    assert(await taskInput(page).inputValue() === '', 'input not cleared after add');
  });

  await check('Empty task is not added', async () => {
    const before = await taskItems(page).count();
    await taskInput(page).fill('   ');
    await taskInput(page).press('Enter');
    await page.waitForTimeout(300);
    assert((await taskItems(page).count()) === before, 'blank task was added');
  });

  await check('Checkbox marks task done', async () => {
    const cb = page.getByRole('checkbox').first();
    await cb.click();
    assert(await cb.isChecked(), 'checkbox not checked after click');
  });

  await check('Task list survives a page refresh (localStorage)', async () => {
    await page.reload({ waitUntil: 'load' });
    await page.getByText('QA enter task').waitFor({ timeout: 3000 });
    const stored = await page.evaluate(() => localStorage.getItem('pomodoro_tasks'));
    assert(stored && stored.includes('QA enter task'), 'pomodoro_tasks key missing or incomplete');
    const parsed = JSON.parse(stored);
    assert(Array.isArray(parsed), 'pomodoro_tasks is not a JSON array');
  });

  await check('Completed state survives refresh', async () => {
    const checked = await page.getByRole('checkbox').first().isChecked();
    assert(checked, 'checked state lost after refresh');
  });

  await check('Filters All / Active / Completed show the right subset', async () => {
    const all = await taskItems(page).count();
    await page.getByRole('button', { name: /^completed$/i }).or(page.getByRole('link', { name: /^completed$/i })).first().click();
    const done = await taskItems(page).count();
    await page.getByRole('button', { name: /^active$/i }).or(page.getByRole('link', { name: /^active$/i })).first().click();
    const active = await taskItems(page).count();
    await page.getByRole('button', { name: /^all$/i }).or(page.getByRole('link', { name: /^all$/i })).first().click();
    const all2 = await taskItems(page).count();
    assert(all2 === all, `All view changed after switching filters (${all} -> ${all2})`);
    assert(done + active === all, `Completed (${done}) + Active (${active}) != All (${all})`);
  });

  await check('Clear Completed removes completed tasks', async () => {
    const btn = page.getByRole('button', { name: /clear completed/i }).first();
    const before = await taskItems(page).count();
    await btn.click();
    await page.waitForTimeout(300);
    const after = await taskItems(page).count();
    assert(after < before, `count ${before} -> ${after}`);
    const stored = await page.evaluate(() => localStorage.getItem('pomodoro_tasks'));
    assert(!/"completed":true/.test(stored || ''), 'completed tasks still in localStorage');
  });

  await check('Delete button removes a task and updates localStorage', async () => {
    await taskInput(page).fill('QA delete me');
    await taskInput(page).press('Enter');
    await page.getByText('QA delete me').waitFor({ timeout: 3000 });
    const row = page.getByRole('listitem').filter({ hasText: 'QA delete me' }).first();
    await row.getByRole('button', { name: /delete/i }).click();
    await page.waitForTimeout(300);
    assert((await page.getByText('QA delete me').count()) === 0, 'task still visible');
    const stored = await page.evaluate(() => localStorage.getItem('pomodoro_tasks'));
    assert(!(stored || '').includes('QA delete me'), 'task still in localStorage');
  });

  await check('XSS: script-like task text is shown as plain text', async () => {
    const payload = '<img src=x onerror="window.__qa_xss=1">';
    await taskInput(page).fill(payload);
    await taskInput(page).press('Enter');
    await page.getByText('<img src=x', { exact: false }).first().waitFor({ timeout: 3000 });
    const fired = await page.evaluate(() => window.__qa_xss === 1);
    assert(!fired, 'injected onerror handler ran');
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
  });

  // ---------- Accessibility and keyboard ----------
  await check('Every button has an accessible name', async () => {
    const names = await page.getByRole('button').evaluateAll((els) =>
      els.map((e) => (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || '').trim()));
    const bad = names.map((n, i) => (n ? null : i)).filter((x) => x !== null);
    assert(bad.length === 0, `${bad.length} unnamed button(s)`);
  });

  await check('Every text input has a label or aria-label', async () => {
    const bad = await page.locator('input:not([type=checkbox]):not([type=hidden])').evaluateAll((els) =>
      els.filter((e) => !e.getAttribute('aria-label') && !e.labels?.length && !e.getAttribute('placeholder')).length);
    assert(bad === 0, `${bad} unlabelled input(s)`);
  });

  await check('Keyboard: Tab reaches the Start/Pause button', async () => {
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => /start|pause/i.test((document.activeElement && (document.activeElement.getAttribute('aria-label') || document.activeElement.innerText)) || ''));
    }
    assert(reached, 'Start/Pause not reachable with Tab in 25 presses');
  });

  await check('No console errors or uncaught exceptions', async () => {
    assert(page.pageErrors.length === 0, `uncaught: ${page.pageErrors.join('; ')}`);
    assert(page.consoleErrors.length === 0, `console errors: ${page.consoleErrors.join('; ')}`);
  });

  await check('No external requests (no CDN, everything bundled)', async () => {
    assert(page.externalRequests.length === 0, `external: ${[...new Set(page.externalRequests)].join(', ')}`);
  });

  // ---------- Responsive ----------
  for (const [label, vp] of [['320px phone', { width: 320, height: 568 }], ['1920px desktop', { width: 1920, height: 1080 }]]) {
    await check(`Layout has no horizontal scroll at ${label}`, async () => {
      const p = await newPage(vp);
      await p.goto(url, { waitUntil: 'load' });
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(over <= 0, `overflows by ${over}px`);
      await p.context().close();
    });
  }

  await check('Timer and main buttons are inside the 320px viewport', async () => {
    const p = await newPage({ width: 320, height: 568 });
    await p.goto(url, { waitUntil: 'load' });
    for (const b of [startBtn(p), resetBtn(p), skipBtn(p)]) {
      const box = await b.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= 320, `button outside viewport: ${JSON.stringify(box)}`);
    }
    await p.context().close();
  });

  // ---------- Performance ----------
  await check('Loads quickly (DOMContentLoaded under 1.5s locally)', async () => {
    const p = await newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    const ms = await p.evaluate(() => performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd);
    assert(ms < 1500, `${Math.round(ms)}ms`);
    return `${Math.round(ms)}ms`;
  });

  await check('Start/pause survives 50 cycles without errors', async () => {
    const p = await newPage();
    await p.goto(url, { waitUntil: 'load' });
    for (let i = 0; i < 50; i++) {
      await startBtn(p).click();
      await startBtn(p).click();
    }
    assert(p.pageErrors.length === 0, p.pageErrors.join('; '));
    await p.context().close();
  });

  await browser.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('Harness error:', e);
  process.exit(1);
});
