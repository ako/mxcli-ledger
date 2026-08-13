// Variant sweep on top of m.mjs: mutate the spec in memory, measure, repeat.
// Used to find which property actually pins the facet row pitch.
import * as vl from 'vega-lite';
import * as vega from 'vega';
import fs from 'fs';
import { execSync } from 'child_process';

const base = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const cats = ['Salary', 'Rent', 'Freelance', 'Savings transfer', 'Groceries', 'Insurance',
  'Shopping', 'Restaurants & cafes', 'Utilities', 'Transport', 'Health & sport',
  'Internet & phone', 'Subscriptions', 'Needs review'];
const table = [];
cats.forEach((cat, i) => {
  const scale = 40000 / (i + 1);
  for (let mo = 0; mo < 20; mo++) {
    table.push({ k: 'm', cat, kind: i === 0 ? 'Income' : 'Expense', ord: scale,
      t: new Date(Date.UTC(2025, mo, 1)).toISOString(), v: scale / 12 * (1 + 0.2 * Math.sin(mo)) });
  }
  table.push({ k: 's', cat, kind: i === 0 ? 'Income' : 'Expense', ord: scale,
    current: scale, prior: scale * 0.9, delta: scale * 0.1, recur: scale * 0.4 });
});

async function measure(spec, label) {
  const view = new vega.View(vega.parse(vl.compile(spec).spec), { renderer: 'none' }).data('table', table);
  await view.runAsync();
  const rows = {};
  (function walk(item, panel) {
    for (const child of item.items || []) {
      const p = /cell$/.test(child.name || '') ? child.name : panel;
      if (p && child.y !== undefined && !child.name && child.items) (rows[p] ??= []).push(child.y);
      walk(child, p);
    }
  })(view.scenegraph().root, null);
  const out = Object.entries(rows).filter(([, ys]) => ys.length >= 5).map(([p, ys]) => {
    const s = [...new Set(ys)].sort((a, b) => a - b);
    return `${p.replace('concat_1_concat_', 'p')}=[${s.length}r ${s[0]}..${s[s.length - 1]} gaps ${[...new Set(s.slice(1).map((y, i) => +(y - s[i]).toFixed(1)))].join('/')}]`;
  });
  console.log(label.padEnd(34), out.join(' '));
}

const panels = s => s.vconcat[1].hconcat;

const variants = {
  'baseline': s => s,
  'explicit spacing on facets': s => { panels(s).forEach(p => { p.spacing = 3; }); return s; },
  'no resolve on panel 0': s => { delete panels(s)[0].resolve; return s; },
  'no header labels': s => { panels(s)[0].facet.row.header = { labels: false }; return s; },
  'bounds flush on panels': s => { panels(s).forEach(p => { p.bounds = 'flush'; }); return s; },
  'bounds flush + hconcat flush': s => { panels(s).forEach(p => { p.bounds = 'flush'; }); s.vconcat[1].bounds = 'flush'; return s; },
};

for (const [label, fn] of Object.entries(variants)) {
  await measure(fn(JSON.parse(JSON.stringify(base))), label);
}
