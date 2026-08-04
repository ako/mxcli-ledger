import json, sys, collections
spans=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
byid={s['spanId']:s for s in spans}
kids=collections.defaultdict(list)
for s in spans: kids[s.get('parentSpanId') or ''].append(s)

def root_of(s):
    seen=set()
    while s.get('parentSpanId') and s['parentSpanId'] in byid and s['spanId'] not in seen:
        seen.add(s['spanId']); s=byid[s['parentSpanId']]
    return s

# Attribute every JDBC span to the nearest enclosing Microflow ancestor
def nearest_mf(s):
    seen=set()
    while s.get('parentSpanId') and s['parentSpanId'] in byid and s['spanId'] not in seen:
        seen.add(s['spanId']); s=byid[s['parentSpanId']]
        if s['name'].startswith('Microflow '): return s['name'][10:]
    return '(no microflow ancestor)'

jdbc=[s for s in spans if s.get('scope')=='io.opentelemetry.jdbc']
agg=collections.defaultdict(lambda:[0,0.0])
for s in jdbc:
    k=nearest_mf(s); agg[k][0]+=1; agg[k][1]+=s['durMs']
print(f"{'DB queries attributed to microflow':<44}{'queries':>9}{'db ms':>9}")
for k,(n,ms) in sorted(agg.items(), key=lambda kv:-kv[1][0])[:14]:
    print(f"{k[:43]:<44}{n:>9}{ms:>9.1f}")

# Slowest root request trees
roots=sorted([s for s in spans if not s.get('parentSpanId') or s['parentSpanId'] not in byid], key=lambda s:-s['durMs'])
def show(s, d=0, cap=0):
    n=len(kids[s['spanId']])
    print('  '*d + f"{s['durMs']:8.1f}ms  {s['name'][:64]}" + (f"   [{n} children]" if n and d>=cap else ''))
    if d<cap:
        for c in sorted(kids[s['spanId']], key=lambda x:-x['durMs'])[:6]: show(c,d+1,cap)
for r in roots[:3]:
    print(f"\n=== root: {r['name']} {r['durMs']:.0f}ms  (target={r['attrs'].get('http.route') or r['attrs'].get('url.path','')}) ===")
    show(r, 0, 3)
