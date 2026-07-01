import json
import sys
from collections import defaultdict

path = sys.argv[1]
needle = sys.argv[2] if len(sys.argv) > 2 else ''
print('loading', path, flush=True)
with open(path, 'r', encoding='utf-8') as f:
    snap = json.load(f)
meta = snap['snapshot']['meta']
fc = len(meta['node_fields'])
types = meta['node_types'][0]
nodes = snap['nodes']
strings = snap['strings']
agg = defaultdict(lambda: [0, 0])
for i in range(0, len(nodes), fc):
    t = types[nodes[i]]
    name_idx = nodes[i + 1]
    name = strings[name_idx] if isinstance(name_idx, int) and 0 <= name_idx < len(strings) else ''
    if needle and needle not in name:
        continue
    sz = nodes[i + 3] if i + 3 < len(nodes) else 0
    key = (t, name[:160])
    agg[key][0] += 1
    agg[key][1] += sz
ranked = sorted(agg.items(), key=lambda kv: kv[1][1], reverse=True)[:60]
print('top by self_size (type, name, count, bytes):')
for (t, n), (c, sz) in ranked:
    label = n if n else '(empty)'
    print(f'{t}\t{label}\t{c}\t{sz}')
