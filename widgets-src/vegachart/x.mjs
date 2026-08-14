// Pull a Vega-Lite spec back out of an MDL page file so it can be compiled and
// measured locally. The spec lives inside a single-quoted MDL string, so the
// unescaping is \' and '' back to ' — MDL takes the doubled form, and a Vega
// expression that quotes a string literal (a month-name lookup, say) is written
// that way in the source.
import fs from 'fs';

const [, , file, out] = process.argv;
const src = fs.readFileSync(file, 'utf8');
const start = src.indexOf("spec: '{");
if (start < 0) throw new Error('no spec in ' + file);
let i = start + "spec: '".length, depth = 0, end = -1;
for (; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const spec = src.slice(start + "spec: '".length, end).replace(/\\'/g, "'").replace(/''/g, "'");
JSON.parse(spec);
fs.writeFileSync(out, spec);
console.log('extracted', spec.length, 'chars ->', out);
