"""Extract stories (text + line boxes in AI coords) from decoded text document."""
import re, json, sys
d = open(sys.argv[1], 'rb').read()
stories = []
for m in re.finditer(rb'\(\xfe\xff((?:[^\\)]|\\.)*)\)', d, re.S):
    if m.start() < 91900: continue
    raw = re.sub(rb'\\(.)', lambda x: x.group(1), m.group(1), flags=re.S)
    s = raw.decode('utf-16-be', errors='replace')
    if s in ('', 'Illustrator') or s.startswith('Anon'): continue
    stories.append(dict(off=m.start(), text=s))
offs = [s['off'] for s in stories] + [len(d)]
t = d.decode('latin-1')
for i, s in enumerate(stories):
    boxes = []
    for m in re.finditer(r'/8 \[ ([-0-9. ]+) \]', t[offs[i]:offs[i + 1]]):
        v = [float(x) for x in m.group(1).split()]
        if len(v) == 4:
            boxes.append([v[0] - 7893, 7770 - v[1], v[2] - 7893, 7770 - v[3]])
    s['boxes'] = boxes
    s['index'] = i
    # for story 0 the text repeats 5x; keep one copy
    txt = s['text']
    if txt.count('Some hug') > 1:
        txt = txt[:txt.index('Some hug', 5)]
    s['text'] = txt.replace('\r', ' / ').strip(' /')
    del s['off']
json.dump(stories, open(sys.argv[2], 'w'), indent=1)
for s in stories:
    b = s['boxes']
    if b:
        print(s['index'], f"x {min(x[0] for x in b):.0f}-{max(x[2] for x in b):.0f} y {max(x[1] for x in b):.0f}..{min(x[3] for x in b):.0f}", s['text'][:70])
    else:
        print(s['index'], 'NO BOX', s['text'][:70])
