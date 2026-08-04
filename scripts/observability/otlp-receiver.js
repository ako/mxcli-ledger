// Minimal OTLP/HTTP receiver. Decodes protobuf TracesData with a generic wire walker
// (no deps) and appends one JSON object per span to spans.jsonl.
const http = require('http'), fs = require('fs'), zlib = require('zlib');
const out = process.argv[2] || 'spans.jsonl';
const stream = fs.createWriteStream(out, { flags: 'a' });
let batches = 0, spans = 0;

// --- generic protobuf reader -------------------------------------------------
function fields(buf) {                       // -> Map<fieldNo, [values]>
  const m = new Map(); let i = 0;
  while (i < buf.length) {
    let key = 0, shift = 0, b;
    do { b = buf[i++]; key |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const no = key >>> 3, wire = key & 7;
    let val;
    if (wire === 0) { let v = 0n, s = 0n; do { b = buf[i++]; v |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80); val = v; }
    else if (wire === 1) { val = buf.readBigUInt64LE(i); i += 8; }
    else if (wire === 2) { let len = 0, s2 = 0; do { b = buf[i++]; len |= (b & 0x7f) << s2; s2 += 7; } while (b & 0x80); val = buf.subarray(i, i + len); i += len; }
    else if (wire === 5) { val = BigInt(buf.readUInt32LE(i)); i += 4; }
    else throw new Error('wire ' + wire);
    if (!m.has(no)) m.set(no, []);
    m.get(no).push(val);
  }
  return m;
}
const one = (m, n) => (m.get(n) || [])[0];
const many = (m, n) => m.get(n) || [];
const str = b => (b ? b.toString('utf8') : undefined);
const hex = b => (b ? b.toString('hex') : undefined);

function anyValue(buf) {
  const f = fields(buf);
  if (f.has(1)) return str(one(f, 1));
  if (f.has(2)) return one(f, 2) === 1n;
  if (f.has(3)) return Number(one(f, 3));
  if (f.has(4)) return Buffer.from(one(f, 4)).readDoubleLE(0);
  return null;
}
function attrs(list) {
  const o = {};
  for (const kv of list) { const f = fields(kv); const k = str(one(f, 1)); const v = one(f, 2); if (k) o[k] = v ? anyValue(v) : null; }
  return o;
}

function decode(buf) {
  const root = fields(buf);
  const outSpans = [];
  for (const rs of many(root, 1)) {
    const rsf = fields(rs);
    const res = one(rsf, 1) ? attrs(many(fields(one(rsf, 1)), 1)) : {};
    for (const ss of many(rsf, 2)) {
      const ssf = fields(ss);
      const scope = one(ssf, 1) ? str(one(fields(one(ssf, 1)), 1)) : undefined;
      for (const sp of many(ssf, 2)) {
        const f = fields(sp);
        const start = one(f, 7) || 0n, end = one(f, 8) || 0n;
        outSpans.push({
          traceId: hex(one(f, 1)), spanId: hex(one(f, 2)), parentSpanId: hex(one(f, 4)),
          name: str(one(f, 5)), kind: Number(one(f, 6) || 0n),
          startNano: start.toString(), endNano: end.toString(),
          durMs: Number(end - start) / 1e6,
          scope, attrs: attrs(many(f, 9)), service: res['service.name'],
        });
      }
    }
  }
  return outSpans;
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    let buf = Buffer.concat(chunks);
    if (req.headers['content-encoding'] === 'gzip') { try { buf = zlib.gunzipSync(buf); } catch (e) {} }
    if (req.url.startsWith('/v1/traces')) {
      try {
        const list = (req.headers['content-type'] || '').includes('json')
          ? (JSON.parse(buf.toString()).resourceSpans || []).flatMap(rs => (rs.scopeSpans || []).flatMap(ss => ss.spans || []))
          : decode(buf);
        for (const s of list) { stream.write(JSON.stringify(s) + '\n'); spans++; }
        batches++;
        if (batches % 25 === 0) console.log(`batches=${batches} spans=${spans}`);
      } catch (e) { console.error('decode fail:', e.message, 'len=', buf.length); }
    }
    res.writeHead(200, { 'Content-Type': 'application/x-protobuf' });
    res.end();
  });
}).listen(4318, '127.0.0.1', () => console.log('OTLP receiver (protobuf+json) on 127.0.0.1:4318'));
