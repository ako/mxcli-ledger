// Compare candidate sparkline treatments at the real cell size, against real
// figures from the matrix. Renders every variant into one page and shoots it,
// because the question — "can you read the shape at 126x26?" — is not one the
// scenegraph can answer.
import * as vl from 'vega-lite';
import * as vega from 'vega';
import fs from 'fs';
import { chromium } from 'playwright-core';

const base = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// Groceries, Utilities, Rent, Net — flat, spiky, drifting, and large. Eight
// elapsed months and four that have not happened, as the app has today.
const rows = {
  Groceries: { a: [671, 653, 655, 634, 544, 698, 630, 566], b: 650 },
  Utilities: { a: [211, 160, 217, 238, 224, 215, 195, 153], b: 200 },
  Rent: { a: [1557, 1319, 1331, 1397, 1425, 1518, 1680, 1587], b: 1450 },
  Net: { a: [2158, 2402, 1876, 2011, 2263, 2519, 1994, 2102], b: 2100 }
};

function table(name) {
  const { a, b } = rows[name];
  return Array.from({ length: 12 }, (_, i) => ({
    m: i + 1, a: a[i] ?? null, b, u: a[i] > b * 1.02 ? 1 : 0
  }));
}

const variants = {
  'as authored': s => s,
  'band filtered to elapsed': s => {
    s.layer[0].transform = [{ filter: 'isValid(datum.a)' }];
    return s;
  }
};

const html = [];
for (const [label, mutate] of Object.entries(variants)) {
  const cells = [];
  for (const name of Object.keys(rows)) {
    const spec = mutate(JSON.parse(JSON.stringify(base)));
    spec.datasets = { table: table(name) };
    const view = new vega.View(vega.parse(vl.compile(spec).spec), { renderer: 'none' });
    await view.runAsync();
    cells.push(`<td style="padding:6px 14px">${await view.toSVG()}</td><td style="font:11px sans-serif;color:#8A8378">${name}</td>`);
  }
  html.push(`<tr><td style="font:12px sans-serif;padding-right:18px">${label}</td>${cells.join('')}</tr>`);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ deviceScaleFactor: 6 });
await page.setContent(`<body style="background:#FAF9F6;margin:8px;width:620px"><table>${html.join('')}</table></body>`);
await page.screenshot({ path: process.argv[3], fullPage: true });
await browser.close();
console.log('shot ->', process.argv[3]);
