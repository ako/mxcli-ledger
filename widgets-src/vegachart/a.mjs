// Which header settings give labels that are centred on their row AND flush right?
import * as vl from 'vega-lite'; import * as vega from 'vega'; import fs from 'fs';
const base = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cats = ['Salary','Rent','Freelance','Savings transfer','Groceries','Insurance','Shopping',
  'Restaurants & cafes','Utilities','Transport','Health & sport','Internet & phone','Subscriptions','Needs review'];
const table = [];
cats.forEach((cat, i) => { const s = 40000 / (i + 1);
  for (let mo = 0; mo < 20; mo++) table.push({ k:'m', cat, kind:i===0?'Income':'Expense', ord:s,
    t:new Date(Date.UTC(2025, mo, 1)).toISOString(), v:s/12*(1+0.2*Math.sin(mo)) });
  table.push({ k:'s', cat, kind:i===0?'Income':'Expense', ord:s, current:s, prior:s*0.9, delta:s*0.1, recur:s*0.4 }); });

async function measure(mut, label) {
  const sp = JSON.parse(JSON.stringify(base)); mut(sp.vconcat[1].hconcat[0].facet.row.header);
  const v = new vega.View(vega.parse(vl.compile(sp).spec), { renderer: 'none' }).data('table', table);
  await v.runAsync();
  const svg = await v.toSVG();
  const texts = [...svg.matchAll(/<text[^>]*text-anchor="([^"]*)"[^>]*transform="translate\(([-\d.]+),([-\d.]+)\)"[^>]*>([^<]*)</g)]
    .filter(m => cats.includes(m[4]));
  const anchors = [...new Set(texts.map(m => m[1]))];
  const xs = [...new Set(texts.map(m => Math.round(+m[2])))];
  console.log(label.padEnd(38), 'anchors=' + anchors.join('/'), 'distinct x=' + xs.length, xs.slice(0, 4).join(','));
}
await measure(h => {}, 'as committed');
await measure(h => { delete h.labelAnchor; h.labelAlign = 'right'; }, 'align right, no anchor');
await measure(h => { h.labelAnchor = 'middle'; delete h.labelAlign; }, 'anchor middle only');
await measure(h => { h.labelAnchor = 'middle'; h.labelAlign = 'right'; h.labelExpr = 'datum.value'; }, 'anchor middle + align + labelExpr');
