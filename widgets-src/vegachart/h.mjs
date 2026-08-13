// Where does the row header label actually sit relative to its row? Compares
// the absolute y of each header label against the y centre of the matching
// facet row, for a set of labelAnchor / labelBaseline candidates.
import * as vl from 'vega-lite';
import * as vega from 'vega';
import fs from 'fs';

const base = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cats = ['Salary', 'Rent', 'Freelance', 'Savings transfer', 'Groceries', 'Insurance',
  'Shopping', 'Restaurants & cafes', 'Utilities', 'Transport', 'Health & sport',
  'Internet & phone', 'Subscriptions', 'Needs review'];
const table = [];
cats.forEach((cat, i) => {
  const s = 40000 / (i + 1);
  for (let mo = 0; mo < 20; mo++) {
    table.push({ k: 'm', cat, kind: i === 0 ? 'Income' : 'Expense', ord: s,
      t: new Date(Date.UTC(2025, mo, 1)).toISOString(), v: s / 12 * (1 + 0.2 * Math.sin(mo)) });
  }
  table.push({ k: 's', cat, kind: i === 0 ? 'Income' : 'Expense', ord: s,
    current: s, prior: s * 0.9, delta: s * 0.1, recur: s * 0.4 });
});

async function measure(spec, label) {
  const view = new vega.View(vega.parse(vl.compile(spec).spec), { renderer: 'none' }).data('table', table);
  await view.runAsync();
  const cells = [], labels = [];
  (function walk(item, y0, inHeader) {
    for (const child of item.items || []) {
      const y = y0 + (child.y || 0);
      const hdr = inHeader || /row_header/.test(child.name || '');
      if (/concat_0_cell$/.test(child.name || '')) {
        for (const row of child.items || []) if (row.items) cells.push(y + (row.y || 0));
      }
      if (hdr && child.marktype === 'text') for (const t of child.items || []) labels.push(y + (t.y || 0));
      if (child.items) walk(child, y, hdr);
    }
  })(view.scenegraph().root, 0, false);
  const c = [...new Set(cells)].sort((a, b) => a - b);
  const l = [...new Set(labels)].sort((a, b) => a - b);
  console.log(label.padEnd(28), 'cellTop', c[0], 'labelY', l[0], '->', l[0] !== undefined ? (l[0] - c[0]).toFixed(1) : 'n/a',
    '(row centre would be', (13).toFixed(0) + ')');
}

const hdr = s => s.vconcat[1].hconcat[0].facet.row.header;
await measure(JSON.parse(JSON.stringify(base)), 'as committed');
for (const anchor of ['start', 'middle', 'end']) {
  const s = JSON.parse(JSON.stringify(base));
  hdr(s).labelAnchor = anchor;
  await measure(s, 'labelAnchor ' + anchor);
}
