import sys, base64, re
lines = open(sys.argv[1], encoding='latin-1').read().split('\n')
start, end = int(sys.argv[2]), int(sys.argv[3])
body = ''.join(l[1:] if l.startswith('%') else l for l in lines[start:end])
body = body.strip()
if body.endswith('~>'): body = body[:-2]
data = base64.a85decode(body.replace(' ', ''), adobe=False)
open(sys.argv[4], 'wb').write(data)
print(len(data), data[:300])
