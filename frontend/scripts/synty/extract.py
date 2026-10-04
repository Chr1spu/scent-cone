"""extract.py <pack> <outdir> <basename-substring>... : pull matching assets out of a unitypackage."""
import sys, tarfile, os, json

pk, outdir, *keys = sys.argv[1:]
idx = json.load(open(pk + '.idx.json'))
want = {g: p for g, p in idx.items() if any(k == os.path.basename(p) or (k.endswith('*') and os.path.basename(p).startswith(k[:-1])) for k in keys)}
os.makedirs(outdir, exist_ok=True)
with tarfile.open(pk, 'r:*') as t:
    for m in t:
        parts = m.name.strip('./').split('/')
        if len(parts) == 2 and parts[1] == 'asset' and parts[0] in want:
            dst = os.path.join(outdir, os.path.basename(want[parts[0]]))
            with open(dst, 'wb') as f:
                f.write(t.extractfile(m).read())
            print('->', dst)
