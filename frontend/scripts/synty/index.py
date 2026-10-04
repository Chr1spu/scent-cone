"""Index unitypackages: write <pack>.idx with 'guid<TAB>pathname' for FBX/PNG/TGA/mat assets."""
import sys, tarfile, os, json

pk = sys.argv[1]
out = {}
with tarfile.open(pk, 'r:*') as t:
    names = {}
    has_asset = set()
    for m in t:
        parts = m.name.strip('./').split('/')
        if len(parts) != 2:
            continue
        guid, leaf = parts
        if leaf == 'pathname':
            names[guid] = t.extractfile(m).read().decode('utf-8', 'replace').splitlines()[0]
        elif leaf == 'asset':
            has_asset.add(guid)
for g, p in names.items():
    if g in has_asset:
        out[g] = p
json.dump(out, open(pk + '.idx.json', 'w'), indent=0)
exts = {}
for p in out.values():
    e = os.path.splitext(p)[1].lower()
    exts[e] = exts.get(e, 0) + 1
print(pk, len(out), exts)
