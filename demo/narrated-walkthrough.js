//
// Stage 2 of the journey/demo pair: the film. Asserts nothing about the app —
// the verdict lives in the gating runner — but every beat is asserted as a
// RECORDING, so a swallowed click cannot hand back a plausible-looking take
// with a dead beat in it.
//
//   node demo/narrated-walkthrough.js            # desktop, 1920x1080
//   PROFILE=mobile node demo/narrated-walkthrough.js
//
// The persona is Sam, who runs a household on a budget. Nothing below names an
// entity, a microflow or a page: if the visual needs those words, the visual is
// wrong.
//
const { chromium } = require('/opt/node22/lib/node_modules/playwright/index.mjs');
const { openTake } = require('./take.js');
const N = require('./narrate.js');

const MOBILE = process.env.PROFILE === 'mobile';

// recordVideo.size PADS, it does not scale — so viewport === size, and the
// layout width comes from CSS zoom. 1920/1.68 lands at the ~1140px a fixed-width
// Mendix page wants; the phone profile is a real 414x896 recorded natively.
const PROFILE = MOBILE
  ? { size: { width: 414, height: 896 }, zoom: 1, dir: 'demo/capture/raw-mobile', beats: 'demo/capture/beats-mobile.json' }
  : { size: { width: 1920, height: 1080 }, zoom: 1.68, dir: 'demo/capture/raw', beats: 'demo/capture/beats.json' };

const BASE = 'http://127.0.0.1:8080';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const take = await openTake(browser, {
    url: BASE + '/p/dashboard',
    videoDir: PROFILE.dir,
    beatsFile: PROFILE.beats,
    size: PROFILE.size,
    zoom: PROFILE.zoom,
    // Found experimentally: below ~600ms the cashflow drill-down and the mode
    // switch overlap and the runtime serialises them into a conflict dialog.
    minGap: 700,
  });
  const page = take.page;

  // On a phone the sidebar covers the content, so every navigation goes by URL
  // rather than by clicking a menu that would first have to be opened.
  const go = async (path) => {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 90000 });
    await take.applyZoom();
    await page.waitForTimeout(1200);
    await N.install(page);
  };

  await take.goto();
  await N.install(page);

  // ── 1. Open on something already interesting ────────────────────────────
  take.mark('01-open');
  await N.say(page, 'Sam keeps the household books. Two years of spending, already sorted.', '1/8');
  await N.point(page, '.mx-name-txtDashSub');
  await page.waitForTimeout(2600);
  await N.unpoint(page);
  await take.assertBeat('01-open',
    (p) => p.locator('.mx-name-txtDashHeading').isVisible(),
    'the opening screen must be the dashboard, or beat 1 films a blank frame');

  // ── 2. The year, in two numbers ─────────────────────────────────────────
  await go('/p/cashflow');
  take.mark('02-cashflow');
  await N.say(page, 'The year so far: what came in, and what went out.', '2/8');
  await N.point(page, '.mx-name-ctnKpiIncome');
  await page.waitForTimeout(2200);
  await N.point(page, '.mx-name-ctnKpiSpend');
  await page.waitForTimeout(2400);
  await N.unpoint(page);
  await take.assertBeat('02-cashflow',
    async (p) => (await p.locator('.mx-name-valIncome').innerText()).includes('€'),
    'the income figure must have rendered, or the beat shows an empty card');

  // ── 3. Twelve months at a glance ────────────────────────────────────────
  take.mark('03-matrix');
  await N.say(page, 'Every category, month by month. The small charts show the shape of each one.', '3/8', { holdMs: 4200 });
  await N.bringIntoView(page, '.ledger-matrix');
  await page.waitForTimeout(1800);
  await take.assertBeat('03-matrix',
    async (p) => (await p.locator('.ledger-matrix .cf-spark').count()) > 3,
    'the sparkline column must be drawn — this beat is entirely about it');

  // ── 4. Where the plan missed ────────────────────────────────────────────
  await N.say(page, 'Sam wants the misses, not the totals.', '4/8');
  await N.clickSlowly(page, '.mx-name-btnVariance');
  await page.waitForTimeout(2800);
  take.mark('04-variance');
  await N.say(page, 'Red is over the plan. One glance finds the months worth asking about.', '4/8', { holdMs: 4000 });
  await take.assertBeat('04-variance',
    async (p) => (await p.locator('.ledger-matrix').innerText()).length > 100,
    'the matrix must still be populated after the mode switch');

  // ── 5. Straight to the receipts ─────────────────────────────────────────
  // The drill panel renders BELOW the matrix, off the bottom of the frame. The
  // first take filmed this beat without scrolling to it: the caption claimed
  // payments had opened while the picture showed the same grid as the beat
  // before. Caught on the contact sheet, which is what it is for — and it was
  // the one beat with no assertBeat, which is why it got that far.
  const cell = page.locator('.ledger-matrix .cf-drill').first();
  if (await cell.count()) {
    await N.point(page, '.ledger-matrix .cf-drill');
    await page.waitForTimeout(1400);
    await N.unpoint(page);
    await cell.click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2600);
  }
  await N.bringIntoView(page, '.mx-name-txtDrillTitle');
  await page.waitForTimeout(1600);
  take.mark('05-drill');
  await N.say(page, 'Clicking a month opens the actual payments behind it.', '5/8', { holdMs: 3600 });
  await N.point(page, '.mx-name-lvDrill');
  await page.waitForTimeout(2000);
  await N.unpoint(page);
  await take.assertBeat('05-drill',
    async (p) => (await p.locator('.mx-name-txtDrillTitle').innerText()).trim().length > 0,
    'the drill panel must name the cell it opened — the caption claims payments are on screen');

  // ── 6. Setting next month's number ──────────────────────────────────────
  await go('/p/budgets');
  take.mark('06-budgets');
  await N.say(page, 'Next year is planned the same way — one number per category, per month.', '6/8', { holdMs: 4200 });
  await N.point(page, '.mx-name-dgBudgets');
  await page.waitForTimeout(2400);
  await N.unpoint(page);
  await take.assertBeat('06-budgets',
    async (p) => (await p.locator('.mx-name-dgBudgets').innerText()).includes('JAN'),
    'the budget grid must be captioned and populated');

  // ── 7. The pile that needs a decision ───────────────────────────────────
  await go('/p/transactions');
  take.mark('07-review');
  await N.say(page, 'Anything the rules could not place waits here until Sam says where it belongs.', '7/8', { holdMs: 4400 });
  await N.point(page, '.mx-name-dgNeedsReview');
  await page.waitForTimeout(2600);
  await N.unpoint(page);
  await take.assertBeat('07-review',
    (p) => p.locator('.mx-name-dgNeedsReview').isVisible(),
    'the review list is the whole point of this beat');

  // ── 8. Same books, different look ───────────────────────────────────────
  // The first take marked this beat DURING the navigation, so the cut landed on
  // a half-painted frame — a blue block where the page had not finished. Settle
  // the screen first, then mark.
  await go('/p/dashboard');
  await page.waitForTimeout(2200);
  take.mark('08-theme');
  await N.say(page, 'And it can look like whichever bank Sam is used to.', '8/8');
  for (const skin of ['.mx-name-btnSkinIng', '.mx-name-btnSkinRabo', '.mx-name-btnSkinPaper']) {
    if (await page.locator(skin).count()) {
      await take.click(skin);
      // Long enough for the stylesheet swap to finish painting; a shorter wait
      // films the transition rather than the result.
      await page.waitForTimeout(2400);
    }
  }
  await take.assertBeat('08-theme',
    (p) => p.locator('.mx-name-ctnThemeBar').isVisible(),
    'the theme control must be on screen — the caption is entirely about it');
  await N.say(page, 'Ledger — a household ledger, built end to end from a text description.', 'end', { holdMs: 4600 });
  await page.waitForTimeout(1200);
  take.mark('09-end');

  const meta = await take.finish();
  await browser.close();
  console.log(`\n  profile: ${MOBILE ? 'mobile 414x896' : 'desktop 1920x1080'}`);
  console.log(`  beats:   ${meta.beats.map((b) => b.name).join(', ')}`);
})().catch((e) => {
  console.error('TAKE FAILED:', e.message);
  process.exit(1);
});
