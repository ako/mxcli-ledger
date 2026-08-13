// Row order check. Prints the facet row domain of every hconcat panel, so a
// panel that has silently fallen back to alphabetical order is visible without
// deploying. Rows only mean anything if all four columns name the same one.
import * as vl from 'vega-lite';
import * as vega from 'vega';
import fs from 'fs';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cats = ['Salary', 'Rent', 'Freelance', 'Savings transfer', 'Groceries', 'Insurance',
  'Shopping', 'Restaurants & cafes', 'Utilities', 'Transport', 'Health & sport',
  'Internet & phone', 'Subscriptions', 'Needs review'];
const table = [];
cats.forEach((cat, i) => {
  const s = 40000 / (i + 1);
  for (let mo = 0; mo < 20; mo++) {
    // Two accounts per month for one category, to prove the per-month sum.
    const n = cat === 'Groceries' ? 2 : 1;
    for (let a = 0; a < n; a++) {
      table.push({ k: 'm', cat, kind: i === 0 ? 'Income' : 'Expense', ord: s,
        t: new Date(Date.UTC(2025, mo, 1)).toISOString(), v: s / 12 / n * (1 + 0.2 * Math.sin(mo)) });
    }
  }
  table.push({ k: 's', cat, kind: i === 0 ? 'Income' : 'Expense', ord: s,
    current: s, prior: s * 0.9, delta: s * 0.1, recur: s * 0.4 });
});

const view = new vega.View(vega.parse(vl.compile(spec).spec), { renderer: 'none' }).data('table', table);
await view.runAsync();

for (let i = 0; i < 4; i++) {
  const d = view.data(`concat_1_concat_${i}_row_domain`);
  console.log(`panel ${i}:`, d.map(r => r.cat ?? r.value ?? JSON.stringify(r)).join(' | '));
}
