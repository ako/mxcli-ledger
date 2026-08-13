// Local geometry harness. Compiles the dashboard spec, runs it headless with
// synthetic rows shaped like the real dataset, and walks the scenegraph to
// print the absolute y of every facet row in every hconcat panel. Deploying to
// measure a three-pixel drift costs three minutes; this costs three seconds.
import * as vl from 'vega-lite';
import * as vega from 'vega';
import fs from 'fs';

const SPEC = process.argv[2] || '/tmp/claude-0/-home-user-mxcli-ledger/629cbed3-e67b-563c-9c92-cbc505b83f0f/scratchpad/overview.vl.json';
const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));

const cats = ['Salary', 'Rent', 'Freelance', 'Savings transfer', 'Groceries', 'Insurance',
  'Shopping', 'Restaurants & cafes', 'Utilities', 'Transport', 'Health & sport',
  'Internet & phone', 'Subscriptions', 'Needs review'];

const table = [];
cats.forEach((cat, i) => {
  const scale = 40000 / (i + 1);
  for (let mo = 0; mo < 20; mo++) {
    table.push({
      k: 'm', cat, kind: i === 0 ? 'Income' : 'Expense', ord: scale,
      t: new Date(Date.UTC(2025, mo, 1)).toISOString(),
      v: scale / 12 * (1 + 0.2 * Math.sin(mo))
    });
  }
  table.push({
    k: 's', cat, kind: i === 0 ? 'Income' : 'Expense', ord: scale,
    current: scale, prior: scale * 0.9, delta: scale * 0.1, recur: scale * 0.4
  });
});

const view = new vega.View(vega.parse(vl.compile(spec).spec), { renderer: 'none' })
  .data('table', table);
await view.runAsync();

const rows = {};
(function walk(item, ox, oy, panel) {
  if (!item) return;
  const name = item.name || '';
  if (/cell|row_header/.test(name)) panel = name;
  for (const child of item.items || []) {
    if (child.marktype === 'group' || child.items) {
      const x = ox + (child.x || 0), y = oy + (child.y || 0);
      if (panel && !child.name && child.marktype !== 'group') (rows[panel] ??= []).push(y);
      if (panel && child.marktype === undefined && child.items) (rows[panel] ??= []).push(y);
      walk(child, x, y, panel);
    }
  }
})(view.scenegraph().root, 0, 0, null);

for (const [panel, ys] of Object.entries(rows)) {
  const s = [...new Set(ys)].sort((a, b) => a - b);
  if (s.length < 5) continue;
  const gaps = [...new Set(s.slice(1).map((y, i) => +(y - s[i]).toFixed(2)))];
  console.log(`${panel}: rows=${s.length} first=${s[0]} last=${s[s.length - 1]} gaps=${gaps.join(',')}`);
}
