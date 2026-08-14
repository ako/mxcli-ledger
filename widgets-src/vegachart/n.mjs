// How tall does the dashboard chart get as categories are added?
//
// The widget renders into a div of a fixed `chartHeight`, while the spec's
// facet rows are sized per row — so the answer decides whether a new category
// is free or overflows the card it sits in.
import * as vl from 'vega-lite';
import * as vega from 'vega';
import fs from 'fs';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const chartHeight = Number(process.argv[3] ?? 620);

function table(nCats) {
  const rows = [];
  for (let i = 0; i < nCats; i++) {
    const cat = 'Category ' + (i + 1);
    const kind = i === 0 ? 'Income' : 'Expense';
    const ord = 40000 / (i + 1);
    for (let mo = 0; mo < 20; mo++) {
      rows.push({ k: 'm', cat, kind, ord,
        t: new Date(Date.UTC(2025, mo, 1)).toISOString(),
        v: ord / 12 * (1 + 0.2 * Math.sin(mo)) });
    }
    rows.push({ k: 's', cat, kind, ord,
      current: ord, prior: ord * 0.9, delta: ord * 0.1, recur: ord * 0.4 });
  }
  return rows;
}

for (const n of [13, 14, 15, 16, 20, 26]) {
  const s = JSON.parse(JSON.stringify(spec));
  s.datasets = { table: table(n) };
  const view = new vega.View(vega.parse(vl.compile(s).spec), { renderer: 'none' });
  await view.runAsync();
  const svg = await view.toSVG();
  const h = Number(svg.match(/height="(\d+)"/)[1]);
  console.log(`${String(n).padStart(3)} categories  svg=${String(h).padStart(4)}px  ` +
    `container=${chartHeight}px  ${h > chartHeight ? `OVERFLOWS by ${h - chartHeight}px` : 'fits'}`);
}
