// Render the sparkline spec at its real cell size, once per report mode, from
// one real row: Shopping, whose May carries a budget override. The point of the
// sweep is that the same spec has to read correctly whether `b` is a budget, a
// zero, or absent — the question "does the line match the cells beside it?" is
// not one the scenegraph can answer.
import * as vl from 'vega-lite';
import * as vega from 'vega';
import fs from 'fs';
import { chromium } from 'playwright-core';

const base = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const actual = [214, 282, 221, 367, 156, 230, 285, 391];
const budget = [260, 260, 260, 260, 480, 260, 260, 260, 260, 260, 260, 260];
const euro = n => '€ ' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
const signed = n => (n >= 0 ? '+' : '−') + '€ ' + Math.abs(n);

// What DS_CashflowRows emits, per mode.
const modes = {
  Actual: () => budget.map((b, i) => ({
    m: i + 1, a: actual[i] ?? null, b, u: actual[i] - b > b * 0.02 ? 1 : 0,
    t: actual[i] === undefined ? '' : `${euro(actual[i])} of ${euro(b)}`
  })),
  Variance: () => budget.map((b, i) => ({
    m: i + 1, a: actual[i] === undefined ? null : b - actual[i], b: 0,
    u: actual[i] - b > b * 0.02 ? 1 : 0,
    t: actual[i] === undefined ? '' : signed(b - actual[i])
  })),
  Budget: () => budget.map((b, i) => ({ m: i + 1, a: null, s: b, b: null, u: 0, t: euro(b) }))
};

const cells = [];
for (const [label, build] of Object.entries(modes)) {
  const spec = JSON.parse(JSON.stringify(base));
  spec.datasets = { table: build() };
  const view = new vega.View(vega.parse(vl.compile(spec).spec), { renderer: 'none' });
  await view.runAsync();
  cells.push(`<tr><td style="font:12px sans-serif;padding-right:18px">${label}</td>
    <td style="padding:6px 14px">${await view.toSVG()}</td></tr>`);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ deviceScaleFactor: 6 });
await page.setContent(`<body style="background:#FAF9F6;margin:8px;width:260px"><table>${cells.join('')}</table></body>`);
await page.screenshot({ path: process.argv[3], fullPage: true });
await browser.close();
console.log('shot ->', process.argv[3]);
